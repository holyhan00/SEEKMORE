                                                                  
import { Injectable } from '@nestjs/common';
import { MessageRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';

export type MessageStatus = 'queued' | 'streaming' | 'finished' | 'failed' | 'canceled';

@Injectable()
export class ChatMessageRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {}

  async createUserMessage(input: {
    id?: string;
    conversationId: string;
    parentMessageId: string | null;
    rootMessageId: string | null;
    branchId: string;
    userId: string;
    agentId: string;
    content: string;
    traceId: string;
    meta?: Record<string, unknown> | null;
    tx?: Prisma.TransactionClient;
  }) {
    this.trace.debug('repo.message.create_user_start', {
      trace: input.traceId,
      conversationId: input.conversationId,
      messageId: input.id ?? null,
      parentMessageId: input.parentMessageId,
      rootMessageId: input.rootMessageId,
      branchId: input.branchId,
      contentLen: input.content.length,
    });
    const client = input.tx ?? this.prisma;
    const message = await client.message.create({
      data: {
        id: input.id,
        conversationId: input.conversationId,
        parentMessageId: input.parentMessageId,
        rootMessageId: input.rootMessageId,
        branchId: input.branchId,
        role: MessageRole.USER,
        content: input.content,
        traceId: input.traceId,
        senderType: 'USER',
        senderUserId: input.userId,
        senderAgentId: null,
        status: 'finished',
        unfinished: false,
        error: false,
        meta: (input.meta ?? {}) as Prisma.InputJsonObject,
      },
    } as any);
    this.trace.debug('repo.message.create_user_done', {
      trace: input.traceId,
      conversationId: input.conversationId,
      messageId: message.id,
      parentMessageId: message.parentMessageId ?? null,
      status: (message as any).status ?? null,
    });
    return message;
  }

  async createAssistantShell(input: {
    id?: string;
    conversationId: string;
    parentMessageId: string;
    rootMessageId: string | null;
    branchId: string;
    agentId: string;
    traceId: string;
    model?: string | null;
    endpoint?: string | null;
    meta?: Record<string, unknown> | null;
    tx?: Prisma.TransactionClient;
  }) {
    this.trace.debug('repo.message.create_assistant_shell_start', {
      trace: input.traceId,
      conversationId: input.conversationId,
      parentMessageId: input.parentMessageId,
      rootMessageId: input.rootMessageId,
      branchId: input.branchId,
      model: input.model ?? null,
      endpoint: input.endpoint ?? null,
    });
    const client = input.tx ?? this.prisma;
    const existing = await client.message.findFirst({ where: { conversationId: input.conversationId, parentMessageId: input.parentMessageId, traceId: input.traceId, role: MessageRole.ASSISTANT, deletedAt: null }, orderBy: { timestamp: 'asc' } } as any);
    if (existing) return existing;
    const message = await client.message.create({
      data: {
        id: input.id,
        conversationId: input.conversationId,
        parentMessageId: input.parentMessageId,
        rootMessageId: input.rootMessageId,
        branchId: input.branchId,
        role: MessageRole.ASSISTANT,
        content: '',
        traceId: input.traceId,
        senderType: 'AGENT',
        senderUserId: null,
        senderAgentId: input.agentId,
        model: input.model ?? null,
        endpoint: input.endpoint ?? null,
        status: 'streaming',
        unfinished: true,
        error: false,
        meta: (input.meta ?? {}) as Prisma.InputJsonObject,
      },
    } as any);
    this.trace.debug('repo.message.create_assistant_shell_done', {
      trace: input.traceId,
      conversationId: input.conversationId,
      messageId: message.id,
      parentMessageId: message.parentMessageId ?? null,
      status: (message as any).status ?? null,
      unfinished: (message as any).unfinished ?? null,
    });
    return message;
  }

  async findById(messageId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const message = await client.message.findUnique({ where: { id: messageId } } as any);
    this.trace.debug('repo.message.find_by_id', {
      messageId,
      found: Boolean(message),
      conversationId: (message as any)?.conversationId ?? null,
      parentMessageId: (message as any)?.parentMessageId ?? null,
      role: (message as any)?.role ?? null,
      contentLen: message ? String((message as any).content ?? '').length : 0,
    });
    return message;
  }

  async listActiveByConversation(conversationId: string) {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      orderBy: { timestamp: 'asc' },
    } as any);
    const messages = await this.reconcileLegacyAssistantRows(rows as any[]);
    this.trace.debug('repo.message.list_active_by_conversation', {
      conversationId,
      count: messages.length,
      firstMessageId: (messages as any[])[0]?.id ?? null,
      lastMessageId: (messages as any[])[messages.length - 1]?.id ?? null,
    });
    return messages;
  }

  appendAssistantContent(input: { messageId: string; chunk: string }) {
    this.trace.debug('repo.message.append_assistant_content', {
      messageId: input.messageId,
      chunkLen: input.chunk.length,
    });
    return this.prisma.message.update({
      where: { id: input.messageId },
      data: { content: { append: input.chunk } as any },
    } as any);
  }

  async updateAssistantContent(input: { messageId: string; content: string }) {
    this.trace.debug('repo.message.update_assistant_content_start', {
      messageId: input.messageId,
      contentLen: input.content.length,
    });
    const message = await this.prisma.message.update({
      where: { id: input.messageId },
      data: { content: input.content },
    } as any);
    this.trace.debug('repo.message.update_assistant_content_done', {
      messageId: input.messageId,
      persistedLen: String((message as any).content ?? '').length,
      status: (message as any).status ?? null,
    });
    return message;
  }

  async finalizeAssistant(input: {
    messageId: string;
    content: string;
    citations?: unknown[] | null;
    meta?: Record<string, unknown> | null;
    finishReason?: string | null;
  }) {
    this.trace.event('repo.message.finalize_assistant_start', {
      messageId: input.messageId,
      contentLen: input.content.length,
      citationCount: Array.isArray(input.citations) ? input.citations.length : 0,
      finishReason: input.finishReason ?? 'stop',
      metaKeys: Object.keys(input.meta ?? {}).join(','),
    });
    const message = await this.prisma.message.update({
      where: { id: input.messageId },
      data: {
        content: input.content,
        status: 'finished',
        unfinished: false,
        error: false,
        finishReason: input.finishReason ?? 'stop',
        citations: input.citations == null ? Prisma.JsonNull : (input.citations as any),
        meta: (input.meta ?? {}) as Prisma.InputJsonObject,
      },
    } as any);
    this.trace.event('repo.message.finalize_assistant_done', {
      messageId: input.messageId,
      status: (message as any).status ?? null,
      unfinished: (message as any).unfinished ?? null,
      error: (message as any).error ?? null,
      contentLen: String((message as any).content ?? '').length,
    });
    return message;
  }

  failAssistant(input: { messageId: string; errorMessage: string; content?: string }) {
    this.trace.error('repo.message.fail_assistant', {
      messageId: input.messageId,
      errorMessage: input.errorMessage,
      contentLen: input.content?.length ?? 0,
    });
    return this.prisma.message.update({
      where: { id: input.messageId },
      data: {
        content: input.content ?? '',
        status: 'failed',
        unfinished: false,
        error: true,
        finishReason: 'error',
        meta: { errorMessage: input.errorMessage },
      },
    } as any);
  }

  private async reconcileLegacyAssistantRows(rows: any[]): Promise<any[]> {
    const grouped = new Map<string, any[]>();
    for (const row of rows) {
      if (String(row.role) !== String(MessageRole.ASSISTANT)) continue;
      const key = `${row.parentMessageId ?? ''}:${row.traceId ?? ''}`;
      const list = grouped.get(key) ?? []; list.push(row); grouped.set(key, list);
    }
    const removed = new Set<string>();
    for (const group of grouped.values()) {
      if (group.length < 2) continue;
      const owner = group.find((item) => String(item.content ?? '').trim()) ?? group[0];
      for (const duplicate of group) {
        if (duplicate.id === owner.id) continue;
        const ownerMeta = owner.meta && typeof owner.meta === 'object' && !Array.isArray(owner.meta) ? owner.meta : {};
        const duplicateMeta = duplicate.meta && typeof duplicate.meta === 'object' && !Array.isArray(duplicate.meta) ? duplicate.meta : {};
        const mergedMeta = { ...duplicateMeta, ...ownerMeta, runtime: ownerMeta.runtime ?? duplicateMeta.runtime ?? null };
        owner.meta = mergedMeta;
        if (!String(owner.content ?? '').trim() && String(duplicate.content ?? '').trim()) owner.content = duplicate.content;
        await this.prisma.message.update({ where: { id: owner.id }, data: { content: owner.content, meta: mergedMeta as Prisma.InputJsonObject } } as any);
        await this.prisma.message.update({ where: { id: duplicate.id }, data: { deletedAt: new Date() } } as any);
        removed.add(String(duplicate.id));
      }
    }
    return rows.filter((row) => !removed.has(String(row.id)));
  }

}
