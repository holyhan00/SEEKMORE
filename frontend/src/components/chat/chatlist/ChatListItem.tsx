                                       
import React, { useEffect, useRef, useState, useCallback } from 'react';
import MoreAction from '../../ui/MoreActions';
import { useConversationActions } from '../hooks/useConversationActions';

interface ChatListItemProps {
  chat: { id: string; title: string };
  onClick: () => void;

}

const ChatListItem: React.FC<ChatListItemProps> = ({ chat, onClick }) => {
  const bgClass = 'hover:bg-surface-button-hover ';

               
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.title);
  const inputRef = useRef<HTMLInputElement>(null);

                   
  const { remark, remarkingId, isBusy } = useConversationActions();

                      
  useEffect(() => {
    const onEdit = (e: Event) => {
      const ce = e as CustomEvent<{ id: string }>;
      if (ce?.detail?.id === chat.id) {
        setDraft(chat.title);
        setEditing(true);
                     
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      } else {
                         
        setEditing(false);
      }
    };
    window.addEventListener('chatlist:remark:edit' as any, onEdit as EventListener);
    return () => window.removeEventListener('chatlist:remark:edit' as any, onEdit as EventListener);
  }, [chat.id, chat.title]);

                                  
  useEffect(() => {
    if (!editing) setDraft(chat.title);
  }, [chat.title, editing]);

  const submitting = remarkingId === chat.id;

  const submit = useCallback(async () => {
    const next = (draft || '').trim();
                 
    if (!next || next === chat.title) {
      setEditing(false);
      return;
    }
    try {
      await remark(chat.id, next);
    } finally {
      setEditing(false);
    }
  }, [draft, chat.id, chat.title, remark]);

  return (
    <div
      className={`flex items-center justify-between w-full box-border mx-auto rounded-[8px] cursor-pointer
                  h-[40px] px-[10px] pr-2 transition ${bgClass}`}
      onClick={() => {
        if (!editing) onClick();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (editing) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {                  }
      <div className="min-w-0 flex-1 truncate text-[10px] leading-[18px] " title={chat.title}>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') setEditing(false);
            }}
            disabled={submitting || isBusy}
            className={`w-full h-[24px] px-[6px] rounded-[6px] outline-none border-none bg-transparent text-[10px] leading-[18px]
              ${'text-theme-primary '}
            `}
                                      
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span style={{ userSelect: 'none' }}>{chat.title}</span> 
        )}
      </div>

      {                       }
      <div
        className="flex-none ml-2"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <MoreAction chatId={chat.id}  />
      </div>
    </div>
  );
};

export default ChatListItem;