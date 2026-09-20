                                             

import { localizeText } from '../../localization/localization';
import type {
  ChatObjectCard,
  ChatObjectRole,
  Message,
} from '../../utils/types';
import type { ChatPendingFile } from './file-upload.types';
import { getAuthToken } from '../../lib/auth-token';
import {
  ensureAnchoredAssistantShell,
  orderConversationMessages,
  projectConversationMessage,
  projectConversationMessages,
  type AssistantMessageAnchor,
} from './message-projection/conversation-message-projector';

export function getCurrentUserIdFromToken(): string | null {
  try {
    const token = getAuthToken();
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1] || '')) as any;
    return (payload && (payload.sub || payload.userId)) || null;
  } catch {
    return null;
  }
}

export function normalizeRole(
  input: any,
): 'user' | 'agent' | 'system' {
  const role = String(input ?? '').trim().toLowerCase();
  if (role === 'user') return 'user';
  if (role === 'system') return 'system';
  return 'agent';
}

export function asArray(value: unknown): any[] {
  return Array.isArray(value)
    ? value.filter(Boolean)
    : [];
}

export function normalizeChatObject(
  value: unknown,
): ChatObjectCard | null {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
  ) {
    return null;
  }

  const input = value as Record<string, unknown>;
  const objectId = text(input.objectId);
  const role = text(input.role) as ChatObjectRole;
  const messageId = text(input.messageId);
  const conversationId = text(input.conversationId);
  const displayName = text(input.displayName);
  const downloadUrl = text(input.downloadUrl);

  if (
    !objectId
    || !messageId
    || !conversationId
    || !displayName
    || !downloadUrl
    || (
      role !== 'user_input'
      && role !== 'assistant_output'
    )
  ) {
    return null;
  }

  const position = Number(input.position);
  const sizeBytes = Number(input.sizeBytes);

  return {
    objectId,
    role,
    messageId,
    conversationId,
    displayName,
    originalName:
      text(input.originalName) || undefined,
    objectKind:
      text(input.objectKind) || 'unknown',
    mimeType:
      text(input.mimeType)
      || 'application/octet-stream',
    extension:
      text(input.extension) || undefined,
    sizeBytes:
      Number.isFinite(sizeBytes)
        ? sizeBytes
        : undefined,
    downloadUrl,
    previewUrl:
      text(input.previewUrl) || undefined,
    contentHash:
      text(input.contentHash) || undefined,
    versionNo:
      finitePositiveInteger(input.versionNo) ?? undefined,
    sourceTool:
      text(input.sourceTool) || undefined,
    generationBatchId:
      text(input.generationBatchId) || undefined,
    generationIndex:
      finiteNonNegativeInteger(input.generationIndex) ?? undefined,
    media: normalizeMedia(input.media),
    position:
      Number.isInteger(position)
      && position >= 0
        ? position
        : 0,
    createdAt: text(input.createdAt),
  };
}

