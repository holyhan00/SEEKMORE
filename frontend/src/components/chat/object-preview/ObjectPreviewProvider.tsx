// frontend/src/components/chat/object-preview/ObjectPreviewProvider.tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ChatObjectCard } from '../../../utils/types';
import type { ObjectPreviewContextValue } from './object-preview.types';

const ObjectPreviewContext =
  createContext<ObjectPreviewContextValue | null>(null);

export function ObjectPreviewProvider({
  conversationId,
  children,
}: {
  conversationId: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [selectedObject, setSelectedObject] =
    useState<ChatObjectCard | null>(null);
  const [objects, setObjects] =
    useState<ChatObjectCard[]>([]);
  const [activeDeliveryKey, setActiveDeliveryKey] =
    useState<string | null>(null);
  const [dismissedDeliveryKey, setDismissedDeliveryKey] =
    useState<string | null>(null);
  const [autoOpenedDeliveryKey, setAutoOpenedDeliveryKey] =
    useState<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setSelectedObject(null);
    setObjects([]);
    setActiveDeliveryKey(null);
    setDismissedDeliveryKey(null);
    setAutoOpenedDeliveryKey(null);
  }, [conversationId]);

  const openObject = useCallback((
    object: ChatObjectCard,
    relatedObjects: ChatObjectCard[] = [],
  ) => {
    const deliveryObjects = uniqueObjects(
      relatedObjects.length
        ? relatedObjects
        : [object],
    );

    setObjects(deliveryObjects);
    setSelectedObject(
      deliveryObjects.find(
        (item) => item.objectId === object.objectId,
      ) ?? object,
    );
    setActiveDeliveryKey(
      deliveryKey(
        conversationId,
        object.messageId,
      ),
    );
    setOpen(true);
  }, [conversationId]);

  const close = useCallback(() => {
    if (activeDeliveryKey) {
      setDismissedDeliveryKey(activeDeliveryKey);
    }
    setOpen(false);
  }, [activeDeliveryKey]);

  const selectObject = useCallback((objectId: string) => {
    setSelectedObject((current) =>
      objects.find(
        (object) => object.objectId === objectId,
      ) ?? current,
    );
  }, [objects]);

  const registerLiveDelivery = useCallback((
    messageId: string,
    incomingObjects: ChatObjectCard[],
  ) => {
    const deliveryObjects = uniqueObjects(incomingObjects);
    if (!deliveryObjects.length) return;

    const key = deliveryKey(
      conversationId,
      messageId,
    );
    if (!key) return;

    setObjects(deliveryObjects);
    setActiveDeliveryKey(key);
    setSelectedObject((current) => {
      if (
        current
        && deliveryObjects.some(
          (object) => object.objectId === current.objectId,
        )
      ) {
        return current;
      }
      return deliveryObjects[0] ?? null;
    });

    if (
      dismissedDeliveryKey === key
      || autoOpenedDeliveryKey === key
    ) {
      return;
    }

    setAutoOpenedDeliveryKey(key);
    setOpen(true);
  }, [
    autoOpenedDeliveryKey,
    conversationId,
    dismissedDeliveryKey,
  ]);

  const value = useMemo<ObjectPreviewContextValue>(() => ({
    open,
    selectedObject,
    objects,
    activeDeliveryKey,
    openObject,
    close,
    selectObject,
    registerLiveDelivery,
  }), [
    activeDeliveryKey,
    close,
    objects,
    open,
    openObject,
    registerLiveDelivery,
    selectObject,
    selectedObject,
  ]);

  return (
    <ObjectPreviewContext.Provider value={value}>
      {children}
    </ObjectPreviewContext.Provider>
  );
}

export function useObjectPreview(): ObjectPreviewContextValue {
  const value = useContext(ObjectPreviewContext);
  if (!value) {
    throw new Error(
      'useObjectPreview must be used inside ObjectPreviewProvider',
    );
  }
  return value;
}

function deliveryKey(
  conversationId: string | null,
  messageId: string,
): string | null {
  const conversation = String(conversationId ?? '').trim();
  const message = String(messageId ?? '').trim();
  return conversation && message
    ? `${conversation}:${message}`
    : null;
}

function uniqueObjects(
  objects: ChatObjectCard[],
): ChatObjectCard[] {
  const output = new Map<string, ChatObjectCard>();
  for (const object of objects) {
    if (!object?.objectId) continue;
    output.set(object.objectId, object);
  }
  return [...output.values()].sort(
    (left, right) =>
      (left.position ?? 0)
      - (right.position ?? 0),
  );
}