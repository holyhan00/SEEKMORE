import { useAppearance } from '../../../theme/useAppearance';
import { useLocalize } from '../../../localization/useLocalize';
import { forwardRef } from 'react';
import MoreMenu, { MenuItem } from '../../../components/ui/MoreMenu';

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

interface Props {
  visible: boolean;
  x: number;
  y: number;
  agent?: Agent;


  onClose: () => void;

  onEdit: (agent: Agent) => void;
  onRemark: (agent: Agent) => void;
  onTogglePin: (agent: Agent) => void;
  onShare: () => void;
  onReport: () => void;

             
  onRemoveFromChat: (agent: Agent) => void;
}

const AgentContextMenu = forwardRef<HTMLDivElement, Props>(({
  visible,
  x,
  y,
  agent,
    onEdit,
  onRemark,
  onTogglePin,
  onShare,
  onReport,
  onRemoveFromChat,
}, ref) => {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  if (!visible || !agent) return null;

  const protectedSystemAgent =
    Boolean(
      agent.isSuper
      || agent.isDefaultAgent,
    );

  const items: MenuItem[] = [
    ...(protectedSystemAgent
      ? []
      : [{ label: localize('agent.context.edit'), action: () => onEdit(agent) }]),

    { label: localize('agent.context.remark'), action: () => onRemark(agent) },
    { label: agent.pinnedAt ? localize('agent.context.unpin') : localize('agent.context.pin'), action: () => onTogglePin(agent) },
    { label: localize('agent.context.share'), action: onShare },
    { label: localize('agent.context.report'), action: onReport },
  ];

                       
  if (!protectedSystemAgent) {
    items.push({
      label: localize('agent.context.remove'),
      action: () => onRemoveFromChat(agent),
      danger: true,
    });
  }

  return (
    <MoreMenu
      ref={ref}
      items={items}
      theme={isDarkTheme ? 'dark' : 'light'}
      width={100}
      style={{ position: 'fixed', left: x, top: y }}
    />
  );
});

export default AgentContextMenu;