import { resolveAssetUrl } from '../../utils/asset-url';
import { useAppearance } from '../../theme/useAppearance';
                                             
import { useLocalize } from '../../localization/useLocalize';

import { useState, useRef, FC, useEffect } from 'react';
import { createPortal } from 'react-dom';
import MoreMenu, { MenuItem } from './MoreMenu';
import { useConversationActions } from '../chat/hooks/useConversationActions';
import { confirm, confirmBus } from '../../lib/confirm';
import { fetchAutomationSummary } from '../chat/automation/automation.api';
import { clearConversationAutomations } from '../chat/automation/automation.store';

type MouseEventCallback = (event: globalThis.MouseEvent) => void;
const isNode = (t: EventTarget | null): t is Node => t instanceof Node;

interface ChatListItemActionsProps {
  chatId: string;

}

const MENU_ESTIMATED_WIDTH = 240;

const ChatListItemActions: FC<ChatListItemActionsProps> = ({ chatId }) => {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const [showMenu, setShowMenu] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const { remove, isBusy } = useConversationActions();

  const updatePosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = rect.left;
    const top = rect.bottom + 6;
    const overflowRight = left + MENU_ESTIMATED_WIDTH - window.innerWidth + 8;
    if (overflowRight > 0) left = Math.max(8, left - overflowRight);
    setCoords({ top, left });
  };

  useEffect(() => {
    const onWillOpen = (e: Event) => {
      const ce = e as CustomEvent<{ id: string }>;
      if (ce?.detail?.id !== chatId) setShowMenu(false);
    };
    window.addEventListener('chatlist:moremenu:willOpen' as any, onWillOpen as EventListener);
    return () => window.removeEventListener('chatlist:moremenu:willOpen' as any, onWillOpen as EventListener);
  }, [chatId]);

                             
  useEffect(() => {
    const unsub = confirmBus.subscribe(() => setShowMenu(false));
    return () => unsub();
  }, []);

  const toggleMenu = () => {
    const willOpen = !showMenu;
    if (willOpen) {
      window.dispatchEvent(new CustomEvent('chatlist:moremenu:willOpen', { detail: { id: chatId } }));
      setShowMenu(true);
      updatePosition();
      requestAnimationFrame(updatePosition);
    } else {
      setShowMenu(false);
    }
  };

  const handleClickOutside: MouseEventCallback = (event) => {
    const target = event.target;
    if (!isNode(target)) return;
    if (showMenu && !menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
      setShowMenu(false);
    }
  };

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [showMenu]);

  const onRemark = async () => {
                                                          
                       
    window.dispatchEvent(new CustomEvent('chatlist:remark:edit', { detail: { id: chatId } }));
    setShowMenu(false);
  };

  const onDelete = async () => {
                                                          
                        
    setShowMenu(false);

    let activeAutomationCount = 0;
    try {
      activeAutomationCount = (await fetchAutomationSummary(chatId)).activeCount;
    } catch (error) {
      console.warn('[MoreActions] automation summary failed', error);
    }

    const ok = await confirm({
      title: localize('conversation.more.deleteTitle'),
      description: activeAutomationCount > 0
        ? localize('conversation.more.deleteWithAutomations', { count: activeAutomationCount })
        : localize('conversation.more.deleteDescription'),
      confirmText: activeAutomationCount > 0 ? localize('conversation.more.deleteAndEnd') : localize('common.actions.delete'),
      cancelText: localize('common.actions.cancel'),
      danger: true,
    });
                                                         
    if (!ok) return;

    try {
      await remove(chatId);
      clearConversationAutomations(chatId);
                                                            
    } catch (e) {
      console.error('[MoreActions] delete failed', e);
      alert(localize('conversation.more.deleteFailed'));
    }
  };

  const menuItems: MenuItem[] = [
    { label: localize('conversation.more.remark'), action: onRemark },
    { label: localize('conversation.more.delete'), action: onDelete, danger: true },
    { label: localize('conversation.more.report'), action: () => alert(localize('conversation.more.reportMessage', { id: chatId })) },
  ];

  return (
    <div className="relative select-none [&_*]:!select-none">
      <div
        ref={triggerRef}
        onClick={toggleMenu}
        className="
          cursor-pointer 
          hover:bg-[#C6C6C6] dark:hover:bg-[#444]
          rounded-[8px] p-1.5 transition-colors duration-200 
          flex items-center justify-center 
          w-[30px] h-[30px] rounded-[5px]
        "
        title={isBusy ? localize('conversation.more.processing') : undefined}
        style={{ opacity: isBusy ? 0.7 : 1, pointerEvents: isBusy ? 'none' : 'auto' }}
      >
        <img
          src={isDarkTheme ? resolveAssetUrl('/icons/white/more1.svg') : resolveAssetUrl('/icons/more.svg')}
          alt={localize('conversation.more.moreActions')}
          className="w-[14px] h-[14px]"
        />
      </div>

      {showMenu &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: `${coords.top}px`, left: `${coords.left}px`, zIndex: 9999 }}
          >
            <MoreMenu items={menuItems} theme={isDarkTheme ? 'dark' : 'light'} />
          </div>,
          document.body
        )}
    </div>
  );
};

export default ChatListItemActions;