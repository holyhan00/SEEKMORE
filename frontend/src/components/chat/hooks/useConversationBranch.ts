import { localizeText } from '../../../localization/localization';
import { useCallback, useRef, useState } from 'react';
import {
  createConversationBranch,
  type ConversationBranchResponse,
} from '../../../lib/conversation-branch-api';

type UseConversationBranchInput = {
  conversationId: string | null;
  onCreated: (result: ConversationBranchResponse) => Promise<void> | void;
};

export function useConversationBranch({
  conversationId,
  onCreated,
}: UseConversationBranchInput) {
  const [branchingMessageId, setBranchingMessageId] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const branchFromMessage = useCallback(async (messageId: string) => {
    const sourceConversationId = String(conversationId ?? '').trim();
    const fromMessageId = String(messageId ?? '').trim();
    if (!sourceConversationId || sourceConversationId.startsWith('temp-')) {
      setError(localizeText('chat.branch.unsaved'));
      return;
    }
    if (!fromMessageId || inFlightRef.current) return;

    inFlightRef.current = true;
    setBranchingMessageId(fromMessageId);
    setError(null);
    try {
      const result = await createConversationBranch({
        conversationId: sourceConversationId,
        fromMessageId,
        requestId: createRequestId(),
      });
      await onCreated(result);
    } catch (reason) {
      setError(readErrorMessage(reason));
    } finally {
      inFlightRef.current = false;
      setBranchingMessageId(null);
    }
  }, [conversationId, onCreated]);

  return {
    branchFromMessage,
    branchingMessageId,
    error,
    clearError: () => setError(null),
  };
}

function createRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function readErrorMessage(error: unknown): string {
  const response = (error as any)?.response?.data;
  const message = response?.message;
  if (Array.isArray(message)) return message.map(String).filter(Boolean).join('；');
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (error instanceof Error && error.message.trim()) return error.message;
  return localizeText('chat.branch.createFailed');
}
