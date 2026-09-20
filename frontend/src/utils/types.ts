                              

export type MessageRole = 'user' | 'agent' | 'system';
export type ChatObjectRole =
  | 'user_input'
  | 'assistant_output';

export interface ChatObjectCard {
  objectId: string;
  role: ChatObjectRole;
  messageId: string;
  conversationId: string;
  displayName: string;
  originalName?: string;
  objectKind: string;
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


export interface Message {
  conversationId: string;
  id: string;
  parentMessageId?: string | null;
  rootMessageId?: string | null;
  branchId?: string | null;
  branchable?: boolean;
  branchSnapshotBoundary?: boolean;
  role: MessageRole;
  content: string;
  timestamp: number;
  is_complete: boolean;
  isMe?: boolean;
  senderType?: 'USER' | 'AGENT' | 'SYSTEM' | string;
  senderUserId?: string;
  senderAgentId?: string;
  citations?: any[] | null;
  objects?: ChatObjectCard[];
  runtime?: any;
  runtimeOptions?: {
    workspaceId?: string | null;
    permissionMode?: string;
                                                            
    enabledCapabilityKinds?: string[];
  };
  meta?: Record<string, unknown> | null;
  payload?: any;
  displayNameSnapshot?: any;
  avatarVersionSnapshot?: any;
}
