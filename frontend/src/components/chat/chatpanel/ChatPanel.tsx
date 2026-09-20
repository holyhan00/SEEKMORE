// frontend/src/components/chat/chatpanel/ChatPanel.tsx

import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { useLocalize } from '../../../localization/useLocalize';
import { useSystemResourcePresentation } from '../../../localization/useSystemResourcePresentation';
import { useRecoilState, useSetRecoilState } from 'recoil';
import ContactCard from './ContactCard';
import { api } from '../../../lib/api';
import { searchChatTitles } from '../../../lib/chat-api';
import { resolveAssetUrl } from '../../../utils/asset-url';
import {
  selectedAgentIdState,
  selectedConversationIdState,
} from '../store/chatState';
import { useChatInitializer } from '../ChatMessage/useChatInitializer';
import { useAuth } from '../../../hooks/auth/useAuth';
import CognitiveAgentEditModal from '../../myagent/cognitive/modals/CognitiveAgentEditModal';
import AgentContextMenu from './AgentContextMenu';
import { useChatPanelActions } from '../ChatMessage/useChatPanelActions';
import ChatPanelSearchBar from './search/ChatPanelSearchBar';
import ChatPanelSearchDropdown, {
  AgentHit,
  ConvHit,
} from './search/ChatPanelSearchDropdown';

const CHAT_LIST_KEY = 'chat-list';

async function openExternalUrl(
  url: string,
): Promise<void> {
  const desktopOpen =
    window.seekmoreDesktop?.web?.openExternal;

  if (desktopOpen) {
    try {
      const result = await desktopOpen(url);

      if (result.opened) {
        return;
      }
    } catch (error) {
      console.warn(
        '[ChatPanel] desktop open failed:',
        error,
      );
    }
  }

  window.open(
    url,
    '_blank',
    'noopener,noreferrer',
  );
}

export interface Agent {
  id: string;
  key?: string | null;
  name: string;
  description?: string;
  avatarKey?: string | null;
  avatarUrl?: string;
  avatarUpdatedAt?: string | Date | null;
  lastMessage?: string;
  remark?: string;
  pinnedAt?: number;
  isSuper?: boolean;
  isDefaultAgent?: boolean;
}

interface ChatPanelProps {

  compactHeader?: boolean;
}

type StoredItem = {
  agentId: string;
  lastMessage?: string;
  remark?: string;
  pinnedAt?: number;
  updatedAt?: number;
};

