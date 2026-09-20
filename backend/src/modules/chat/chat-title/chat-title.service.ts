                                                            

import {
  Injectable, ForbiddenException, NotFoundException, Logger, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { LLMClientService } from '../../llm/llm-client.service';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVT_CHAT_TITLE_CREATED, EVT_CHAT_TITLE_UPDATED } from '../types/chat.events';

import { MessageRole } from '@prisma/client';

type CreateParams = { userId: string; agentId: string; firstMessage: string };
type RenameParams = { conversationId: string; userId: string; title: string; titleVersion?: number };
type ListParams = { userId: string; agentId: string; cursor?: string | null; limit?: number };
type SearchParams = { userId: string; query: string; limit?: number };
type OneParams = { conversationId: string; userId: string };

type EnsureTitleParams = {
  conversationId: string;
  userId?: string | null;
};

const isPlaceholderTitle = (value: unknown): boolean => !String(value ?? '').trim();

@Injectable()
export class ChatTitleService {
  private readonly logger = new Logger(ChatTitleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LLMClientService,
    private readonly eventBus: EventEmitter2,
  ) {}

  private normalizeTitle(raw: string): string {
    const t = (raw || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[\"'“”‘’。、，,.!?！？：:;；]+$/g, '');
    return Array.from(t).slice(0, 48).join('');
  }

  private fallbackTitleFrom(firstMessage: string) {
    const text = String(firstMessage ?? '').trim();
    return this.normalizeTitle(text);
  }

  private async generateTitleFromFirstMessage(userId: string, firstMessage: string): Promise<string> {
    this.logger.debug(`[TitleGen] start, first="${(firstMessage || '').slice(0, 30)}..."`);
    const rule = this.fallbackTitleFrom(firstMessage);

    if (!firstMessage?.trim()) {
      this.logger.debug(`[TitleGen] empty first message → use fallback="${rule}"`);
      return rule;
    }

    const prompt = [
      'Generate a concise conversation-list title for the user message below.',
      '- Use the same natural language as the user message unless the user explicitly requests another title language.',
      '- Keep it short (roughly 30–48 Unicode characters at most).',
      '- Prefer a noun phrase or a concise action phrase.',
      '- Do not add terminal punctuation, quotation marks, emoji, labels, or explanations.',
      '',
      `User message: ${firstMessage}`,
    ].join('\n');

    const requestId = uuidv4();
    const controller = new AbortController();
    const chunks: string[] = [];
    const TIMEOUT_MS = 8000;
    let timeout: NodeJS.Timeout | null = null;

    try {
      await new Promise<void>((resolve, reject) => {
        if (TIMEOUT_MS > 0) {
          timeout = setTimeout(() => {
            try { controller.abort(); } catch {}
            this.logger.warn(`[TitleGen] stream timeout, req=${requestId}`);
            resolve();
          }, TIMEOUT_MS);
        }

        this.llm.stream({
          requestId,
          userId,
          userMessage: prompt,
          controller,
          agentId: undefined,
          systemPrompt: 'Return only a concise title in the appropriate user language. Do not explain your answer.',
          temperature: 0.2,
          thinking: { enabled: false, type: 'disabled' },
          callbacks: {
            onDelta: (chunk: string) => { if (chunk) chunks.push(chunk); },
            onDone: () => resolve(),
            onError: ({ code, message }) => reject(new Error(message || code || 'STREAM_ERROR')),
          },
        });
      });
    } catch (err: any) {
      this.logger.warn(`LLM title generation failed; using deterministic fallback: ${err?.message || err}`);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const text = this.normalizeTitle(chunks.join(''));
    const finalTitle = text || rule;
    this.logger.debug(`[TitleGen] result="${finalTitle}"`);
    return finalTitle;
  }

  private async assertAgentAccessible(userId: string, agentId: string) {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, userId: true } });
    if (!agent) throw new NotFoundException('AGENT_NOT_FOUND');
    if (agent.userId === userId) return;

    const access = await this.prisma.userAgent.findUnique({
      where: { agentId_userId: { agentId, userId } },
      select: { accessLevel: true },
    });

    if (!access) throw new ForbiddenException('AGENT_ACCESS_DENIED');
  }

                    
  async createConversationWithTitle(params: CreateParams) {
    const { userId, agentId, firstMessage } = params;
    await this.assertAgentAccessible(userId, agentId);

    const title = await this.generateTitleFromFirstMessage(userId, firstMessage);
    const now = new Date();

    const conv = await this.prisma.conversation.create({
      data: {
        userId, agentId, title,
        titleVersion: 1,
        titleUpdatedAt: now,
        lastMessageAt: now,
        messageCount: 0,
      },
      select: {
        id: true, title: true, agentId: true, createdAt: true, userId: true,
        titleVersion: true, titleUpdatedAt: true,
      },
    });

    this.logger.log(`Conversation created: ${conv.id} by ${userId} under agent ${agentId}`);

    this.eventBus.emit(EVT_CHAT_TITLE_CREATED, {
      userId,
      agentId,
      conversationId: conv.id,
      title: conv.title,
      titleVersion: conv.titleVersion,
      titleUpdatedAt: conv.titleUpdatedAt,
    });

    return conv;
  }

