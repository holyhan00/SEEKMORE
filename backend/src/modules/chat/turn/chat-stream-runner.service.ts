                                                              
import { Injectable } from '@nestjs/common';
import { SeekmoreAgentService } from '../../seekmore-agent/seekmore-agent.service';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';
import { SkillTurnPreparationService } from '../../agent/skill/runtime/skill-turn-preparation.service';
import { SkillTurnContextStore } from '../../agent/skill/runtime/skill-turn-context.store';
import type {
  AgentTurnExecutionInput as RuntimeChatTurnInput,
  AgentTurnExecutionResult as RuntimeChatTurnResult,
} from '../../seekmore-agent/contracts/agent-turn.types';

@Injectable()
export class ChatStreamRunner {
  constructor(
    private readonly runtime: SeekmoreAgentService,
    private readonly trace: RuntimeFlowTraceLogger,
    private readonly skills: SkillTurnPreparationService,
    private readonly skillContexts: SkillTurnContextStore,
  ) {}

  async run(input: RuntimeChatTurnInput): Promise<RuntimeChatTurnResult> {
    throwIfAborted(input.abortSignal);
    this.trace.event('runner.run_chat_turn_start', {
      trace: input.traceId,
      conversationId: input.conversationId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      agentId: input.agentId,
      stream: input.stream,
      inputLen: input.input.length,
    });
    const skillContext = await this.skills.prepare({
      traceId: input.traceId,
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      userMessage: input.input,
      externalContext: input.externalContext,
    });
    throwIfAborted(input.abortSignal);
    this.skillContexts.set(skillContext);
    const runtimeInput: RuntimeChatTurnInput = {
      ...input,
      externalContext: {
        ...(input.externalContext ?? {}),
        skillRuntime: {
          catalog: skillContext.catalog,
          preloadedSkills: skillContext.preloadedSkills,
          explicitSkillIds: skillContext.explicitSkillIds,
          policy: skillContext.policy,
          discoveryOrder: ['ASSOCIATED_SKILLS', 'PUBLIC_HIGH_RELEVANCE'],
          guidance: 'Search the Agent-associated Skill catalog first. Only if no associated Skill is sufficient, consider highly relevant public Skills. Use skill_view for full instructions and skill_read_resource for supporting files.',
        },
      },
    };
    try {
      const result = await this.runtime.runChatTurn(runtimeInput);
      this.trace.event('runner.run_chat_turn_done', {
        trace: input.traceId,
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        contentLen: result.content.length,
        citationCount: result.citations.length,
        objectCount: result.objects.length,
        warningCount: result.warnings.length,
        reasonCodes: result.reasonCodes.join('|'),
        hasRuntime: Boolean(result.runtime),
        skillCatalogCount: skillContext.catalog.length,
        preloadedSkillCount: skillContext.preloadedSkills.length,
      });
      return result;
    } finally {
      this.skillContexts.clear(input.traceId);
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('CHAT_TURN_CANCELLED');
  error.name = 'AbortError';
  throw error;
}