const ChatPanel: React.FC<ChatPanelProps> = ({ compactHeader = false }) => {
  const localize = useLocalize();
  const systemPresentation =
    useSystemResourcePresentation();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editAgentId, setEditAgentId] = useState<string | null>(null);

  const { isLoggedIn, authReady } = useAuth();

  const [selectedAgentId, setSelectedAgentId] =
    useRecoilState(selectedAgentIdState);

  const setSelectedConversationId =
    useSetRecoilState(selectedConversationIdState);

  const initChatWithAgent = useChatInitializer();

  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

  const persistToLocalStorage = useCallback(
    (next?: Agent[]) => {
      try {
        const payload: StoredItem[] = (next ?? agents).map((a) => ({
          agentId: a.id,
          lastMessage: a.lastMessage,
          remark: a.remark,
          pinnedAt: a.pinnedAt,
          updatedAt: Date.now(),
        }));

        localStorage.setItem(CHAT_LIST_KEY, JSON.stringify(payload));
      } catch {}
    },
    [agents]
  );

  const pinAgentToTop = useCallback(
    (agentId: string, lastMessage?: string) => {
      setAgents((prev) => {
        const idx = prev.findIndex((a) => a.id === agentId);
        if (idx === -1) return prev;

        const now = Date.now();

        const target = {
          ...prev[idx],
          ...(lastMessage ? { lastMessage } : {}),
          pinnedAt: now,
        };

        const others = prev.filter((_, i) => i !== idx);

        const next = [target, ...others];

        next.sort((a, b) => {
          const defaultOrder =
            Number(Boolean(b.isDefaultAgent))
            - Number(Boolean(a.isDefaultAgent));

          return defaultOrder !== 0
            ? defaultOrder
            : (b.pinnedAt ?? 0)
              - (a.pinnedAt ?? 0);
        });

        persistToLocalStorage(next);

        return next;
      });
    },
    [persistToLocalStorage]
  );

  const fetchAndMergeAgents = useCallback(async () => {
    if (!authReady || !isLoggedIn) return;

    try {
      const res = await api.get('/agent/list');

      const fetchedAgents: Agent[] = res.data?.data?.agents || [];

      let ordered: Agent[] = fetchedAgents;

      try {
        const storedRaw = localStorage.getItem(CHAT_LIST_KEY);

        if (storedRaw) {
          const stored: StoredItem[] = JSON.parse(storedRaw);

          if (Array.isArray(stored) && stored.length > 0) {
            const orderIds = stored.map((s) => s.agentId);

            const detailMap = new Map(
              stored.map((s) => [s.agentId, s])
            );

            const inOrder: Agent[] = [];
            const others: Agent[] = [];

            for (const a of fetchedAgents) {
              const s = detailMap.get(a.id);

              const merged: Agent = {
                ...a,
                lastMessage: s?.lastMessage ?? a.lastMessage,
                remark: s?.remark ?? a.remark,
                pinnedAt: s?.pinnedAt ?? a.pinnedAt,
              };

              if (orderIds.includes(a.id)) {
                inOrder.push(merged);
              } else {
                others.push(merged);
              }
            }

            ordered = orderIds
              .map((id) => inOrder.find((a) => a.id === id))
              .filter((x): x is Agent => Boolean(x));

            ordered = [...ordered, ...others];

            ordered.sort(
              (a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)
            );
          }
        }
      } catch {}

      ordered.sort((left, right) => {
        const defaultOrder =
          Number(Boolean(right.isDefaultAgent))
          - Number(Boolean(left.isDefaultAgent));

        if (defaultOrder !== 0) {
          return defaultOrder;
        }

        return (right.pinnedAt ?? 0)
          - (left.pinnedAt ?? 0);
      });

      setAgents(ordered);
    } catch (err: any) {
      console.error('[ChatPanel] failed to load agent', err);

    }
  }, [authReady, isLoggedIn]);

  const openAgentChatById = useCallback(
    async (
      agentId: string,
      source: 'event' | 'session' = 'event',
      fallbackAgent?: Partial<Agent>,
    ) => {
      await api.post(`/agent/user/${agentId}/restore-chat`).catch(() => undefined);

      let target = agents.find((a) => a.id === agentId);

      if (!target && fallbackAgent?.id) {
        target = {
          id: fallbackAgent.id,
          key: fallbackAgent.key,
          name: fallbackAgent.name || localize('agent.unnamed'),
          description: fallbackAgent.description,
          avatarKey: fallbackAgent.avatarKey,
          avatarUrl: fallbackAgent.avatarUrl,
          avatarUpdatedAt:
            fallbackAgent.avatarUpdatedAt,
          lastMessage: fallbackAgent.lastMessage,
          remark: fallbackAgent.remark,
          pinnedAt: Date.now(),
          isSuper: fallbackAgent.isSuper,
          isDefaultAgent: fallbackAgent.isDefaultAgent,
        };

        setAgents((prev) => {
          if (prev.some((a) => a.id === target!.id)) return prev;
          const next = [target as Agent, ...prev];
          persistToLocalStorage(next);
          return next;
        });
      }

      if (!target) {
        await fetchAndMergeAgents();
        return;
      }

      setSelectedAgentId(target.id);

      const convoId = await initChatWithAgent(target);

      if (convoId) {
        setSelectedConversationId(convoId);
      }

      pinAgentToTop(target.id);

      if (source === 'session') {
        sessionStorage.removeItem('pending-open-agent-id');
        sessionStorage.removeItem('pending-open-agent');
      }
    },
    [
      agents,
      fetchAndMergeAgents,
      initChatWithAgent,
      persistToLocalStorage,
      pinAgentToTop,
      setSelectedAgentId,
      setSelectedConversationId,
    ],
  );

  useEffect(() => {
    if (!authReady) return;

    if (!isLoggedIn) {
      setAgents([]);
      return;
    }

    (async () => {
      await fetchAndMergeAgents();
    })();
  }, [authReady, isLoggedIn, fetchAndMergeAgents]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ agentId?: string; agent?: Partial<Agent> }>;
      const agentId = ce.detail?.agentId;

      if (!agentId) return;

      void openAgentChatById(agentId, 'event', ce.detail?.agent);
    };

    window.addEventListener('agentChat:open', handler as EventListener);

    return () => {
      window.removeEventListener('agentChat:open', handler as EventListener);
    };
  }, [openAgentChatById]);

  useEffect(() => {
    if (!authReady || !isLoggedIn) return;

    const pendingAgentId = sessionStorage.getItem('pending-open-agent-id');
    if (!pendingAgentId) return;

    let fallbackAgent: Partial<Agent> | undefined;

    try {
      const raw = sessionStorage.getItem('pending-open-agent');
      fallbackAgent = raw ? JSON.parse(raw) : undefined;
    } catch {
      fallbackAgent = undefined;
    }

    void openAgentChatById(pendingAgentId, 'session', fallbackAgent);
  }, [authReady, isLoggedIn, openAgentChatById]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{
        agentId?: string;
        lastMessage?: string;
      }>;

      const agentId = ce.detail?.agentId;

      if (!agentId) return;

      pinAgentToTop(agentId, ce.detail?.lastMessage);
    };

    window.addEventListener(
      'agentMessageSent',
      handler as EventListener
    );

    return () =>
      window.removeEventListener(
        'agentMessageSent',
        handler as EventListener
      );
  }, [pinAgentToTop]);

  useEffect(() => {
    if (!selectedAgentId && agents.length > 0) {
      const pendingAgentId = sessionStorage.getItem('pending-open-agent-id');
      if (pendingAgentId) return;

      const first = agents[0];

      setSelectedAgentId(first.id);

      initChatWithAgent(first).then(
        (cid) => cid && setSelectedConversationId(cid)
      );
    }
  }, [
    agents,
    selectedAgentId,
    setSelectedAgentId,
    initChatWithAgent,
    setSelectedConversationId,
  ]);

  const [menuState, setMenuState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    agent?: Agent;
  }>({
    visible: false,
    x: 0,
    y: 0,
  });

  const menuRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = useCallback(() => {
    setMenuState((s) => ({
      ...s,
      visible: false,
      agent: undefined,
    }));
  }, []);

  useEffect(() => {
    if (!menuState.visible) return;

    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;

      if (!menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);

    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuState.visible, closeMenu]);

  const onContextMenu = (
    e: React.MouseEvent,
    agent: Agent
  ) => {
    e.preventDefault();

    setMenuState({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      agent,
    });
  };

  const {
    onRemark,
    onTogglePin,
    onShare,
    onReport,
    onRemoveFromChat,
  } = useChatPanelActions({
    agents,
    setAgents,
    persistToLocalStorage,
    closeMenu,
    selectedAgentId,
    setSelectedAgentId,
    setSelectedConversationId,
    initChatWithAgent,
  });

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [dropdownVisible, setDropdownVisible] =
    useState(false);

  const searchRowWrapRef =
    useRef<HTMLDivElement | null>(null);

  const searchInputRef =
    useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim());
    }, 200);

    return () => clearTimeout(t);
  }, [q]);

  const agentMatches: AgentHit[] = useMemo(() => {
    if (!debouncedQ) return [];

    const kw = debouncedQ.toLowerCase();

    return agents
      .filter(
        (a) =>
          (a.remark || a.name || '')
            .toLowerCase()
            .includes(kw) ||
          (a.lastMessage || '')
            .toLowerCase()
            .includes(kw)
      )
      .slice(0, 8)
      .map((a) => ({
        id: a.id,
        name: a.name,
        remark: a.remark,
        avatarUrl: resolveAssetUrl(
          a.avatarUrl
          ?? a.avatarKey,
          {
            fallback:
              resolveAssetUrl('/icons/avatar-default.svg'),
            version:
              a.avatarUpdatedAt,
          },
        ),
        lastMessage: a.lastMessage,
        isSuper: a.isSuper,
      }));
  }, [agents, debouncedQ]);

  const [convMatches, setConvMatches] = useState<ConvHit[]>([]);

  useEffect(() => {
    if (!debouncedQ) {
      setConvMatches([]);
      return undefined;
    }

    let cancelled = false;

    void searchChatTitles(debouncedQ, { limit: 8 })
      .then((response) => {
        if (cancelled) return;

        setConvMatches(
          response.items.map((item) => {
            const agent = agents.find(
              (entry) => entry.id === item.agentId,
            );

            return {
              id: item.id,
              agentId: item.agentId,
              title: item.title,
              snippet:
                agent?.remark
                || agent?.name
                || undefined,
              avatarUrl: agent
                ? resolveAssetUrl(
                    agent.avatarUrl
                    ?? agent.avatarKey,
                    {
                      fallback:
                        resolveAssetUrl('/icons/avatar-default.svg'),
                      version:
                        agent.avatarUpdatedAt,
                    },
                  )
                : undefined,
            };
          }),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setConvMatches([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agents, debouncedQ]);

  const doWebSearch = useCallback((keyword: string) => {
    void openExternalUrl(
      `https://quark.cn/s?q=${encodeURIComponent(keyword)}`,
    );
  }, []);

  if (!authReady) {
    return (
      <div className="w-full h-full bg-transparent" />
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="w-full h-full bg-transparent" />
    );
  }

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center bg-transparent"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={searchRowWrapRef}
        className={`w-[90%] mb-[10px] ${compactHeader ? 'mt-[10px]' : 'mt-[14px]'} relative`}
      >
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <ChatPanelSearchBar
              value={q}
              onChange={(v) => {
                setQ(v);
                setDropdownVisible(true);
              }}
              onFocus={() => setDropdownVisible(true)}
              onBlur={() =>
                setTimeout(
                  () => setDropdownVisible(false),
                  150
                )
              }

              inputRef={searchInputRef}
              placeholder={localize('common.search')}
            />
          </div>
        </div>

        <ChatPanelSearchDropdown
          visible={dropdownVisible && q.length > 0}
          anchorRef={searchRowWrapRef}

          query={q}
          agents={agentMatches}
          conversations={convMatches}
          onPickAgent={(agentId: string) => {
            setDropdownVisible(false);
            setQ('');

            const a = agents.find(
              (x) => x.id === agentId
            );

            if (!a) return;

            setSelectedAgentId(a.id);

            initChatWithAgent(a).then(
              (cid) =>
                cid && setSelectedConversationId(cid)
            );
          }}
          onPickConversation={(
            cid: string,
            agentId: string,
          ) => {
            setDropdownVisible(false);
            setQ('');
            setSelectedAgentId(agentId);
            setSelectedConversationId(cid);
          }}
          onWebSearch={doWebSearch}
          onClose={() => setDropdownVisible(false)}
        />
      </div>

      <div className="min-h-0 flex-1 w-[90%] overflow-y-auto space-y-2 pr-1">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="relative"
            onContextMenu={(e) =>
              onContextMenu(e, agent)
            }
          >
            <ContactCard
              avatarUrl={resolveAssetUrl(
                agent.avatarUrl
                ?? agent.avatarKey,
                {
                  version:
                    agent.avatarUpdatedAt,
                },
              )}
              avatarFallbackText={agent.name}
              name={agent.remark || agent.name}
              lastMessage={
                agent.lastMessage ||
                systemPresentation.systemAgentDescription({
                  key:
                    agent.key
                    ?? (
                      agent.isSuper
                      && agent.isDefaultAgent
                        ? 'seekmore-system-agent'
                        : undefined
                    ),
                  isSuper:
                    Boolean(agent.isSuper),
                  fallback:
                    agent.description,
                }) ||
                localize('chat.defaultGreeting')
              }

              isSelected={
                agent.id === selectedAgentId
              }
              onClick={async () => {
                if (editingAgentId) return;

                setSelectedAgentId(agent.id);

                const convoId =
                  await initChatWithAgent(agent);

                if (convoId) {
                  setSelectedConversationId(convoId);
                }
              }}
              editable={editingAgentId === agent.id}
              onNameChange={(newRemark) => {
                if (
                  (newRemark ?? '') !==
                  (agent.remark ?? '')
                ) {
                  onRemark(agent, newRemark ?? '');
                }

                setEditingAgentId(null);
              }}
              onCancelEdit={() =>
                setEditingAgentId(null)
              }
            />

            <AgentContextMenu
              ref={menuRef}
              visible={
                menuState.visible &&
                menuState.agent?.id === agent.id
              }
              x={menuState.x}
              y={menuState.y}
              agent={agent}

              onClose={closeMenu}
              onEdit={() => {
                setEditAgentId(agent.id);
                setEditOpen(true);
                closeMenu();
              }}
              onRemark={() =>
                setEditingAgentId(agent.id)
              }
              onTogglePin={() =>
                onTogglePin(agent)
              }
              onShare={() => onShare()}
              onReport={() => onReport()}
              onRemoveFromChat={() =>
                onRemoveFromChat(agent)
              }
            />
          </div>
        ))}
      </div>

      <CognitiveAgentEditModal
        open={editOpen}
        agentId={editAgentId}

        onClose={() => {
          setEditOpen(false);
          setEditAgentId(null);
        }}
        onUpdated={async () => {
          await fetchAndMergeAgents();
        }}
      />
    </div>
  );
};

export default ChatPanel;