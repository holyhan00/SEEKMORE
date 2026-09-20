import { resolveAssetUrl } from '../../utils/asset-url';
                                                               

import { useCallback, useEffect, useState } from 'react';
import { confirm } from '../../lib/confirm';
import { useLocalize } from '../../localization/useLocalize';
import { useAppearance } from '../../theme/useAppearance';
import {
  listConversationRecycleGroups,
  listRecycledConversationMessages,
  permanentlyDeleteRecycledConversation,
  restoreRecycledConversation,
  type ConversationRecycleGroup,
  type RecycledConversationMessage,
} from './conversation-recycle.api';
import RecycleConversationCard from './RecycleConversationCard';

interface ConversationRecyclePanelProps {

}

export default function ConversationRecyclePanel({
  }: ConversationRecyclePanelProps) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const [groups, setGroups] =
    useState<ConversationRecycleGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] =
    useState<string | null>(null);
  const [deletingId, setDeletingId] =
    useState<string | null>(null);
  const [expandedId, setExpandedId] =
    useState<string | null>(null);
  const [messageLoadingId, setMessageLoadingId] =
    useState<string | null>(null);
  const [messagesByConversation, setMessagesByConversation] =
    useState<Record<string, RecycledConversationMessage[]>>({});

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      setGroups(await listConversationRecycleGroups());
    } catch (reason) {
      setGroups([]);
      console.error(
        '[Recycle] Failed to load conversations',
        reason,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleMessages = async (
    conversationId: string,
  ) => {
    if (expandedId === conversationId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(conversationId);

    if (messagesByConversation[conversationId]) {
      return;
    }

    setMessageLoadingId(conversationId);

    try {
      const result =
        await listRecycledConversationMessages(
          conversationId,
        );

      setMessagesByConversation((current) => ({
        ...current,
        [conversationId]: result.messages,
      }));
    } catch (reason) {
      console.error(
        '[Recycle] Failed to load message history',
        reason,
      );
    } finally {
      setMessageLoadingId(null);
    }
  };

  const restoreConversation = async (
    conversationId: string,
  ) => {
    if (restoringId) return;

    setRestoringId(conversationId);

    try {
      const restored = await restoreRecycledConversation(
        conversationId,
      );

      window.dispatchEvent(
        new CustomEvent('chat:conversation:restored', {
          detail: restored,
        }),
      );

      setExpandedId((current) =>
        current === conversationId ? null : current,
      );
      setMessagesByConversation((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });

      await refresh();
    } catch (reason) {
      console.error(
        '[Recycle] Failed to restore conversation',
        reason,
      );
    } finally {
      setRestoringId(null);
    }
  };

  const permanentlyDeleteConversation = async (
    conversationId: string,
    title: string,
  ) => {
    if (restoringId || deletingId) return;

    const confirmed = await confirm({
      title: localize('recycle.confirmPermanentTitle'),
      description: localize('recycle.confirmPermanentDescription', {
        title: title || localize('recycle.unnamedConversation'),
      }),
      confirmText: localize('recycle.deletePermanently'),
      cancelText: localize('common.actions.cancel'),
      danger: true,
    });
    if (!confirmed) return;

    setDeletingId(conversationId);
    try {
      await permanentlyDeleteRecycledConversation(
        conversationId,
      );
      setExpandedId((current) =>
        current === conversationId ? null : current,
      );
      setMessagesByConversation((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      await refresh();
    } catch (reason) {
      console.error('[Recycle] Failed to permanently delete conversation', reason);
    } finally {
      setDeletingId(null);
    }
  };

  const muted = 'text-theme-muted ';
  const card = 'border-[#000000]/[0.07] bg-[#ffffff] dark:border-[#000000]/[0.07] dark:bg-[#1d1d1e]';

  return (
    <main
      className={`h-full overflow-y-auto pb-8 ${
        'bg-surface-page '
      }`}
    >
      <div className="mx-auto w-[95%] select-none">
        <header
          className="relative flex min-h-[132px] items-end overflow-hidden rounded-[18px] bg-cover bg-center px-[22px]"
          style={{
            backgroundImage: `url("${
              isDarkTheme
                ? resolveAssetUrl('/backgrounds/agent-card-dark.jpg')
                : resolveAssetUrl('/backgrounds/agent-card-light.jpg')
            }")`,
          }}
        >
          <div
            className={`pointer-events-none absolute inset-0 ${
              'bg-surface-inverse-soft '
            }`}
          />

          <div className="relative bottom-[16px] z-10">
            <h1
              className={`m-0 text-[27px] font-semibold leading-[4px] tracking-[-0.035em] ${
                'text-theme-title '
              }`}
            >
              {localize('recycle.title')}
            </h1>
            <p
              className={`mt-[28px] text-[12px] leading-[2px] ${
                'text-theme-subtle '
              }`}
            >
              {localize('recycle.description')}
            </p>
          </div>
        </header>

        {!loading && groups.length > 0 ? (
          <div className="mt-[18px] space-y-[10px]">
            {groups.map((group) => (
              <section
                key={group.agent.id}
                className={`rounded-[14px] border p-[10px] ${card}`}
              >
                <div className="flex items-center gap-[10px] px-[2px] pb-[10px]">
                  <div
                    className={`flex h-[36px] w-[36px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] text-[14px] font-semibold ${
                      'bg-accent-surface text-accent-foreground  '
                    }`}
                  >
                    {group.agent.avatarUrl ? (
                      <img
                        src={group.agent.avatarUrl}
                        alt={localize('agents.recycle.avatarAlt', { name: group.agent.name })}
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      group.agent.name?.trim()?.[0] || 'A'
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex  items-center gap-[8px]">
                      <h2
                        className={`truncate text-[13px] font-semibold ${
                          'text-theme-primary-deep '
                        }`}
                        title={group.agent.name}
                      >
                        {group.agent.name}
                      </h2>
                      <span className="rounded-full bg-emerald-500/10 px-[7px] py-[3px] text-[9px] text-emerald-500">
                        {localize('recycle.agentInUse')}
                      </span>
                    </div>
                    <div className={`text-[9px] ${muted}`}>
                      {localize('recycle.deletedConversationCount', { count: group.conversations.length })}
                    </div>
                  </div>
                </div>

                <div
                  className={`scroll-container max-h-[180px] space-y-[8px] overflow-y-auto`}
                >
                  {group.conversations.map((conversation) => (
                    <RecycleConversationCard
                      key={conversation.id}
                      conversation={conversation}

                      expanded={expandedId === conversation.id}
                      messages={
                        messagesByConversation[conversation.id] ?? []
                      }
                      loading={messageLoadingId === conversation.id}
                      onToggle={() => void toggleMessages(conversation.id)}
                      onRestore={() =>
                        void restoreConversation(conversation.id)
                      }
                      onPermanentlyDelete={() =>
                        void permanentlyDeleteConversation(
                          conversation.id,
                          conversation.title,
                        )
                      }
                      isRestoring={restoringId === conversation.id}
                      isDeleting={deletingId === conversation.id}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}
