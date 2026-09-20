import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

type StoredWelcomeState = {
  hasEverShown: boolean;
  lastShownLocalDate: string | null;
};

type UseChatWelcomeVisibilityInput = {
  userId: string | null;
  conversationId: string | null;
  isNewConversation: boolean;
  canEvaluateConversation: boolean;
  isConversationEmpty: boolean;
  hasUserMessage: boolean;
};

const STORAGE_PREFIX =
  'seekmore.chatWelcome';

function localDateKey(
  date = new Date(),
): string {
  const year = date.getFullYear();
  const month = String(
    date.getMonth() + 1,
  ).padStart(2, '0');
  const day = String(
    date.getDate(),
  ).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function storageKey(
  userId: string | null,
): string {
  const normalizedUserId =
    String(userId ?? '')
      .trim();

  return `${STORAGE_PREFIX}.${normalizedUserId || 'local'}`;
}

function readWelcomeState(
  userId: string | null,
): StoredWelcomeState {
  try {
    const raw = localStorage.getItem(
      storageKey(userId),
    );

    if (!raw) {
      return {
        hasEverShown: false,
        lastShownLocalDate: null,
      };
    }

    const parsed = JSON.parse(
      raw,
    ) as Partial<StoredWelcomeState>;

    return {
      hasEverShown:
        parsed.hasEverShown === true,
      lastShownLocalDate:
        typeof parsed.lastShownLocalDate
          === 'string'
          ? parsed.lastShownLocalDate
          : null,
    };
  } catch {
    return {
      hasEverShown: false,
      lastShownLocalDate: null,
    };
  }
}

function writeWelcomeState(
  userId: string | null,
  value: StoredWelcomeState,
): void {
  try {
    localStorage.setItem(
      storageKey(userId),
      JSON.stringify(value),
    );
  } catch {
                                                 
  }
}

export function useChatWelcomeVisibility({
  userId,
  conversationId,
  isNewConversation,
  canEvaluateConversation,
  isConversationEmpty,
  hasUserMessage,
}: UseChatWelcomeVisibilityInput) {
  const [
    welcomedConversationId,
    setWelcomedConversationId,
  ] = useState<string | null>(null);

  const today = useMemo(
    () => localDateKey(),
    [conversationId],
  );

  useEffect(() => {
    const handleConversationCreated = (
      event: Event,
    ) => {
      const createdConversationId =
        String(
          (
            event as CustomEvent<{
              conversationId?: unknown;
            }>
          ).detail
            ?.conversationId
          ?? '',
        ).trim();

      if (!createdConversationId) {
        return;
      }

      setWelcomedConversationId(
        (current) =>
          current?.startsWith(
            'temp-',
          )
            ? createdConversationId
            : current,
      );
    };

    window.addEventListener(
      'chat:conversation:created',
      handleConversationCreated,
    );

    return () =>
      window.removeEventListener(
        'chat:conversation:created',
        handleConversationCreated,
      );
  }, []);

  useEffect(() => {
    if (
      !conversationId
      || !canEvaluateConversation
      || !isConversationEmpty
      || hasUserMessage
    ) {
      return;
    }

    if (
      welcomedConversationId
      === conversationId
    ) {
      return;
    }

    const stored =
      readWelcomeState(userId);

    const firstUse =
      !stored.hasEverShown;

    const firstNewConversationToday =
      isNewConversation
      && stored.lastShownLocalDate
        !== today;

    if (
      !firstUse
      && !firstNewConversationToday
    ) {
      return;
    }

    setWelcomedConversationId(
      conversationId,
    );

    writeWelcomeState(
      userId,
      {
        hasEverShown: true,
        lastShownLocalDate: today,
      },
    );
  }, [
    canEvaluateConversation,
    conversationId,
    hasUserMessage,
    isConversationEmpty,
    isNewConversation,
    today,
    userId,
    welcomedConversationId,
  ]);

  const dismiss = useCallback(() => {
    setWelcomedConversationId(null);
  }, []);

  const visible = Boolean(
    conversationId
    && welcomedConversationId
      === conversationId
    && isConversationEmpty
    && !hasUserMessage,
  );

  return {
    visible,
    dismiss,
  };
}
