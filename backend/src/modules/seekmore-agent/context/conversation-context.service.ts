import { Injectable } from '@nestjs/common';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';
import { RuntimeWorkspaceResolver } from '../../workspace/runtime-workspace-resolver.service';
import { MemoryFacade } from '../../memory/facade/memory.facade';
import type {
  AgentRuntimeMessage,
  AgentTurnExecutionInput,
} from '../contracts/agent-turn.types';
import { withTimeout } from '../runtime/util/runtime.util';
import { AgentProfileContextService } from './agent-profile-context.service';
import { BranchHistoryService } from './branch-history.service';

@Injectable()
export class ConversationContextService {
  constructor(
    private readonly branches: BranchHistoryService,
    private readonly agents: AgentProfileContextService,
    private readonly workspaces: RuntimeWorkspaceResolver,
    private readonly memory: MemoryFacade,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {}

  async build(input: AgentTurnExecutionInput) {
    const startedAt = Date.now();
    const timeoutMs = this.contextTimeoutMs();

    this.trace.event('seekmore_agent.context_build_start', {
      trace: input.traceId,
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      leafMessageId: input.contextLeafMessageId,
      timeoutMs,
    });

    try {
      const [branch, agent, workspace] = await Promise.all([
        this.stage(
          input,
          'branch_history',
          () => this.branches.load({
            conversationId: input.conversationId,
            leafMessageId: input.contextLeafMessageId,
            userId: input.userId,
            agentId: input.agentId,
          }),
          timeoutMs,
        ),
        this.stage(
          input,
          'agent_profile',
          () => this.agents.load({
            userId: input.userId,
            agentId: input.agentId,
            requestedModel: input.model,
          }),
          timeoutMs,
        ),
        this.stage(
          input,
          'workspace',
          () => this.workspaces.resolve({
            traceId: input.traceId,
            userId: input.userId,
            agentId: input.agentId,
            conversationId: input.conversationId,
            workspaceId: input.runtimeOptions?.workspaceId ?? null,
          }),
          timeoutMs,
        ),
      ]);

      const emptyMemory = {
        blocks: [],
        retrieved: [],
        skipped: true,
        reason: 'memory_disabled',
      };

      const memory = agent.memoryEnabled
        ? await this.stage(
            input,
            'memory',
            () => this.memory.buildContext({
              traceId: input.traceId,
              user: { id: input.userId },
              scope: {
                agentId: input.agentId,
                conversationId: input.conversationId,
              },
              query: input.input,
              recentMessages: this.recentMessages(branch.messages),
              maxItems: 6,
              maxChars: 4_000,
            }),
            timeoutMs,
          ).catch((error) => {
            this.trace.warn('seekmore_agent.memory_context_skipped', {
              trace: input.traceId,
              conversationId: input.conversationId,
              error: error instanceof Error ? error.message : String(error),
            });
            return {
              ...emptyMemory,
              reason: 'memory_read_failed',
            };
          })
        : emptyMemory;

      this.trace.event('seekmore_agent.context_build_done', {
        trace: input.traceId,
        conversationId: input.conversationId,
        durationMs: Date.now() - startedAt,
        messageCount: branch.messages.length,
        attachedObjectCount: branch.inputObjects.length,
        branchId: branch.branchId,
        provider: agent.provider,
        model: agent.model,
        toolEnabled: agent.toolEnabled,
        knowledgeAvailable: agent.knowledgeAvailable,
        memoryBlockCount: memory.blocks.length,
        memoryRetrievedCount: memory.retrieved.length,
        workspaceId: workspace?.workspaceId ?? null,
        workspaceResolved: Boolean(workspace?.rootPath),
      });

      return { branch, agent, workspace, memory };
    } catch (error) {
      this.trace.error('seekmore_agent.context_build_failed', {
        trace: input.traceId,
        conversationId: input.conversationId,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async stage<T>(
    input: AgentTurnExecutionInput,
    stage: 'branch_history' | 'agent_profile' | 'workspace' | 'memory',
    action: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const startedAt = Date.now();

    this.trace.event('seekmore_agent.context_stage_start', {
      trace: input.traceId,
      conversationId: input.conversationId,
      stage,
      timeoutMs,
    });

    try {
      const result = await withTimeout(
        action(),
        timeoutMs,
        `AGENT_CONTEXT_${stage.toUpperCase()}_TIMEOUT`,
        input.abortSignal,
      );

      this.trace.event('seekmore_agent.context_stage_done', {
        trace: input.traceId,
        conversationId: input.conversationId,
        stage,
        durationMs: Date.now() - startedAt,
      });

      return result;
    } catch (error) {
      this.trace.error('seekmore_agent.context_stage_failed', {
        trace: input.traceId,
        conversationId: input.conversationId,
        stage,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private recentMessages(
    messages: AgentRuntimeMessage[],
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    return messages
      .filter(
        (message): message is AgentRuntimeMessage & {
          role: 'user' | 'assistant' | 'system';
          content: string;
        } => (
          (message.role === 'user'
            || message.role === 'assistant'
            || message.role === 'system')
          && typeof message.content === 'string'
          && message.content.trim().length > 0
        ),
      )
      .slice(-6)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
  }

  private contextTimeoutMs(): number {
    const seconds = Number(process.env.SEEKMORE_AGENT_CONTEXT_TIMEOUT_S ?? 60);
    if (!Number.isFinite(seconds)) return 60_000;
    return Math.max(5_000, Math.min(seconds * 1000, 300_000));
  }
}
