                                                

export interface ChatOutputObject {
  objectId: string;
  role?: 'assistant_output';
  displayName?: string | null;
  originalName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  versionNo?: number | null;
  downloadUrl?: string | null;
  [key: string]: unknown;
}

export interface ChatOutputWarning {
  code?: string;
  message?: string;
  [key: string]: unknown;
}

export type OnDelta = (chunk: string) => void;

export type OnDone = (finalize: {
  content?: string;
  citations?: unknown[] | null;
  runtime?: Record<string, unknown> | null;
  objects?: ChatOutputObject[];
  warnings?: ChatOutputWarning[];
  reasonCodes?: string[];
}) => void | Promise<void>;

export type OnError = (error: {
  code: string;
  message: string;
}) => void;

export interface StreamCallbacks {
  onDelta: OnDelta;
  onDone: OnDone;
  onError: OnError;
}

export const EVT_CHAT_MESSAGE_CREATED = 'chat.message.created';
export const EVT_CHAT_TITLE_CREATED = 'chat.title.created';
export const EVT_CHAT_TITLE_UPDATED = 'chat.title.updated';

export const WS_CHAT_TITLE_CREATED = 'CHAT_TITLE_CREATED';
export const WS_CHAT_TITLE_UPDATED = 'CHAT_TITLE_UPDATED';