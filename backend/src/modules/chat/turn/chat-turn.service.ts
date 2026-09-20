                                                     
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AgentTurnFinalizationService } from '../../seekmore-agent/finalization/agent-turn-finalization.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MessageObjectLinkService } from '../../object-runtime/message-object/message-object.service';
import { ChatObjectProjectionService } from '../object-projection/chat-object-projection.service';
import { MemoryFacade } from '../../memory/facade/memory.facade';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';
import { RuntimeAccessPolicyService } from '../../approval/runtime-access-policy.service';
import { MessageTreeService } from '../message-tree/message-tree.service';
import { ChatPostTurnService } from '../post-turn/chat-post-turn.service';
import { EVT_CHAT_MESSAGE_CREATED } from '../types/chat.events';
import type {
  ChatOutputObject,
  ChatOutputWarning,
} from '../types/chat.events';
import { ChatResponseWriter } from './chat-response-writer.service';
import { ChatExecutionDispatcher } from './chat-execution-dispatcher.service';
import { ChatConversationRepository } from '../persistence/chat-conversation.repository';
import { LocaleResolverService } from '../../localization/locale-resolver.service';
import type {
  ChatTurnAnchors,
  ChatTurnMessageEnvelope,
  ChatTurnResult,
  StartChatTurnInput,
} from './chat-turn.types';

@Injectable()
export class ChatTurnService {
  private readonly logger = new Logger(ChatTurnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageObjects: MessageObjectLinkService,
    private readonly objectProjection: ChatObjectProjectionService,
    private readonly messageTree: MessageTreeService,
    private readonly responseWriter: ChatResponseWriter,
    private readonly runner: ChatExecutionDispatcher,
    private readonly postTurn: ChatPostTurnService,
    private readonly memory: MemoryFacade,
    private readonly accessPolicy: RuntimeAccessPolicyService,
    private readonly eventBus: EventEmitter2,
    private readonly trace: RuntimeFlowTraceLogger,
    private readonly finalization: AgentTurnFinalizationService,
    private readonly conversations: ChatConversationRepository,
    private readonly localeResolver: LocaleResolverService,
  ) {}

