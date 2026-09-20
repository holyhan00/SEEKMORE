import { Injectable } from '@nestjs/common';
import type { AgentRuntimeMessage, AgentRuntimeTurnRequest, AgentRuntimeToolDefinition } from '../../contracts/agent-turn.types';
import { TokenEstimatorService } from './token-estimator.service';
import { AgentRuntimeError } from '../errors/agent-runtime.errors';
import { contentText } from '../model/model-content.util';
import type { WorldSnapshot } from './world-state.types';

export interface ModelContext {
  messages: AgentRuntimeMessage[];
  selectedIndices: number[];
  omittedCount: number;
  beforeTokens: number;
  afterTokens: number;
  limit: number;
}

/** Ephemeral deterministic projection. Canonical messages and their order never change. */
@Injectable()
export class ContextResolverService {
  constructor(private readonly estimator: TokenEstimatorService) {}

  resolve(input: { request: AgentRuntimeTurnRequest; messages: AgentRuntimeMessage[];
    tools: AgentRuntimeToolDefinition[]; world: WorldSnapshot; retry?: number; capabilityCatalog?: string; obligations?: Array<{ toolCallId: string; target: string }> }): ModelContext {
    const { request, messages, tools } = input;
    const contextWindow = request.agent.contextWindow ?? 128_000;
    const reserve = request.agent.maxTokens ?? 8192;
    const limit = Math.floor((contextWindow - reserve) * 0.8 * Math.pow(0.75, input.retry ?? 0));
    if (limit <= 0) throw new AgentRuntimeError('CONTEXT_BUDGET_INVALID', 'Output reserve exhausts the configured context window');
    const world: AgentRuntimeMessage = { role: 'system', content: { runtimeContextType: 'observed_world', ...input.world } };
    const catalog: AgentRuntimeMessage[] = input.capabilityCatalog ? [{ role: 'system', content: { runtimeContextType: 'capability_catalog', namespaces: input.capabilityCatalog } }] : [];
    const obligations: AgentRuntimeMessage[] = input.obligations?.length ? [{ role: 'system', content: { runtimeContextType: 'completion_obligations', unresolved: input.obligations } }] : [];
    const obligationIds = new Set(input.obligations?.map((item) => item.toolCallId) ?? []);
    const projectionExtras = [world, ...catalog, ...obligations];
    const goalIndex = messages.findIndex((message) => message.id === request.userMessageId);
    let latestUser = -1;
    messages.forEach((message, index) => { if (message.role === 'user') latestUser = index; });
    const terms = new Set((request.input + ' ' + contentText(messages[latestUser]?.content)).toLowerCase().match(/[\p{L}\p{N}_./-]{2,}/gu) ?? []);
    const groups: Array<{ indices: number[]; pinned: boolean; score: number }> = [];
    for (let i = 0; i < messages.length;) {
      const start = i++;
      if (messages[start].role === 'assistant' && messages[start].toolCalls?.length) {
        while (i < messages.length && messages[i].role === 'tool') i++;
      }
      const indices = Array.from({ length: i - start }, (_, n) => start + n);
      const first = messages[start];
      const text = contentText(first.content).toLowerCase();
      const optionalSystem = /relevant_memory|compacted prior|historical tool|skill_knowledge/.test(text);
      const pinned = (first.role === 'system' && !optionalSystem)
        || indices.includes(latestUser) || indices.includes(goalIndex)
        || (first.role === 'user' && goalIndex >= 0 && start >= goalIndex)
        || first.toolCalls?.some((call) => obligationIds.has(call.id)) === true
        || i === messages.length;
      const relevance = [...terms].filter((term) => text.includes(term)).length;
      groups.push({ indices, pinned, score: relevance * 20 + start / Math.max(1, messages.length) * 10 + (first.role === 'tool' || first.toolCalls?.length ? 5 : 0) });
    }
    const selected = new Set<number>();
    for (const group of groups.filter((group) => group.pinned)) for (const index of group.indices) selected.add(index);
    const render = () => [...messages.filter((_, index) => selected.has(index)).map((message) => {
      const copy = structuredClone(message);
      if (copy.role === 'tool' && typeof copy.content === 'string') {
        const maxChars = Math.max(1024, Math.min(24000, Math.floor(limit * 1.5 / Math.max(1, selected.size))));
        if (copy.content.length > maxChars) copy.content = `${copy.content.slice(0, maxChars)}\n[Observation excerpt; full result retained under toolCallId ${copy.toolCallId}. Omitted text is unknown to this step.]`;
      }
      return copy;
    }), ...projectionExtras];
    if (this.estimator.messages(render(), tools) > limit) {
      throw new AgentRuntimeError('CONTEXT_PINNED_OVER_BUDGET', 'Required policy, current inputs, tool protocol or observations exceed the model budget', false, { limit });
    }
    for (const group of groups.filter((group) => !group.pinned).sort((a, b) => b.score - a.score || a.indices[0] - b.indices[0])) {
      for (const index of group.indices) selected.add(index);
      if (this.estimator.messages(render(), tools) > limit) for (const index of group.indices) selected.delete(index);
    }
    const projected = render();
    return { messages: projected, selectedIndices: [...selected].sort((a, b) => a - b),
      omittedCount: messages.length - selected.size, beforeTokens: this.estimator.messages([...messages, ...projectionExtras], tools),
      afterTokens: this.estimator.messages(projected, tools), limit };
  }
}