export function normalizeChatObjects(
  value: unknown,
): ChatObjectCard[] {
  const output: ChatObjectCard[] = [];
  const seen = new Set<string>();

  for (const item of asArray(value)) {
    const object = normalizeChatObject(item);
    if (!object) continue;
    const key = `${object.objectId}:${object.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(object);
  }

  return output.sort(
    (left, right) => left.position - right.position,
  );
}

export function mapHistoryToMessages(args: {
  raw: any[];
  cid: string;
  agentId: string | null;
}): Message[] {
  const { raw, cid, agentId } = args;

  return (raw || [])
    .filter((message: any) => message?.meta?.visibility !== 'internal')
    .map((message: any) => {
    const rawRole = String(message?.role ?? '').trim().toUpperCase();
    const role = normalizeRole(message?.role);
    const senderUserId =
      message?.senderUserId ?? undefined;
    const senderAgentId =
      role !== 'user'
        ? message?.senderAgentId
          ?? agentId
          ?? undefined
        : message?.senderAgentId
          ?? undefined;
    const senderType =
      message?.senderType
      ?? (senderUserId
        ? 'USER'
        : role === 'system'
          ? 'SYSTEM'
          : 'AGENT');
    const parsedTimestamp =
      typeof message?.timestamp === 'number'
        ? message.timestamp
        : message?.timestamp
          ? Date.parse(String(message.timestamp))
          : message?.createdAt
            ? Date.parse(String(message.createdAt))
            : Date.now();
    const messageId = String(
      message?.id
      ?? message?.messageId
      ?? `${Date.now()}-${Math.random()}`,
    );
    const messageMeta = normalizeMessageMeta(
      message,
      role,
      messageId,
    );

    return {
      id: messageId,
      role,
      parentMessageId: message?.parentMessageId ?? null,
      rootMessageId: message?.rootMessageId ?? null,
      branchId: message?.branchId ?? null,
      branchable: rawRole === 'ASSISTANT',
      content: String(message?.content ?? ''),
      isMe: message?.isMe === true,
      timestamp: Number.isFinite(parsedTimestamp)
        ? parsedTimestamp
        : Date.now(),
      is_complete: isHistoryMessageComplete(message),
      conversationId: cid,
      senderType,
      senderUserId,
      senderAgentId,
      payload: message?.payload,
      displayNameSnapshot:
        message?.displayNameSnapshot,
      avatarVersionSnapshot:
        message?.avatarVersionSnapshot,
      citations: message?.citations ?? null,
      objects: normalizeChatObjects(message?.objects),
      runtime: message?.runtime ?? message?.meta?.runtime ?? null,
      branchSnapshotBoundary:
        message?.branchSnapshotBoundary === true
        || message?.meta?.branchSnapshotBoundary === true,
      meta: messageMeta,
    };
  });
}

export interface AssistantShellInput extends AssistantMessageAnchor {}

export function ensureAssistantShell(
  messages: Message[],
  input: AssistantShellInput,
): Message[] {
  return ensureAnchoredAssistantShell(
    messages,
    input,
  );
}

export function projectMessage(
  messages: Message[],
  incoming: Message,
): Message[] {
  return projectConversationMessage(
    messages,
    incoming,
  );
}

export function stabilizeMessageOrder(
  messages: Message[],
): Message[] {
  return orderConversationMessages(messages);
}

export function mergeBootstrapMessages(input: {
  history: Message[];
  current: Message[];
  baseline: Message[];
  activeAssistant?: AssistantShellInput | null;
}): Message[] {
  let output = projectConversationMessages(
    [],
    input.history,
  );
  const changed = input.current.filter(
    (message) => !input.baseline.includes(message),
  );

  output = projectConversationMessages(
    output,
    changed,
  );

  if (input.activeAssistant) {
    output = ensureAnchoredAssistantShell(
      output,
      input.activeAssistant,
    );
  }

  return orderConversationMessages(output);
}

export function inferOptimisticTitle(input: string): string {
  const value = String(input ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[\"'“”‘’。、，,.!?！？：:;；]+$/g, '')
    .trim();
  return Array.from(value).slice(0, 48).join('');
}

export function createUploadClientId(file: File): string {
  return `upload-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}-${file.name}`;
}

export function normalizeUploadedFileCard(
  card: any,
  fallback: ChatPendingFile,
): ChatPendingFile {
  const objectId = String(
    card?.objectId ?? card?.id ?? '',
  ).trim();
  if (!objectId) {
    throw new Error(localizeText('chat.upload.missingObjectId'));
  }

  const originalName = String(
    card?.originalName ?? fallback.originalName,
  ).trim() || fallback.originalName;
  const displayName = String(
    card?.displayName ?? originalName,
  ).trim() || originalName;
  const downloadUrl = String(
    card?.downloadUrl ?? '',
  ).trim();
  const sizeBytes = Number(
    card?.sizeBytes ?? fallback.sizeBytes,
  );
  if (
    String(card?.status ?? '').trim() !== 'available'
    || String(card?.processingStatus ?? '').trim() !== 'ready'
  ) {
    throw new Error(localizeText('chat.upload.objectNotReady'));
  }

  return {
    ...fallback,
    objectId,
    originalName,
    displayName,
    sizeBytes: Number.isFinite(sizeBytes)
      ? sizeBytes
      : fallback.sizeBytes,
    sizeText: String(
      card?.sizeText
      ?? card?.sizeLabel
      ?? fallback.sizeText,
    ),
    objectKind: String(
      card?.objectKind ?? fallback.objectKind,
    ),
    extension:
      String(
        card?.extension
        ?? fallback.extension
        ?? '',
      ).trim() || undefined,
    mimeType: String(
      card?.mimeType ?? fallback.mimeType ?? '',
    ),
    downloadUrl: downloadUrl || undefined,
    previewUrl: String(card?.previewUrl ?? '').trim() || undefined,
    contentHash: String(card?.contentHash ?? '').trim() || undefined,
    versionNo: finitePositiveInteger(card?.versionNo) ?? undefined,
    uploadProgress: 100,
    media: normalizeMedia(card?.media),
    status: 'ready' as const,
    error: undefined,
    capabilities: Array.isArray(card?.capabilities)
      ? card.capabilities.map(String).filter(Boolean)
      : [],
    contentSummary: typeof card?.contentSummary === 'string'
      ? card.contentSummary
      : null,
    parser: typeof card?.parser === 'string' ? card.parser : null,
    processorVersion: typeof card?.processorVersion === 'string'
      ? card.processorVersion
      : null,
  };
}

export function pendingFileToMessageObject(
  file: ChatPendingFile,
  input: {
    messageId: string;
    conversationId: string;
  },
): ChatObjectCard {
  return {
    objectId: String(file.objectId ?? '').trim(),
    role: 'user_input',
    messageId: input.messageId,
    conversationId: input.conversationId,
    displayName: file.displayName,
    originalName: file.originalName,
    objectKind: file.objectKind,
    mimeType:
      file.mimeType || 'application/octet-stream',
    extension: file.extension,
    sizeBytes: file.sizeBytes,
    downloadUrl:
      file.downloadUrl
      ?? file.localUrl
      ?? '',
    previewUrl:
      file.previewUrl
      ?? file.localUrl
      ?? file.downloadUrl,
    contentHash: file.contentHash,
    versionNo: file.versionNo,
    media: file.media,
    position: file.position,
    createdAt: new Date().toISOString(),
  };
}

function normalizeMedia(value: unknown): ChatObjectCard['media'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const width = Number(input.width);
  const height = Number(input.height);
  const format = text(input.format) || undefined;
  const hasAlpha = typeof input.hasAlpha === 'boolean' ? input.hasAlpha : undefined;
  const media = {
    width: Number.isFinite(width) && width > 0 ? width : undefined,
    height: Number.isFinite(height) && height > 0 ? height : undefined,
    format,
    hasAlpha,
  };
  return Object.values(media).some((item) => item !== undefined) ? media : undefined;
}


function finiteNonNegativeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function finitePositiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function isHistoryMessageComplete(message: any): boolean {
  const explicit = message?.is_complete ?? message?.isComplete;
  if (explicit !== undefined && explicit !== null) {
    return Boolean(explicit);
  }

  const status = text(message?.status).toLowerCase();
  return message?.unfinished !== true
    && status !== 'queued'
    && status !== 'streaming';
}

function normalizeMessageMeta(
  message: any,
  role: 'user' | 'agent' | 'system',
  messageId: string,
): Record<string, unknown> | null {
  const source = message?.meta
    && typeof message.meta === 'object'
    && !Array.isArray(message.meta)
      ? message.meta as Record<string, unknown>
      : {};
  const traceId = text(source.traceId ?? message?.traceId);
  const backendAssistantMessageId = role === 'agent'
    ? text(source.backendAssistantMessageId ?? messageId)
    : text(source.backendAssistantMessageId);

  if (
    Object.keys(source).length === 0
    && !traceId
    && !backendAssistantMessageId
  ) {
    return null;
  }

  return {
    ...source,
    ...(traceId ? { traceId } : {}),
    ...(backendAssistantMessageId
      ? { backendAssistantMessageId }
      : {}),
  };
}