  async start(
    input: StartChatTurnInput,
  ): Promise<ChatTurnResult> {
    const startedAt = Date.now();
    throwIfAborted(input.abortSignal);

    const preparedAccess =
      await this.accessPolicy.resolveForTurnPreparation({
        traceId: input.traceId,
        userId: input.userId,
        conversationId: input.conversationId,
      });
    const effectiveRuntimeOptions = {
      ...input.runtimeOptions,
      workspaceId: preparedAccess.workspaceId,
      permissionMode: preparedAccess.permissionMode,
    };

    const localization = await this.localeResolver.resolveForTurn({
      userId: input.userId,
      conversationId: input.conversationId,
      client: input.localeContext ?? null,
    });

    this.trace.event('turn.start', {
      trace: input.traceId,
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      requestedParentMessageId: null,
      clientMessageId: input.clientMessageId ?? null,
      contentLen: input.content.length,
      objectRefCount: input.objectRefs?.length ?? 0,
      hasRuntimeOptions: Boolean(input.runtimeOptions),
      workspaceId: effectiveRuntimeOptions.workspaceId ?? null,
      permissionMode: effectiveRuntimeOptions.permissionMode ?? null,
    });

    const resumedUser = input.resume ? await this.prisma.message.findFirst({ where: { conversationId: input.conversationId, traceId: input.traceId, role: 'USER' } }) : null;
    if (input.resume && !resumedUser) throw new Error('TURN_RESUME_ANCHOR_MISSING');
    const createdTurn = resumedUser ? { message: resumedUser, taskBoundaryReset: false, contextBoundary: null, workspaceChanged: false, previousWorkspaceId: null, workspaceResumed: false } : await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertUserAccess({
        userId: input.userId,
        conversationId: input.conversationId,
        tx,
      });
      const treeContext = await this.messageTree.resolveCreateContext(tx, {
        userId: input.userId,
        conversationId: input.conversationId,
        requestedParentMessageId: null,
        clientMessageId: input.clientMessageId ?? null,
        traceId: input.traceId,
        workspaceId: effectiveRuntimeOptions.workspaceId ?? null,
      });

      const message = await this.messageTree.createUserNode(tx, {
        conversationId: input.conversationId,
        userId: input.userId,
        agentId: input.agentId,
        content: input.content,
        traceId: input.traceId,
        clientMessageId: input.clientMessageId ?? null,
      }, treeContext);

      await this.messageObjects.bindUserInputs(tx, {
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        messageId: message.id,
        objectRefs: input.objectRefs ?? [],
      });

      return {
        message,
        taskBoundaryReset: treeContext.taskBoundaryReset,
        contextBoundary: treeContext.contextBoundary,
        workspaceChanged: treeContext.workspaceChanged,
        previousWorkspaceId: treeContext.previousWorkspaceId,
        workspaceResumed: treeContext.workspaceResumed,
      };
    });
    const userMessage = createdTurn.message;

    this.trace.debug('turn.conversation_access_ok', {
      trace: input.traceId,
      userId: input.userId,
      conversationId: input.conversationId,
    });

    this.trace.event('turn.user_message_created', {
      trace: input.traceId,
      conversationId: input.conversationId,
      userMessageId: userMessage.id,
      parentMessageId:
        userMessage.parentMessageId ?? null,
      rootMessageId:
        (userMessage as any).rootMessageId ?? null,
      branchId:
        (userMessage as any).branchId ?? null,
      contentLen: String(
        userMessage.content ?? '',
      ).length,
      contextBoundary: createdTurn.contextBoundary,
      workspaceChanged: createdTurn.workspaceChanged,
      workspaceId: effectiveRuntimeOptions.workspaceId ?? null,
      previousWorkspaceId: createdTurn.previousWorkspaceId,
      workspaceResumed: createdTurn.workspaceResumed,
    });

    if (!input.resume) this.eventBus.emit(EVT_CHAT_MESSAGE_CREATED, {
      conversationId: input.conversationId,
      userId: input.userId,
      agentId: input.agentId,
      messageId: userMessage.id,
      role: 'user',
    });

    this.trace.debug('turn.title_event_emitted', {
      trace: input.traceId,
      conversationId: input.conversationId,
      userId: input.userId,
      agentId: input.agentId,
      messageId: userMessage.id,
      role: 'user',
    });

    this.trace.event('chat.user_message_anchor', {
      trace: input.traceId,
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      userMessageId: userMessage.id,
      parentMessageId:
        userMessage.parentMessageId ?? null,
      rootMessageId:
        (userMessage as any).rootMessageId ?? null,
      branchId:
        (userMessage as any).branchId ?? null,
      inputLen: String(
        userMessage.content ?? '',
      ).length,
    });

    const assistantMessage =
      input.resume ? await this.prisma.message.findFirstOrThrow({ where: { conversationId: input.conversationId, traceId: input.traceId, role: 'ASSISTANT' } }) : await this.messageTree.createAssistantShell({
        conversationId: input.conversationId,
        agentId: input.agentId,
        parentMessageId: userMessage.id,
        traceId: input.traceId,
        model: input.model ?? null,
        endpoint: null,
      });

    if (input.resume) {
      this.responseWriter.hydrate({
        messageId: assistantMessage.id,
        traceId: input.traceId,
        content: String(assistantMessage.content ?? ''),
      });
    }

    this.trace.event('turn.assistant_shell_created', {
      trace: input.traceId,
      conversationId: input.conversationId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      parentMessageId:
        assistantMessage.parentMessageId ?? null,
      rootMessageId:
        (assistantMessage as any).rootMessageId ?? null,
      branchId:
        (assistantMessage as any).branchId ?? null,
    });

    this.trace.event(
      'chat.assistant_message_anchor',
      {
        trace: input.traceId,
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        parentMessageId:
          assistantMessage.parentMessageId ?? null,
        rootMessageId:
          (assistantMessage as any).rootMessageId ??
          null,
        branchId:
          (assistantMessage as any).branchId ?? null,
        status:
          (assistantMessage as any).status ?? null,
        unfinished:
          (assistantMessage as any).unfinished ?? null,
      },
    );

    const turnAnchors: ChatTurnAnchors = {
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      userMessage: this.toTurnMessageEnvelope({
        message: userMessage,
        role: 'user',
        traceId: input.traceId,
        complete: true,
      }),
      assistantMessage: this.toTurnMessageEnvelope({
        message: assistantMessage,
        role: 'agent',
        traceId: input.traceId,
        complete: false,
      }),
    };

    // Anchor the durable Turn before announcing RUNNING; fast supplements must have an owner.
    await this.prisma.agentTurn.upsert({ where: { traceId: input.traceId }, update: {}, create: {
      traceId: input.traceId, userId: input.userId, agentId: input.agentId, conversationId: input.conversationId,
      userMessageId: userMessage.id, assistantMessageId: assistantMessage.id, kernelSessionId: input.conversationId,
      workspaceId: effectiveRuntimeOptions.workspaceId, permissionMode: effectiveRuntimeOptions.permissionMode,
      status: 'running', requestJson: { input: input.content },
    } });
    await input.onStarted?.(turnAnchors);

    try {
      throwIfAborted(input.abortSignal);
      this.trace.event('turn.runner_start', {
        trace: input.traceId,
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
        contextLeafMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        parentMessageId:
          userMessage.parentMessageId ?? null,
        stream: true,
        hasRuntimeOptions: Boolean(
          effectiveRuntimeOptions,
        ),
      });

      const result = await this.runner.run({
        traceId: input.traceId,
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        parentMessageId:
          userMessage.parentMessageId ?? null,
        userMessageId: userMessage.id,
        contextLeafMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        input: input.content,
        model: input.model ?? null,
        stream: true,
        abortSignal: input.abortSignal,
        runtimeOptions: effectiveRuntimeOptions,
        localization,
        externalContext: input.explicitSkillIds?.length
          ? { explicitSkillIds: [...new Set(input.explicitSkillIds)].slice(0, 20) }
          : null,

        onObjects: async (producedObjects) => {
          const deliveredObjects = await this.deliverProducedObjects({
            userId: input.userId,
            agentId: input.agentId,
            conversationId: input.conversationId,
            assistantMessageId: assistantMessage.id,
            objects: producedObjects,
          });

          if (deliveredObjects.length === 0) {
            return;
          }

          await input.onObjects?.(
            deliveredObjects,
            {
              userMessageId: turnAnchors.userMessageId,
              assistantMessageId: turnAnchors.assistantMessageId,
            },
          );
        },

        onToken: async (token) => {
          throwIfAborted(input.abortSignal);
          this.trace.debug('turn.on_token', {
            trace: input.traceId,
            conversationId: input.conversationId,
            assistantMessageId:
              assistantMessage.id,
            tokenLen: token.length,
          });

          const buffered =
            this.responseWriter.appendBuffer({
              messageId: assistantMessage.id,
              traceId: input.traceId,
              chunk: token,
            });

          this.trace.debug(
            'turn.delta_emit_start',
            {
              trace: input.traceId,
              conversationId:
                input.conversationId,
              assistantMessageId:
                assistantMessage.id,
              tokenLen: token.length,
              bufferedLen: buffered.length,
            },
          );

          await input.onDelta?.(
            token,
            {
              userMessageId:
                turnAnchors.userMessageId,
              assistantMessageId:
                turnAnchors.assistantMessageId,
            },
          );
          throwIfAborted(input.abortSignal);

          this.trace.debug(
            'turn.delta_emit_done',
            {
              trace: input.traceId,
              conversationId:
                input.conversationId,
              assistantMessageId:
                assistantMessage.id,
              tokenLen: token.length,
              bufferedLen: buffered.length,
            },
          );

          this.responseWriter.scheduleFlush({
            messageId: assistantMessage.id,
            traceId: input.traceId,
          });
        },
      });
      throwIfAborted(input.abortSignal);

      await this.responseWriter.flushNow({
        messageId: assistantMessage.id,
        traceId: input.traceId,
        reason: 'before_finalize',
      });

      const buffered = this.responseWriter.read(
        assistantMessage.id,
      );

      const content = result.content || buffered;
      const citations = this.normalizeCitations(
        result.citations,
      );
      const runtime = this.normalizeRuntime(
        result.runtime,
      );
      const objects = this.normalizeObjects(
        (result as any).objects,
      );
      const warnings = this.normalizeWarnings(
        (result as any).warnings,
      );
      const reasonCodes = this.normalizeReasonCodes(
        (result as any).reasonCodes,
      );

      this.trace.event('turn.runner_done', {
        trace: input.traceId,
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        resultContentLen: String(
          result.content ?? '',
        ).length,
        bufferedLen: buffered.length,
        finalContentLen: content.length,
        citationCount: citations.length,
        objectCount: objects.length,
        warningCount: warnings.length,
        reasonCodes:
          reasonCodes.join('|') || null,
      });

      const outcome = result.outcome;

      if (!outcome) {
        throw new Error(
          'runtime_turn:missing_outcome',
        );
      }

      const canDeliverObjects =
        outcome.kind === 'terminal'
        && (outcome.status === 'succeeded' || outcome.status === 'partial');
      const outputObjects = canDeliverObjects
        ? objects
            .filter((value) => value.objectId.trim().length > 0 && value.role === 'assistant_output')
            .map((value, position) => ({ objectId: value.objectId.trim(), position }))
        : [];

      const isPaused =
        outcome.kind === 'paused';

      const finalStatus =
        outcome.kind === 'paused'
          ? outcome.reason
          : outcome.status;

      const finalizationKey =
        this.finalizationKey(
          input.traceId,
          assistantMessage.id,
          outcome.kind === 'paused' ? `${finalStatus}:${String(runtime?.iterations ?? 0)}` : finalStatus,
        );

      if (outcome.kind === 'paused') {
        await this.finalization.commitPause({
          traceId: input.traceId,
          conversationId:
            input.conversationId,
          assistantMessageId:
            assistantMessage.id,
          content,
          citations,
          runtime,
          metadata: {
            reasonCodes,
            runtimeTurnOutcome: outcome,
          },
          reasonCodes,
          pauseStatus:
            outcome.reason === 'approval'
              ? 'waiting_for_approval'
              : outcome.reason === 'external_dependency'
                ? 'waiting_for_external_dependency'
                : 'waiting_for_user',
          finalizationKey,
        });
      } else {
        await this.finalization.commitTerminal({
          traceId: input.traceId,
          conversationId:
            input.conversationId,
          assistantMessageId:
            assistantMessage.id,
          content,
          citations,
          runtime,
          metadata: {
            reasonCodes,
            runtimeTurnOutcome: outcome,
          },
          reasonCodes,
          terminalStatus:
            outcome.status === 'partial'
              ? 'partially_succeeded'
              : outcome.status,
          finalizationKey,
          userId: input.userId,
          agentId: input.agentId,
          outputObjects,
        });
      }

      const deliveredObjects = isPaused
        ? []
        : await this.objectProjection.projectMessage({
            userId: input.userId,
            conversationId: input.conversationId,
            messageId: assistantMessage.id,
          });

      this.trace.event(
        isPaused
          ? 'turn.assistant_paused'
          : 'turn.assistant_finalized',
        {
          trace: input.traceId,
          conversationId:
            input.conversationId,
          assistantMessageId:
            assistantMessage.id,
          outcomeKind: outcome.kind,
          outcomeStatus: finalStatus,
          contentLen: content.length,
          objectCount: deliveredObjects.length,
          warningCount: warnings.length,
        },
      );

      if (isPaused) {
        this.responseWriter.closeTrace(input.traceId);
        this.responseWriter.clear(
          assistantMessage.id,
        );

        this.trace.event('turn.paused', {
          trace: input.traceId,
          conversationId:
            input.conversationId,
          assistantMessageId:
            assistantMessage.id,
          outcomeStatus: finalStatus,
          objectCount: deliveredObjects.length,
          warningCount: warnings.length,
          latencyMs: Date.now() - startedAt,
        });

        return {
          traceId: input.traceId,
          conversationId:
            input.conversationId,
          userMessageId: userMessage.id,
          assistantMessageId:
            assistantMessage.id,
          content,
          citations,
          runtime,
          objects: deliveredObjects,
          warnings,
          reasonCodes,
          terminalStatus:
            outcome.reason === 'approval'
              ? 'waiting_approval'
              : outcome.reason === 'external_dependency'
                ? 'waiting_external'
                : 'waiting_user',
        };
      }

      const terminalStatus = outcome.status === 'partial'
        ? 'partially_succeeded'
        : outcome.status;

      if (terminalStatus === 'failed' || terminalStatus === 'blocked' || terminalStatus === 'cancelled') {
        this.responseWriter.closeTrace(input.traceId);
        this.responseWriter.clear(assistantMessage.id);
        return {
          traceId: input.traceId,
          conversationId: input.conversationId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          content,
          citations,
          runtime,
          objects: deliveredObjects,
          warnings,
          reasonCodes,
          terminalStatus,
        };
      }

      const usedMemoryIds =
        this.extractUsedMemoryIds(runtime);

      if (usedMemoryIds.length > 0) {
        await this.memory
          .recordRuntimeUsage({
            user: {
              id: input.userId,
              role: null,
              roles: [],
            } as any,
            scope: {
              agentId: input.agentId,
              conversationId:
                input.conversationId,
            },
            memoryIds: usedMemoryIds,
            traceId: input.traceId,
            conversationId:
              input.conversationId,
            userMessageId: userMessage.id,
            assistantMessageId:
              assistantMessage.id,
            reason: 'chat_turn_finalized',
          })
          .then((usage) => {
            this.trace.event(
              'turn.memory_usage_recorded',
              {
                trace: input.traceId,
                conversationId:
                  input.conversationId,
                userMessageId:
                  userMessage.id,
                assistantMessageId:
                  assistantMessage.id,
                used: usage.used,
                memoryIds:
                  usedMemoryIds.join(','),
              },
            );
          })
          .catch((error) => {
            this.trace.warn(
              'turn.memory_usage_record_failed',
              {
                trace: input.traceId,
                conversationId:
                  input.conversationId,
                userMessageId:
                  userMessage.id,
                assistantMessageId:
                  assistantMessage.id,
                memoryIds:
                  usedMemoryIds.join(','),
                error:
                  error?.message ??
                  String(error),
              },
            );
          });
      }

      this.trace.event('chat.final_answer', {
        trace: input.traceId,
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        contentLen: content.length,
        citationCount: citations.length,
        objectCount: deliveredObjects.length,
        warningCount: warnings.length,
        reasonCodes:
          reasonCodes.join('|') || null,
      });

      this.responseWriter.closeTrace(input.traceId);
      this.responseWriter.clear(
        assistantMessage.id,
      );

      this.trace.debug(
        'turn.writer_buffer_cleared',
        {
          trace: input.traceId,
          assistantMessageId:
            assistantMessage.id,
        },
      );

      this.trace.event(
        'turn.post_turn_scheduled',
        {
          trace: input.traceId,
          conversationId:
            input.conversationId,
          userMessageId: userMessage.id,
          assistantMessageId:
            assistantMessage.id,
        },
      );

      void this.postTurn
        .afterTurn({
          traceId: input.traceId,
          userId: input.userId,
          agentId: input.agentId,
          conversationId:
            input.conversationId,
          userMessageId: userMessage.id,
          assistantMessageId:
            assistantMessage.id,
          userText: String(
            input.content ?? '',
          ),
          assistantText: content,
          reasonCodes,
          outcome,
        })
        .catch((error) => {
          this.logger.warn(
            `[ChatTurn] post_turn_failed trace=${input.traceId} ${
              error?.message ?? String(error)
            }`,
          );

          this.trace.warn(
            'turn.post_turn_failed',
            {
              trace: input.traceId,
              conversationId:
                input.conversationId,
              userMessageId:
                userMessage.id,
              assistantMessageId:
                assistantMessage.id,
              error:
                error?.message ??
                String(error),
            },
          );
        });

      this.trace.event('turn.done', {
        trace: input.traceId,
        conversationId: input.conversationId,
        assistantMessageId: assistantMessage.id,
        objectCount: deliveredObjects.length,
        warningCount: warnings.length,
        latencyMs: Date.now() - startedAt,
      });

      return {
        traceId: input.traceId,
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        content,
        citations,
        runtime,
        objects: deliveredObjects,
        warnings,
        reasonCodes,
        terminalStatus,
      };
    } catch (error: any) {
      const cancelled = input.abortSignal?.aborted === true || error?.name === 'AbortError';
      this.trace.error('turn.failed', {
        trace: input.traceId,
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        latencyMs: Date.now() - startedAt,
        error:
          error?.message ?? String(error),
      });

      await this.responseWriter
        .flushNow({
          messageId: assistantMessage.id,
          traceId: input.traceId,
          reason: 'before_fail',
        })
        .catch(() => undefined);

      const bufferedBeforeClear = this.responseWriter.read(assistantMessage.id);
      this.responseWriter.clear(
        assistantMessage.id,
      );

      this.responseWriter.closeTrace(input.traceId);

      if (cancelled) {
        const content = bufferedBeforeClear;
        await this.finalization.commitCancelled({
          traceId: input.traceId,
          conversationId: input.conversationId,
          assistantMessageId: assistantMessage.id,
          content,
          finalizationKey: `${input.traceId}:${assistantMessage.id}:cancelled`,
        });
        return {
          traceId: input.traceId,
          conversationId: input.conversationId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          content,
          citations: [],
          runtime: { cancelled: true },
          objects: [],
          warnings: [],
          reasonCodes: ['agent_turn:cancelled'],
          terminalStatus: 'cancelled',
        };
      }

      await this.finalization.commitUnhandledFailure({
        traceId: input.traceId,
        conversationId: input.conversationId,
        assistantMessageId: assistantMessage.id,
        errorMessage:
          error?.message ?? String(error),
        content:
          'This turn failed. Please try again later.',
        metadata: {
          presentation: {
            key: 'chat.message.turnFailed',
          },
        },
        finalizationKey: `${input.traceId}:${assistantMessage.id}:failed`,
      });

      throw error;
    }
  }

  private finalizationKey(
    traceId: string,
    assistantMessageId: string,
    status: string,
  ): string {
    return `${traceId}:${assistantMessageId}:${status}`;
  }

  private normalizeCitations(
    value: unknown,
  ): unknown[] {
    return Array.isArray(value)
      ? value
      : [];
  }

  private normalizeRuntime(
    value: unknown,
  ): Record<string, unknown> | null {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private normalizeObjects(
    value: unknown,
  ): ChatOutputObject[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const output: ChatOutputObject[] = [];
    const seen = new Set<string>();

    for (const item of value) {
      if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item)
      ) {
        continue;
      }

      const record =
        item as Record<string, unknown>;

      const objectId = String(
        record.objectId ?? '',
      ).trim();

      if (
        !objectId ||
        seen.has(objectId)
      ) {
        continue;
      }

      seen.add(objectId);

      output.push({
        ...record,
        objectId,
        role:
          record.role === 'assistant_output'
            ? 'assistant_output'
            : undefined,
        displayName:
          typeof record.displayName === 'string'
            ? record.displayName
            : null,
        originalName:
          typeof record.originalName === 'string'
            ? record.originalName
            : null,
        mimeType:
          typeof record.mimeType === 'string'
            ? record.mimeType
            : null,
        sizeBytes:
          typeof record.sizeBytes === 'number' &&
          Number.isFinite(record.sizeBytes)
            ? record.sizeBytes
            : null,
        versionNo:
          typeof record.versionNo === 'number' &&
          Number.isFinite(record.versionNo)
            ? record.versionNo
            : null,
        downloadUrl:
          typeof record.downloadUrl === 'string'
            ? record.downloadUrl
            : null,
      });
    }

    return output;
  }

  private async deliverProducedObjects(input: {
    userId: string;
    agentId: string;
    conversationId: string;
    assistantMessageId: string;
    objects: Array<Record<string, unknown>>;
  }) {
    const objectIds = [
      ...new Set(
        input.objects
          .map((value) => String(value?.objectId ?? '').trim())
          .filter(Boolean),
      ),
    ];

    if (objectIds.length === 0) {
      return [];
    }

    const insertedObjectIds = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.messageObjectLink.findMany({
        where: {
          messageId: input.assistantMessageId,
          role: 'ASSISTANT_OUTPUT',
        },
        select: {
          objectId: true,
          position: true,
        },
        orderBy: {
          position: 'asc',
        },
      });

      const existingIds = new Set(
        existing.map((row) => row.objectId),
      );
      const missing = objectIds.filter(
        (objectId) => !existingIds.has(objectId),
      );

      if (missing.length === 0) {
        return [] as string[];
      }

      let nextPosition = existing.reduce(
        (maximum, row) => Math.max(maximum, row.position),
        -1,
      ) + 1;

      await this.messageObjects.bindAssistantOutputs(tx, {
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        messageId: input.assistantMessageId,
        objects: missing.map((objectId) => ({
          objectId,
          position: nextPosition++,
        })),
      });

      return missing;
    });

    if (insertedObjectIds.length === 0) {
      return [];
    }

    const projected = await this.objectProjection.projectMessage({
      userId: input.userId,
      conversationId: input.conversationId,
      messageId: input.assistantMessageId,
    });

    this.trace.event('turn.objects_delivered', {
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      objectCount: projected.length,
      deliveredCount: insertedObjectIds.length,
    });

    const insertedIds = new Set(insertedObjectIds);
    return projected.filter((object) => insertedIds.has(object.objectId));
  }

  private normalizeWarnings(
    value: unknown,
  ): ChatOutputWarning[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const output: ChatOutputWarning[] = [];

    for (const item of value) {
      if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item)
      ) {
        continue;
      }

      const record =
        item as Record<string, unknown>;

      output.push({
        ...record,
        code:
          typeof record.code === 'string'
            ? record.code
            : undefined,
        message:
          typeof record.message === 'string'
            ? record.message
            : undefined,
      });
    }

    return output;
  }

  private toTurnMessageEnvelope(input: {
    message: {
      id: string;
      conversationId: string;
      parentMessageId?: string | null;
      rootMessageId?: string | null;
      branchId?: string | null;
      content?: unknown;
      timestamp?: Date | string | number | null;
      createdAt?: Date | string | number | null;
    };
    role: 'user' | 'agent';
    traceId: string;
    complete: boolean;
  }): ChatTurnMessageEnvelope {
    const timestamp =
      input.message.timestamp
      ?? input.message.createdAt
      ?? Date.now();
    const createdAt = timestamp instanceof Date
      ? timestamp.toISOString()
      : new Date(timestamp).toISOString();

    return {
      id: String(input.message.id),
      conversationId: String(input.message.conversationId),
      role: input.role,
      parentMessageId:
        input.message.parentMessageId
        ? String(input.message.parentMessageId)
        : null,
      rootMessageId:
        input.message.rootMessageId
        ? String(input.message.rootMessageId)
        : null,
      branchId:
        input.message.branchId
        ? String(input.message.branchId)
        : null,
      content: String(input.message.content ?? ''),
      createdAt,
      is_complete: input.complete,
      traceId: input.traceId,
    };
  }

  private normalizeReasonCodes(
    value: unknown,
  ): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const output: string[] = [];
    const seen = new Set<string>();

    for (const item of value) {
      const normalized = String(
        item ?? '',
      ).trim();

      if (
        !normalized ||
        seen.has(normalized)
      ) {
        continue;
      }

      seen.add(normalized);
      output.push(normalized);
    }

    return output;
  }

  private extractUsedMemoryIds(
    runtime: unknown,
  ): string[] {
    if (
      !runtime ||
      typeof runtime !== 'object'
    ) {
      return [];
    }

    const ids = new Set<string>();

    const visit = (
      value: unknown,
    ): void => {
      if (
        !value ||
        typeof value !== 'object'
      ) {
        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          visit(item);
        }

        return;
      }

      const record =
        value as Record<string, unknown>;

      const usedMemoryIds =
        record.usedMemoryIds;

      if (Array.isArray(usedMemoryIds)) {
        for (const id of usedMemoryIds) {
          const normalized =
            this.normalizeMemoryId(id);

          if (normalized) {
            ids.add(normalized);
          }
        }
      }

      const citations = record.citations;

      if (Array.isArray(citations)) {
        for (const citation of citations) {
          if (
            !citation ||
            typeof citation !== 'object'
          ) {
            continue;
          }

          const normalized =
            this.normalizeMemoryId(
              (
                citation as Record<
                  string,
                  unknown
                >
              ).memoryId,
            );

          if (normalized) {
            ids.add(normalized);
          }
        }
      }

      for (const child of Object.values(
        record,
      )) {
        visit(child);
      }
    };

    visit(runtime);

    return Array.from(ids);
  }

  private normalizeMemoryId(
    value: unknown,
  ): string | null {
    const text = String(
      value ?? '',
    ).trim();

    return text || null;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('CHAT_TURN_CANCELLED');
  error.name = 'AbortError';
  throw error;
}
