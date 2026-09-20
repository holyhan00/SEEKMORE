// backend/src/modules/seekmore-agent/runtime/loop/agent-loop-state.ts
import type { AgentAttachedObject, AgentRuntimeMessage, AgentRuntimeTurnRequest } from '../../contracts/agent-turn.types';
import { contentText } from '../model/model-content.util';
import type { AgentToolExecutionRecord } from '../../contracts/agent-tool.types';
import type { ModelUsage } from '../model/model.types';
import { IterationBudget } from './iteration-budget';

export class AgentLoopState {
  messages: AgentRuntimeMessage[];
  readonly usedMemoryIds = new Set<string>();
  readonly loadedToolNames = new Set<string>();
  authorizedTools: AgentRuntimeTurnRequest['tools'] = [];
  selectedToolNames = new Set<string>();
  currentInputObjects: AgentAttachedObject[] = [];
  readonly branchObjectIds = new Set<string>();
  worldRevision: string | null = null;
  pendingClarificationId: string | null = null;
  readonly budget: IterationBudget;
  readonly toolExecutions: AgentToolExecutionRecord[] = [];
  readonly warnings: string[] = [];
  readonly reasonCodes: string[] = [];
  readonly toolFingerprintCounts = new Map<string, number>();
  visibleContent = '';
  reasoning = '';
  finalContent = '';
  iterationContent = '';
  emptyResponses = 0;
  lengthContinuations = 0;
  contextRetries = 0;
  noProgressStreak = 0;
  usage: ModelUsage = {};
  lastMutationIteration: number | null = null;
  lastVerificationIteration: number | null = null;
  verificationNudged = false;
  contentMode: 'stream' | 'buffered' = 'stream';
  iteration = 0;

  constructor(readonly request: AgentRuntimeTurnRequest) {
    this.messages = initialMessages(request);
    this.currentInputObjects = [...request.attachedObjects];
    for (const objectId of request.branchObjectIds ?? []) this.branchObjectIds.add(objectId);
    this.budget = new IterationBudget(Math.max(1, Math.min(request.maxIterations, 200)));
  }

  restore(snapshot: Record<string, any>): void {
    if (snapshot.workspaceId !== this.request.workspace.workspaceId) throw new Error('TURN_RESUME_WORKSPACE_CHANGED');
    this.messages = snapshot.messages;
    for (const id of snapshot.usedMemoryIds ?? []) this.usedMemoryIds.add(id);
    for (const name of snapshot.loadedToolNames ?? []) this.loadedToolNames.add(name);
    this.iteration = snapshot.iteration ?? 0;
    this.pendingClarificationId = snapshot.pendingClarificationId ?? null;
    this.currentInputObjects = Array.isArray(snapshot.currentInputObjects) ? snapshot.currentInputObjects : [...this.request.attachedObjects];
    this.branchObjectIds.clear();
    for (const objectId of snapshot.branchObjectIds ?? this.request.branchObjectIds ?? []) this.branchObjectIds.add(String(objectId));
    this.budget.restore(snapshot.budget ?? {});
    this.toolExecutions.push(...(snapshot.toolExecutions ?? []));
    this.usage = snapshot.usage ?? {};
    this.lastMutationIteration = snapshot.lastMutationIteration ?? null;
    this.lastVerificationIteration = snapshot.lastVerificationIteration ?? null;
    this.verificationNudged = Boolean(snapshot.verificationNudged);
    this.noProgressStreak = snapshot.noProgressStreak ?? 0;
    this.visibleContent = typeof snapshot.visibleContent === 'string' ? snapshot.visibleContent : '';
    this.finalContent = typeof snapshot.finalContent === 'string' ? snapshot.finalContent : '';
    this.emptyResponses = Number.isInteger(snapshot.emptyResponses) ? snapshot.emptyResponses : 0;
    this.lengthContinuations = Number.isInteger(snapshot.lengthContinuations) ? snapshot.lengthContinuations : 0;
    this.contextRetries = Number.isInteger(snapshot.contextRetries) ? snapshot.contextRetries : 0;
    this.worldRevision = typeof snapshot.worldRevision === 'string' ? snapshot.worldRevision : null;
    this.contentMode = snapshot.contentMode === 'buffered' ? 'buffered' : 'stream';
    for (const warning of snapshot.warnings ?? []) if (typeof warning === 'string') this.warnings.push(warning);
    for (const code of snapshot.reasonCodes ?? []) if (typeof code === 'string') this.reasonCodes.push(code);
    for (const [key, value] of snapshot.fingerprints ?? []) this.toolFingerprintCounts.set(key, value);
  }