  async rename(params: RenameParams) {
    const { conversationId, userId, title, titleVersion } = params;

    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true, agentId: true, titleVersion: true },
    });

    if (!conv) throw new NotFoundException('CONVERSATION_NOT_FOUND');
    if (conv.userId !== userId) throw new ForbiddenException('CONVERSATION_UPDATE_FORBIDDEN');

    const normalized = this.normalizeTitle(title);

    if (typeof titleVersion === 'number' && titleVersion !== conv.titleVersion) {
      throw new ConflictException('CONVERSATION_TITLE_VERSION_CONFLICT');
    }

    const now = new Date();
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        title: normalized,
        titleVersion: { increment: 1 },
        titleUpdatedAt: now,
      },
      select: {
        id: true, title: true, titleVersion: true, titleUpdatedAt: true,
        userId: true, agentId: true,
      },
    });

    this.logger.log(`Conversation renamed: ${updated.id}`);

    this.eventBus.emit(EVT_CHAT_TITLE_UPDATED, {
      userId: updated.userId,
      agentId: updated.agentId,
      conversationId,
      title: updated.title,
      titleVersion: updated.titleVersion,
      titleUpdatedAt: updated.titleUpdatedAt,
    });

    return updated;
  }

  async listByAgent(params: ListParams) {
    const { userId, agentId, cursor, limit = 20 } = params;
    await this.assertAgentAccessible(userId, agentId);

    const where = { userId, agentId, isArchived: false, deletedAt: null as Date | null };
    const take = Math.min(Math.max(limit, 1), 100);

    const findArgs: any = {
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: take + 1,
      select: {
        id: true, title: true, createdAt: true, lastMessageAt: true, messageCount: true,
        titleVersion: true, titleUpdatedAt: true,
      },
    };

    if (cursor) {
      findArgs.cursor = { id: cursor };
      findArgs.skip = 1;
    }

    const rows = await this.prisma.conversation.findMany(findArgs);
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor };
  }


  async search(params: SearchParams) {
    const query = String(params.query ?? '').trim();
    if (!query) {
      return { items: [] };
    }

    const take = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const items = await this.prisma.conversation.findMany({
      where: {
        userId: params.userId,
        isArchived: false,
        deletedAt: null,
        title: {
          contains: query,
          mode: 'insensitive',
        },
      },
      orderBy: [
        { lastMessageAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take,
      select: {
        id: true,
        agentId: true,
        title: true,
        createdAt: true,
        lastMessageAt: true,
      },
    });

    return { items };
  }

  async getOne(params: OneParams) {
    const { conversationId, userId } = params;

    this.logger.debug(`[TitleDebug] getOne() called`, { conversationId, userId });

    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true, userId: true, agentId: true, title: true,
        titleVersion: true, titleUpdatedAt: true, createdAt: true,
        updatedAt: true, isArchived: true, deletedAt: true,
      },
    });

    if (!conv) throw new NotFoundException('CONVERSATION_NOT_FOUND');
    if (conv.userId !== userId) throw new ForbiddenException('CONVERSATION_ACCESS_DENIED');

    this.logger.debug(`[TitleDebug] getOne success`, { conversationId: conv.id, title: conv.title });
    return conv;
  }

  async touchOnMessageAppended(conversationId: string) {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
      select: { id: true },
    });
  }

                                  
  async ensureTitleFromDB(input: string | EnsureTitleParams) {
    const conversationId =
      typeof input === 'string'
        ? String(input ?? '').trim()
        : String(input?.conversationId ?? '').trim();

    const requestedUserId =
      typeof input === 'string'
        ? null
        : String(input?.userId ?? '').trim() || null;

    this.logger.debug(`[TitleEnsureDB] called conv=${conversationId}`);

    if (!conversationId) {
      return { updated: false as const, reason: 'NO_CONVERSATION_ID' as const };
    }

    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        userId: true,
        agentId: true,
        title: true,
        titleVersion: true,
        titleUpdatedAt: true,
        deletedAt: true,
      },
    });

    if (!conv) return { updated: false as const, reason: 'NOT_FOUND' as const };
    if (conv.deletedAt) return { updated: false as const, reason: 'DELETED' as const };

       
                             
                                     
       
    if (requestedUserId && conv.userId !== requestedUserId) {
      throw new ForbiddenException('CONVERSATION_ACCESS_DENIED');
    }

       
                    
                               
       
    if (!isPlaceholderTitle(conv.title)) {
      return { updated: false as const, reason: 'SKIP_PLACEHOLDER' as const };
    }

    const firstUserMsg = await this.prisma.message.findFirst({
      where: {
        conversationId,
        role: MessageRole.USER,
      },
      orderBy: {
        timestamp: 'asc',
      },
      select: {
        content: true,
      },
    });

    const firstContent = firstUserMsg?.content?.trim() || '';

    if (!firstContent) {
      return { updated: false as const, reason: 'NO_FIRST_USER_MESSAGE' as const };
    }

    const title = await this.generateTitleFromFirstMessage(conv.userId, firstContent);
    const now = new Date();

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        title,
        titleVersion: { increment: 1 },
        titleUpdatedAt: now,
      },
      select: {
        id: true,
        userId: true,
        agentId: true,
        title: true,
        titleVersion: true,
        titleUpdatedAt: true,
      },
    });

    this.logger.log(`[TitleEnsureDB] ✅ updated conv=${conversationId} -> "${title}"`);

    this.eventBus.emit(EVT_CHAT_TITLE_UPDATED, {
      userId: updated.userId,
      agentId: updated.agentId,
      conversationId: updated.id,
      title: updated.title,
      titleVersion: updated.titleVersion,
      titleUpdatedAt: updated.titleUpdatedAt,
    });

    return {
      updated: true as const,
      title,
      conversation: updated,
    };
  }

                               
  async previewFromText(userId: string, text: string): Promise<string> {
    const clean = (text || '').trim();
    if (!clean) return this.fallbackTitleFrom('');
    return this.generateTitleFromFirstMessage(userId, clean);
  }
}
