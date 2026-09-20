                                           
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocalize } from '../../../localization/useLocalize';
import ChatListItem from './ChatListItem';

interface ChatListDropdownProps {
  chats: { id: string; title: string }[];
  onSelect: (id: string) => void;

  onClose: () => void;
  isOpen: boolean;
  loading?: boolean;
  currentConversationId?: string;
}

const ChatListDropdown: React.FC<ChatListDropdownProps> = ({
  chats,
  onSelect,
    onClose,
  isOpen,
  loading = false,
}) => {
  const localize = useLocalize();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [rowStep, setRowStep] = useState<number>(0);

  const bgClass = 'bg-[#f2f2f2] text-[#2a2a2a] dark:bg-[#2a2a2a] dark:text-[#f2f2f2]';

                 
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

                                                                                 
  useLayoutEffect(() => {
    if (!isOpen) return;

    const measure = () => {
      const list = listRef.current;
      if (!list || list.children.length === 0) return;

      const first = list.children[0] as HTMLElement | undefined;
      const second = list.children[1] as HTMLElement | undefined;

      let step = 0;

      if (first && second) {
        const top1 = first.getBoundingClientRect().top;
        const top2 = second.getBoundingClientRect().top;
        step = top2 - top1; 
      } else if (first) {
        const rect = first.getBoundingClientRect();
        const cs = window.getComputedStyle(first);
        const mt = parseFloat(cs.marginTop || '0');
        const mb = parseFloat(cs.marginBottom || '0');
        step = rect.height + mt + mb;
      }

      if (step > 0 && Math.abs(step - rowStep) > 0.5) {
        setRowStep(step);
      }
    };

    measure();
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [isOpen, chats.length, rowStep]);

  const needScroll = chats.length > 6;
  const maxHeightPx = needScroll ? (rowStep ? Math.max(0, rowStep * 6 - 1) : 240) : undefined;

  return (
    <div
      ref={dropdownRef}
      className={`absolute left-0 top-full w-[200px] rounded-b-[10px] ${bgClass} shadow-lg
        transition-all duration-300 origin-top 
        ${isOpen ? 'mt-0 opacity-100 pointer-events-auto' : 'mt-[-10px] opacity-0 pointer-events-none'}
      `}
      style={{
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
        pointerEvents: isOpen ? 'auto' : 'none',
      }}
    >
      {loading ? (
        <div className="text-[10px] leading-[18px] text-gray-500 text-center py-2">{localize('common.loading')}</div>
      ) : chats.length === 0 ? (
        <div className="text-[10px] leading-[18px] text-gray-500 text-center py-2">{localize('chat.history.empty')}</div>
      ) : (
        <div
          ref={listRef}
          className={needScroll ? 'overflow-y-auto scroll-container' : ''}
          style={maxHeightPx ? { maxHeight: `${maxHeightPx}px` } : undefined}
        >
          {chats.map((chat) => (
            <ChatListItem
              key={chat.id}
              chat={chat}

              onClick={() => {
                onSelect(chat.id);
                onClose();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatListDropdown;