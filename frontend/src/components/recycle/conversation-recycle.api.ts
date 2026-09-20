import { api } from '../../lib/api';

export interface RecycledConversationObject {
  objectId: string;
  role: 'user_input' | 'assistant_output';
  messageId: string;
  conversationId: string;
  displayName: string;
  originalName?: string;
  objectKind: string;
  mimeType: string;
  extension?: string;
  sizeBytes?: number;
  downloadUrl: string;
  previewUrl?: string;
  media?: {
    width?: number;
    height?: number;
    format?: string;
    hasAlpha?: boolean;
    durationMs?: number;
    sampleRate?: number;
    channels?: number;
    bitrate?: number;
    codec?: string;
  };
  position: number;
  createdAt: string;
}

export interface RecycledConversationMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL' | string;
  content: string;
  model?: string | null;
  timestamp: string;
  objects: RecycledConversationObject[];
}

export interface RecycledConversation {
  id: string;
  title: string;
  messageCount: number;
  deletedAt: string;
  purgeAfter: string;
  lastMessageAt?: string | null;
}

export interface ConversationRecycleGroup {
  agent: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    entityType: string;
    status: 'ACTIVE' | 'DELETED';
  };
  conversations: RecycledConversation[];
}

function unwrap<T>(data: unknown): T {
  const record = data as { data?: unknown } | null;
  return (record?.data ?? data) as T;
}

export async function listConversationRecycleGroups() {
  const { data } = await api.get(
    '/chat/conversation/recycle-bin',
  );

  return unwrap<ConversationRecycleGroup[]>(data);
}

export async function listRecycledConversationMessages(
  conversationId: string,
) {
  const { data } = await api.get(
    `/chat/conversation/${conversationId}/recycle-messages`,
  );

  return unwrap<{
    id: string;
    title: string;
    messages: RecycledConversationMessage[];
  }>(data);
}

export async function restoreRecycledConversation(
  conversationId: string,
) {
  const { data } = await api.post(
    `/chat/conversation/${conversationId}/restore`,
  );

  return unwrap<{
    id: string;
    title: string;
    agentId: string;
    updatedAt: string;
  }>(data);
}


export async function permanentlyDeleteRecycledConversation(
  conversationId: string,
) {
  const { data } = await api.delete(
    `/chat/conversation/${conversationId}/permanent`,
  );

  return unwrap<{
    id: string;
    permanentlyDeleted: true;
  }>(data);
}
