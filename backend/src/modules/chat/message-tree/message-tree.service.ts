                                                                

import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ChatConversationRepository } from '../persistence/chat-conversation.repository';
import { ChatMessageRepository } from '../persistence/chat-message.repository';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';
import type {
  CreateAssistantShellInput,
  CreateUserMessageInput,
  MessageBranch,
  ResolveUserMessageContextInput,
  UserMessageCreateContext,
} from './message-tree.types';

@Injectable()
export class MessageTreeService {
  constructor(
    private readonly conversations: ChatConversationRepository,
    private readonly messages: ChatMessageRepository,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {}

  async resolveCreateContext(
    tx: Prisma.TransactionClient,
    input: ResolveUserMessageContextInput,
  ): Promise<UserMessageCreateContext> {
    const conversation = await this.conversations.assertUserAccess({
      userId: input.userId,
      conversationId: input.conversationId,
      tx,
    });

    const currentLeafMessageId = (conversation as any).currentLeafMessageId ?? null;
    const conversationMeta = this.record((conversation as any).meta);
    const taskBoundaryReset = conversationMeta.nextTurnStartsNewRoot === true;
    if (taskBoundaryReset) {
      const { nextTurnStartsNewRoot: _reset, detachedWorkflowId: _workflow, ...remainingMeta } = conversationMeta;
      await (tx as any).conversation.update({
        where: { id: input.conversationId },
        data: { meta: remainingMeta },
      });
    }
    const workspaceId =
      this.normalizedWorkspaceId(
        input.workspaceId,
      );

    const currentLeaf =
      currentLeafMessageId
        ? await this.messages.findById(
            currentLeafMessageId,
            tx,
          )
        : null;
    const previousWorkspace =
      await this.resolveWorkspaceSnapshot(
        tx,
        currentLeaf,
      );
    const previousWorkspaceId =
      previousWorkspace.workspaceId;
    const workspaceChanged =
      previousWorkspace.known
      && previousWorkspaceId
        !== workspaceId;

    const parentMessageId =
      taskBoundaryReset
        ? null
        : input.requestedParentMessageId
          ?? currentLeafMessageId
          ?? null;
    const workspaceResumed = false;

    const parent =
      parentMessageId
        ? parentMessageId
            === currentLeafMessageId
          ? currentLeaf
          : await this.messages.findById(
              parentMessageId,
              tx,
            )
        : null;

    if (parent && String((parent as any).conversationId) !== input.conversationId) {
      throw new BadRequestException({ code: 'MESSAGE_PARENT_CROSS_CONVERSATION', message: 'MESSAGE_PARENT_CROSS_CONVERSATION' });
    }

    const rootMessageId = (parent as any)?.rootMessageId
      ?? parent?.id
      ?? input.clientMessageId
      ?? null;
    const branchId = (parent as any)?.branchId
      ?? rootMessageId
      ?? input.clientMessageId
      ?? input.traceId;

    const contextBoundary =
      taskBoundaryReset;

    this.trace.event('message_tree.resolve_create_context', {
      trace: input.traceId,
      userId: input.userId,
      conversationId: input.conversationId,
      requestedParentMessageId: input.requestedParentMessageId ?? null,
      currentLeafMessageId,
      parentMessageId,
      rootMessageId,
      branchId,
      parentFound: Boolean(parent),
      taskBoundaryReset,
      contextBoundary,
      workspaceId,
      previousWorkspaceId,
      workspaceChanged,
      workspaceResumed,
    });

    return {
      parentMessageId,
      rootMessageId,
      branchId,
      taskBoundaryReset,
      contextBoundary,
      workspaceId,
      previousWorkspaceId,
      workspaceChanged,
      workspaceResumed,
    };
  }

  async createUserNode(
    tx: Prisma.TransactionClient,
    input: CreateUserMessageInput,
    context: UserMessageCreateContext,
  ) {
    this.trace.event('message_tree.create_user_start', {
      trace: input.traceId,
      conversationId: input.conversationId,
      userId: input.userId,
      agentId: input.agentId,
      clientMessageId: input.clientMessageId ?? null,
      parentMessageId: context.parentMessageId,
      rootMessageId: context.rootMessageId,
      branchId: context.branchId,
      contentLen: input.content.length,
    });

    const message = await this.messages.createUserMessage({
      id: input.clientMessageId ?? undefined,
      conversationId: input.conversationId,
      parentMessageId: context.parentMessageId,
      rootMessageId: context.rootMessageId,
      branchId: context.branchId,
      userId: input.userId,
      agentId: input.agentId,
      content: input.content,
      traceId: input.traceId,
      meta: {
        turnContext: {
          version: 1,
          workspaceId: context.workspaceId,
          contextBoundary: context.contextBoundary,
          contextBoundaryReason:
            context.taskBoundaryReset
              ? 'task_reset'
              : null,
        },
      },
      tx,
    });

    await this.conversations.bumpMessageCount({
      conversationId: input.conversationId,
      tx,
    });
    await this.conversations.setCurrentLeaf({
      conversationId: input.conversationId,
      leafMessageId: message.id,
      tx,
    });

    this.trace.event('message_tree.user_created', {
      trace: input.traceId,
      conversationId: input.conversationId,
      messageId: message.id,
      parentMessageId: message.parentMessageId ?? null,
      rootMessageId: (message as any).rootMessageId ?? null,
      branchId: (message as any).branchId ?? null,
      contentLen: String(message.content ?? '').length,
    });

    return message;
  }

  async createAssistantShell(input: CreateAssistantShellInput) {
    const userMessage = await this.messages.findById(input.parentMessageId);
    const rootMessageId = (userMessage as any)?.rootMessageId ?? userMessage?.id ?? input.parentMessageId;
    const branchId = (userMessage as any)?.branchId ?? rootMessageId ?? input.traceId;

    this.trace.event('message_tree.create_assistant_shell_start', {
      trace: input.traceId,
      conversationId: input.conversationId,
      parentUserMessageId: input.parentMessageId,
      rootMessageId,
      branchId,
      model: input.model ?? null,
      endpoint: input.endpoint ?? null,
      parentFound: Boolean(userMessage),
    });

    const message = await this.messages.createAssistantShell({
      conversationId: input.conversationId,
      parentMessageId: input.parentMessageId,
      rootMessageId,
      branchId,
      agentId: input.agentId,
      traceId: input.traceId,
      model: input.model ?? null,
      endpoint: input.endpoint ?? null,
      meta: {
        turnContext: {
          ...this.turnContextMeta((userMessage as any)?.meta),
          contextBoundary: false,
        },
      },
    });

    await this.conversations.bumpMessageCount({ conversationId: input.conversationId });

    this.trace.event('message_tree.assistant_shell_created', {
      trace: input.traceId,
      conversationId: input.conversationId,
      assistantMessageId: message.id,
      parentMessageId: message.parentMessageId ?? null,
      rootMessageId: (message as any).rootMessageId ?? null,
      branchId: (message as any).branchId ?? null,
      status: (message as any).status ?? null,
      unfinished: (message as any).unfinished ?? null,
    });

    return message;
  }

  async loadBranch(input: {
    conversationId: string;
    leafMessageId: string | null;
    limit?: number;
  }): Promise<MessageBranch> {
    if (!input.leafMessageId) {
      this.trace.event('message_tree.load_branch_empty_leaf', {
        conversationId: input.conversationId,
        leafMessageId: null,
      });

      return {
        conversationId: input.conversationId,
        leafMessageId: null,
        messages: [],
      };
    }

    const rows = await this.messages.listActiveByConversation(input.conversationId);
    const byId = new Map(rows.map((message: any) => [String(message.id), message]));

    const branch: any[] = [];
    const visited = new Set<string>();
    let cursor: any = byId.get(input.leafMessageId);
    let cycleDetected = false;

    while (cursor) {
      const cursorId = String(cursor.id);

      if (visited.has(cursorId)) {
        cycleDetected = true;
        break;
      }

      visited.add(cursorId);
      branch.push(cursor);

      if (!cursor.parentMessageId) break;

      cursor = byId.get(String(cursor.parentMessageId));
    }

    const ordered = branch.reverse();
    const limited = input.limit && input.limit > 0 ? ordered.slice(-input.limit) : ordered;

    this.trace.event('message_tree.load_branch_done', {
      conversationId: input.conversationId,
      leafMessageId: input.leafMessageId,
      totalRows: rows.length,
      branchCount: ordered.length,
      returnedCount: limited.length,
      limit: input.limit ?? null,
      cycleDetected,
      leafFound: byId.has(input.leafMessageId),
      firstMessageId: limited[0]?.id ?? null,
      lastMessageId: limited[limited.length - 1]?.id ?? null,
      runtimeMetaCount: limited.filter((message: any) => this.hasRuntimeMeta(message.meta)).length,
      citationMessageCount: limited.filter((message: any) => Array.isArray(message.citations) && message.citations.length > 0).length,
    });

    return {
      conversationId: input.conversationId,
      leafMessageId: input.leafMessageId,
      messages: limited.map((message: any) => ({
        id: message.id,
        conversationId: message.conversationId,
        parentMessageId: message.parentMessageId ?? null,
        rootMessageId: message.rootMessageId ?? null,
        branchId: message.branchId ?? null,
        role: String(message.role),
        content: String(message.content ?? ''),
        citations: Array.isArray(message.citations) ? message.citations : null,
        meta:
          message.meta && typeof message.meta === 'object' && !Array.isArray(message.meta)
            ? message.meta
            : null,
        createdAt: message.timestamp ?? message.createdAt ?? new Date(),
      })),
    };
  }

  async finalizeAssistant(input: {
    conversationId: string;
    assistantMessageId: string;
    content: string;
    citations?: unknown[] | null;
    meta?: Record<string, unknown> | null;
    finishReason?: string | null;
  }) {
    this.trace.event('message_tree.finalize_assistant_start', {
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      contentLen: input.content.length,
      citationCount: Array.isArray(input.citations) ? input.citations.length : 0,
      hasMeta: Boolean(input.meta && Object.keys(input.meta).length),
      finishReason: input.finishReason ?? 'stop',
    });

    const message = await this.messages.finalizeAssistant({
      messageId: input.assistantMessageId,
      content: input.content,
      citations: input.citations ?? null,
      meta: input.meta ?? {},
      finishReason: input.finishReason ?? 'stop',
    });

    await this.conversations.setCurrentLeaf({
      conversationId: input.conversationId,
      leafMessageId: input.assistantMessageId,
    });

    this.trace.event('message_tree.finalize_assistant_done', {
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      currentLeafMessageId: input.assistantMessageId,
      status: (message as any).status ?? null,
      unfinished: (message as any).unfinished ?? null,
      error: (message as any).error ?? null,
      contentLen: String((message as any).content ?? '').length,
    });

    return message;
  }

  failAssistant(input: { assistantMessageId: string; errorMessage: string; content?: string }) {
    this.trace.error('message_tree.fail_assistant', {
      assistantMessageId: input.assistantMessageId,
      errorMessage: input.errorMessage,
      contentLen: input.content?.length ?? 0,
    });

    return this.messages.failAssistant({
      messageId: input.assistantMessageId,
      errorMessage: input.errorMessage,
      content: input.content,
    });
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }


  private normalizedWorkspaceId(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private turnContextMeta(value: unknown): Record<string, unknown> {
    const meta = this.record(value);
    const turnContext = this.record(meta.turnContext);
    return {
      version: 1,
      workspaceId: this.normalizedWorkspaceId(turnContext.workspaceId),
      contextBoundary: turnContext.contextBoundary === true,
    };
  }

  private workspaceSnapshotFromMeta(
    value: unknown,
  ): {
    known: boolean;
    workspaceId: string | null;
  } {
    const meta = this.record(value);
    if (!Object.prototype.hasOwnProperty.call(meta, 'turnContext')) {
      return {
        known: false,
        workspaceId: null,
      };
    }
    const turnContext = this.record(meta.turnContext);
    return {
      known: Object.prototype.hasOwnProperty.call(
        turnContext,
        'workspaceId',
      ),
      workspaceId:
        this.normalizedWorkspaceId(
          turnContext.workspaceId,
        ),
    };
  }

  private async resolveWorkspaceSnapshot(
    tx: Prisma.TransactionClient,
    message: any,
  ): Promise<{
    known: boolean;
    workspaceId: string | null;
  }> {
    if (!message) {
      return {
        known: false,
        workspaceId: null,
      };
    }

    const fromMeta =
      this.workspaceSnapshotFromMeta(
        message.meta,
      );
    if (fromMeta.known) {
      return fromMeta;
    }

    const traceId =
      String(message.traceId ?? '').trim();
    if (!traceId) {
      return fromMeta;
    }

    const turn =
      await (tx as any).agentTurn.findUnique({
        where: { traceId },
        select: {
          workspaceId: true,
        },
      });
    return turn
      ? {
          known: true,
          workspaceId:
            this.normalizedWorkspaceId(
              turn.workspaceId,
            ),
        }
      : fromMeta;
  }

  private hasRuntimeMeta(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Boolean((value as Record<string, unknown>).runtime);
  }
}