  snapshot(phase: 'ready' | 'waiting_user' | 'executing_tools' | 'terminal'): Record<string, unknown> {
    return { usedMemoryIds: [...this.usedMemoryIds], workspaceId: this.request.workspace.workspaceId, loadedToolNames: [...this.loadedToolNames], phase, messages: this.messages, iteration: this.iteration,
      pendingClarificationId: this.pendingClarificationId, currentInputObjects: this.currentInputObjects, branchObjectIds: [...this.branchObjectIds], budget: this.budget.snapshot(),
      toolExecutions: this.toolExecutions, usage: this.usage,
      lastMutationIteration: this.lastMutationIteration, lastVerificationIteration: this.lastVerificationIteration,
      verificationNudged: this.verificationNudged, noProgressStreak: this.noProgressStreak,
      visibleContent: this.visibleContent, finalContent: this.finalContent,
      emptyResponses: this.emptyResponses, lengthContinuations: this.lengthContinuations, contextRetries: this.contextRetries,
      worldRevision: this.worldRevision, contentMode: this.contentMode, warnings: this.warnings, reasonCodes: this.reasonCodes,
      fingerprints: [...this.toolFingerprintCounts.entries()] };
  }

  beginIteration(): void {
    this.iterationContent = '';
  }

  appendIterationContent(delta: string): void {
    this.iterationContent += delta;
  }

  appendVisible(delta: string): void {
    this.visibleContent += delta;
  }

  appendAssistant(
    content: string,
    toolCalls = [] as AgentRuntimeMessage['toolCalls'],
    reasoningContent?: string,
  ): void {
    this.messages.push({
      role: 'assistant',
      content,
      toolCalls,
      ...(reasoningContent ? { reasoningContent } : {}),
    });
  }

  appendTool(message: AgentRuntimeMessage, execution: AgentToolExecutionRecord): void {
    this.messages.push(message);
    this.toolExecutions.push(execution);
    if (execution.result.status === 'completed') {
      for (const object of execution.result.objects ?? []) {
        const objectId = String(object.objectId ?? object.id ?? '').trim();
        if (objectId) this.branchObjectIds.add(objectId);
      }
    }
  }

  mergeUsage(usage: ModelUsage): void {
    this.usage = {
      inputTokens: add(this.usage.inputTokens, usage.inputTokens),
      outputTokens: add(this.usage.outputTokens, usage.outputTokens),
      totalTokens: add(this.usage.totalTokens, usage.totalTokens),
      cachedInputTokens: add(this.usage.cachedInputTokens, usage.cachedInputTokens),
    };
  }
}

function initialMessages(request: AgentRuntimeTurnRequest): AgentRuntimeMessage[] {
  const output: AgentRuntimeMessage[] = [];
  const agentInstructions = request.agent.instructions.trim();

  if (agentInstructions) output.push({ role: 'system', content: agentInstructions });
  for (const message of request.messages) {
    if (message.id === request.userMessageId) continue;
    if (
      message.role === 'system'
      && contentText(message.content).trim() === agentInstructions
    ) continue;
    output.push({ ...message });
  }

  output.push({
    id: request.userMessageId,
    role: 'user',
    content: userInputContent(request.input, request.attachedObjects),
    parentMessageId: request.parentMessageId,
  });
  return output;
}

export function userInputContent(text: string, objects: AgentAttachedObject[]): AgentRuntimeMessage['content'] {
  return objects.length
    ? { runtimeContextType: 'user_input', text, attachedObjects: objects }
    : text;
}

function add(left?: number, right?: number): number | undefined { return left == null && right == null ? undefined : (left ?? 0) + (right ?? 0); }
