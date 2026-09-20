import { useEffect, useRef } from 'react';
import type { Message, ChatObjectCard } from '../../../utils/types';
import { useObjectPreview } from './ObjectPreviewProvider';

export default function LiveObjectPreviewSync({
  conversationId,
  messages,
  hydrationReady,
  activeAssistantMessageId,
}: {
  conversationId: string | null;
  messages: Message[];
  hydrationReady: boolean;
  activeAssistantMessageId: string | null;
}) {
  const { registerLiveDelivery } = useObjectPreview();
  const baselineConversationRef = useRef<string | null>(null);
  const knownObjectIdsRef = useRef<Set<string>>(new Set());
  const lastLiveAssistantMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    baselineConversationRef.current = null;
    knownObjectIdsRef.current = new Set();
    lastLiveAssistantMessageIdRef.current = null;
  }, [conversationId]);

  useEffect(() => {
    if (activeAssistantMessageId) {
      lastLiveAssistantMessageIdRef.current =
        activeAssistantMessageId;
    }
  }, [activeAssistantMessageId]);

  useEffect(() => {
    const conversation = String(conversationId ?? '').trim();
    if (!conversation) return;

    const canEstablishBaseline =
      hydrationReady
      || conversation.startsWith('temp-');
    if (!canEstablishBaseline) return;

    const allObjects = assistantOutputObjects(messages);

    if (baselineConversationRef.current !== conversation) {
      baselineConversationRef.current = conversation;
      knownObjectIdsRef.current = new Set(
        allObjects.map((object) => object.objectId),
      );
      return;
    }

    const newObjects = allObjects.filter(
      (object) => !knownObjectIdsRef.current.has(object.objectId),
    );

    for (const object of newObjects) {
      knownObjectIdsRef.current.add(object.objectId);
    }

    if (!newObjects.length) return;

    const liveMessageId =
      activeAssistantMessageId
      || lastLiveAssistantMessageIdRef.current;
    if (!liveMessageId) return;

    if (
      !newObjects.some(
        (object) => object.messageId === liveMessageId,
      )
    ) {
      return;
    }

    const deliveryObjects = allObjects.filter(
      (object) =>
        object.messageId === liveMessageId
        && shouldAutoPreview(object),
    );

    if (deliveryObjects.length) {
      registerLiveDelivery(
        liveMessageId,
        deliveryObjects,
      );
    }
  }, [
    activeAssistantMessageId,
    conversationId,
    hydrationReady,
    messages,
    registerLiveDelivery,
  ]);

  return null;
}

function assistantOutputObjects(
  messages: Message[],
): ChatObjectCard[] {
  return messages.flatMap((message) =>
    Array.isArray(message.objects)
      ? message.objects.filter(
          (object) => object.role === 'assistant_output',
        )
      : [],
  );
}

function shouldAutoPreview(
  object: ChatObjectCard,
): boolean {
  const kind = String(object.objectKind ?? '')
    .trim()
    .toLowerCase();
  const mimeType = String(object.mimeType ?? '')
    .trim()
    .toLowerCase();

  if (
    kind === 'image'
    || mimeType.startsWith('image/')
    || kind === 'audio'
    || mimeType.startsWith('audio/')
  ) {
    return false;
  }

  return Boolean(object.downloadUrl);
}
