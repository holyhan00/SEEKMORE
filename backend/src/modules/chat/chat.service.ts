                                           
import { ForbiddenException, Injectable } from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import { MessageTreeService } from './message-tree/message-tree.service';
import { ChatObjectProjectionService } from './object-projection/chat-object-projection.service';
import { ChatConversationRepository } from './persistence/chat-conversation.repository';
import { ChatMessageRepository } from './persistence/chat-message.repository';

@Injectable()
export class ChatService {
  constructor(
    private readonly conversations: ChatConversationRepository,
    private readonly messages: ChatMessageRepository,
    private readonly messageTree: MessageTreeService,
    private readonly objectProjection: ChatObjectProjectionService,
  ) {}

  getOrCreateConversation(userId: string, agentId: string) {
    return this.conversations.getOrCreate({ userId, agentId });
  }

  async getMessagesByConversation(userId: string, conversationId: string) {
    const conversation = await this.conversations.assertUserAccess({ userId, conversationId });
    const allRows = await this.messages.listActiveByConversation(conversationId);
    const rows = selectCurrentBranchRows(
      allRows,
      String((conversation as any).currentLeafMessageId ?? '').trim() || null,
    );

    return this.mapMessages({
      userId,
      conversationId,
      conversation,
      rows,
    });
  }

  async getBootstrapMessages(
    userId: string,
    conversationId: string,
    activeAssistantMessageId: string | null,
  ) {
    const conversation = await this.conversations.assertUserAccess({ userId, conversationId });
    const allRows = await this.messages.listActiveByConversation(conversationId);
    const branchRows = selectCurrentBranchRows(
      allRows,
      String((conversation as any).currentLeafMessageId ?? '').trim() || null,
    );
    const rows = includeActiveAssistantShell(
      branchRows,
      allRows,
      activeAssistantMessageId,
    );

    return this.mapMessages({
      userId,
      conversationId,
      conversation,
      rows,
    });
  }

  private async mapMessages(input: {
    userId: string;
    conversationId: string;
    conversation: unknown;
    rows: any[];
  }) {
    const {
      userId,
      conversationId,
      conversation,
      rows,
    } = input;
    const objectsByMessage = await this.objectProjection.projectMessages({
      userId,
      conversationId,
      messageIds: rows.map((message: any) => String(message.id)),
    });

    return rows.map((message: any) => {
      const senderType =
        message.senderType
        ?? (message.role === MessageRole.USER
          ? 'USER'
          : message.role === MessageRole.SYSTEM
            ? 'SYSTEM'
            : 'AGENT');
      const senderUserId =
        message.senderUserId
        ?? (senderType === 'USER' && message.role === MessageRole.USER ? userId : null);
      const senderAgentId =
        message.senderAgentId
        ?? (senderType === 'AGENT' ? (conversation as any).agentId ?? null : null);

      const meta = message?.meta && typeof message.meta === 'object' && !Array.isArray(message.meta)
        ? message.meta as Record<string, unknown>
        : {};

      return {
        ...message,
        runtime: meta.runtime ?? null,
        metadata: meta.metadata ?? null,
        reasonCodes: Array.isArray(meta.reasonCodes) ? meta.reasonCodes : [],
        objects: objectsByMessage.get(String(message.id)) ?? [],
        is_complete: isMessageComplete(message),
        isMe: senderType === 'USER' && senderUserId === userId,
        isSystem: message.role === MessageRole.SYSTEM,
        senderType,
        senderUserId,
        senderAgentId,
      };
    });
  }

  async loadCurrentBranch(userId: string, conversationId: string) {
    const conversation = await this.conversations.assertUserAccess({ userId, conversationId });
    return this.messageTree.loadBranch({
      conversationId,
      leafMessageId: (conversation as any).currentLeafMessageId ?? null,
    });
  }

  async getMessageContent(messageId: string): Promise<string> {
    const row = await this.messages.findById(messageId);
    return String((row as any)?.content ?? '');
  }

  async createMessage(): Promise<never> {
    throw new ForbiddenException({ code: 'CHAT_LEGACY_CREATE_MESSAGE_DISABLED', message: 'CHAT_LEGACY_CREATE_MESSAGE_DISABLED' });
  }

  async createMessageWithAgent(): Promise<never> {
    throw new ForbiddenException({ code: 'CHAT_LEGACY_CREATE_MESSAGE_WITH_AGENT_DISABLED', message: 'CHAT_LEGACY_CREATE_MESSAGE_WITH_AGENT_DISABLED' });
  }

  async updateMessageContent(id: string, content: string) {
    return this.messages.updateAssistantContent({ messageId: id, content });
  }

  async updateMessageCitations(id: string, citations: any[] | null) {
    return this.messages.finalizeAssistant({
      messageId: id,
      content: await this.getMessageContent(id),
      citations,
    });
  }
}


function includeActiveAssistantShell<T extends {
  id: unknown;
  parentMessageId?: unknown;
  role?: unknown;
}>(
  branchRows: T[],
  allRows: T[],
  activeAssistantMessageId: string | null,
): T[] {
  const assistantMessageId = String(activeAssistantMessageId ?? '').trim();
  if (!assistantMessageId) return branchRows;
  if (branchRows.some((row) => String(row.id) === assistantMessageId)) return branchRows;

  const activeAssistant = allRows.find(
    (row) => String(row.id) === assistantMessageId,
  );
  if (!activeAssistant || String(activeAssistant.role) !== String(MessageRole.ASSISTANT)) {
    return branchRows;
  }

  const parentMessageId = String(activeAssistant.parentMessageId ?? '').trim();
  const branchLeafMessageId = String(
    branchRows[branchRows.length - 1]?.id ?? '',
  ).trim();
  if (
    !parentMessageId
    || parentMessageId !== branchLeafMessageId
  ) {
    return branchRows;
  }

  return [...branchRows, activeAssistant];
}

function isMessageComplete(message: any): boolean {
  const status = String(message?.status ?? '').trim().toLowerCase();
  return message?.unfinished !== true
    && status !== 'queued'
    && status !== 'streaming';
}


function selectCurrentBranchRows<T extends { id: unknown; parentMessageId?: unknown }>(
  rows: T[],
  leafMessageId: string | null,
): T[] {
  if (!leafMessageId || rows.length === 0) return rows;

  const byId = new Map(rows.map((row) => [String(row.id), row]));
  if (!byId.has(leafMessageId)) return rows;

  const branch: T[] = [];
  const visited = new Set<string>();
  let cursor = byId.get(leafMessageId);

  while (cursor) {
    const id = String(cursor.id);
    if (visited.has(id)) break;
    visited.add(id);
    branch.push(cursor);

    const parentMessageId = String(cursor.parentMessageId ?? '').trim();
    if (!parentMessageId) break;
    cursor = byId.get(parentMessageId);
  }

  return branch.reverse();
}
