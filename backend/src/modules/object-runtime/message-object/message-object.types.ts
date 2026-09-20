import type { MessageObjectRole, MessageRole, RuntimeObject } from '@prisma/client';

export interface ChatObjectRefInput {
  objectId: string;
  position: number;
}

export interface AssistantOutputObjectInput {
  objectId: string;
  position?: number;
}

export interface MessageObjectPartition {
  userId: string;
  agentId: string;
  conversationId: string;
}

export interface MessageObjectLinkWithObject {
  id: string;
  messageId: string;
  objectId: string;
  role: MessageObjectRole;
  position: number;
  createdAt: Date;
  object: RuntimeObject;
  message: {
    role: MessageRole;
    conversationId: string;
  };
}

export type ChatObjectRole = 'user_input' | 'assistant_output';

export interface ChatObjectCardDto {
  objectId: string;
  role: ChatObjectRole;
  messageId: string;
  conversationId: string;
  displayName: string;
  originalName?: string;
  objectKind: string;
  originType: string;
  mimeType: string;
  extension?: string;
  sizeBytes?: number;
  contentHash?: string;
  versionNo?: number;
  downloadUrl: string;
  previewUrl?: string;
  sourceTool?: string;
  generationBatchId?: string;
  generationIndex?: number;
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
