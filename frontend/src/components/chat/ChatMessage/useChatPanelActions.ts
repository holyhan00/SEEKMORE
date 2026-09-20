                                                                  
import { useCallback } from 'react';
import { api } from '../../../lib/api';
import { useLocalize } from '../../../localization/useLocalize';

export interface Agent {
  id: string;
  name: string;
  avatarUrl?: string;
  lastMessage?: string;
  remark?: string;
  pinnedAt?: number;
  isSuper?: boolean;
  isDefaultAgent?: boolean;
}

interface Params {
  agents: Agent[];
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  persistToLocalStorage: (next?: Agent[]) => void;
  closeMenu: () => void;

  selectedAgentId: string | null | undefined;
  setSelectedAgentId: (v: any) => void;
  setSelectedConversationId: (v: any) => void;

  initChatWithAgent: (agent: Agent) => Promise<string | null | undefined>;
}

export function useChatPanelActions({
  agents,
  setAgents,
  persistToLocalStorage,
  closeMenu,
  selectedAgentId,
  setSelectedAgentId,
  setSelectedConversationId,
  initChatWithAgent,
}: Params) {
  const localize = useLocalize();
  const onRemark = useCallback(async (agent: Agent, newRemark?: string) => {
    const remark =
      newRemark ??
      window.prompt(localize('chat.agentActions.remarkPrompt'), agent.remark ?? '') ??
      undefined;

    if (remark == null) return;

    const old = agents;
    const next = agents.map((a) =>
      a.id === agent.id ? { ...a, remark } : a,
    );

    setAgents(next);
    persistToLocalStorage(next);

    try {
      await api.patch(`/agent/user/${agent.id}/remark`, { remark });
    } catch {
      setAgents(old);
      persistToLocalStorage(old);
      window.alert(localize('chat.agentActions.remarkFailed'));
    } finally {
      closeMenu();
    }
  }, [agents, setAgents, persistToLocalStorage, closeMenu, localize]);

  const onTogglePin = useCallback(async (agent: Agent) => {
    const old = agents;
    const willPin = !agent.pinnedAt;

    const next = agents
      .map((a) =>
        a.id === agent.id
          ? { ...a, pinnedAt: willPin ? Date.now() : undefined }
          : a,
      )
      .sort((a, b) => {
        const defaultOrder =
          Number(Boolean(b.isDefaultAgent))
          - Number(Boolean(a.isDefaultAgent));

        return defaultOrder !== 0
          ? defaultOrder
          : (b.pinnedAt ?? 0)
            - (a.pinnedAt ?? 0);
      });

    setAgents(next);
    persistToLocalStorage(next);

    try {
      await api.patch(`/agent/user/${agent.id}/pin`, { pinned: willPin });
    } catch {
      setAgents(old);
      persistToLocalStorage(old);
      window.alert(localize('chat.agentActions.pinFailed'));
    } finally {
      closeMenu();
    }
  }, [agents, setAgents, persistToLocalStorage, closeMenu, localize]);

  const onShare = useCallback(() => {
    window.alert(localize('chat.agentActions.shareComingSoon'));
    closeMenu();
  }, [closeMenu, localize]);

  const onReport = useCallback(() => {
    window.alert(localize('chat.agentActions.reportComingSoon'));
    closeMenu();
  }, [closeMenu, localize]);

  const onRemoveFromChat = useCallback(async (agent: Agent) => {
    if (agent.isSuper || agent.isDefaultAgent) {
      window.alert(localize('chat.agentActions.systemAgentCannotRemove'));
      closeMenu();
      return;
    }

    if (!window.confirm(localize('chat.agentActions.removeConfirm'))) {
      return;
    }

    const old = agents;
    const next = agents.filter((a) => a.id !== agent.id);

    setAgents(next);
    persistToLocalStorage(next);

    try {
      await api.post(`/agent/user/${agent.id}/remove-chat`);

      if (selectedAgentId === agent.id) {
        setSelectedAgentId(undefined as any);
        setSelectedConversationId(undefined as any);

        if (next.length > 0) {
          const first = next[0];

          setSelectedAgentId(first.id);

          const cid = await initChatWithAgent(first);

          if (cid) {
            setSelectedConversationId(cid);
          }
        }
      }
    } catch {
      setAgents(old);
      persistToLocalStorage(old);
      window.alert(localize('chat.agentActions.removeFailed'));
    } finally {
      closeMenu();
    }
  }, [
    agents,
    setAgents,
    persistToLocalStorage,
    selectedAgentId,
    setSelectedAgentId,
    setSelectedConversationId,
    initChatWithAgent,
    closeMenu,
    localize,
  ]);

  return {
    onRemark,
    onTogglePin,
    onShare,
    onReport,
    onRemoveFromChat,
  };
}