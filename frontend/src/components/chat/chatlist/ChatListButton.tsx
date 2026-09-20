import { resolveAssetUrl } from '../../../utils/asset-url';
import { useAppearance } from '../../../theme/useAppearance';

                                                           
import React, { useState, useRef, useEffect } from 'react';
import ChatListDropdown from './ChatListDropdown';
import { useLocalize } from '../../../localization/useLocalize';

interface ChatListButtonProps {
  title: string;

  onDropdownClick?: () => void;
  onSelect: (id: string) => void;
  onRename?: (newTitle: string) => Promise<void> | void; 
  disabled?: boolean;
  renameOnly?: boolean;

  chats?: { id: string; title: string }[];
  loading?: boolean;
  titleLoading?: boolean;
}

const TAG = '[ChatListButton]';

const ChatListButton: React.FC<ChatListButtonProps> = ({
  title,
    onDropdownClick,
  onSelect,
  onRename,
  disabled = false,
  renameOnly = false,
  chats = [],
  loading = false,
  titleLoading = false,
}) => {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setDraft(title), [title]);
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;

    if ((e.detail ?? 1) >= 2) {
      if (!titleLoading) {
                                                      
        setEditing(true);
      }
      return;
    }

    if (renameOnly) return;

    if (editing) return;
    onDropdownClick?.();
    setIsOpen((v) => !v);
  };

  const close = () => setIsOpen(false);

  const handleRenameConfirm = async () => {
    const newTitle = draft.trim();
    if (!newTitle || newTitle === title) {
                                                                        
      setEditing(false);
      return;
    }
                                                                      
    try {
      await onRename?.(newTitle);
    } catch (e) {
      console.error(TAG, 'rename failed', e);
    } finally {
      setEditing(false);
    }
  };

  return (
    <div className="relative">
      <div
        className={`relative flex h-[30px] w-[200px] min-w-0 items-center ${
          'bg-surface-input '
        } rounded-[12px] ${isOpen ? 'rounded-b-none' : ''} transition-all duration-300 ${
          disabled ? 'cursor-default' : 'cursor-pointer'
        } 
        ${editing ? 'outline outline-1 outline-[#348CFF]' : 'outline-none'}`} 
        onClick={handleClick}
        {...(!disabled && !renameOnly && { role: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': isOpen })}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleRenameConfirm}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameConfirm();
              if (e.key === 'Escape') setEditing(false);
            }}
            className={`h-full min-w-0 flex-1 bg-transparent px-[10px] pr-[38px] text-[10px] leading-[18px]  outline-none border-none ${
              'text-theme-primary '
            }`}
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate whitespace-nowrap px-[10px] pr-[38px] text-left text-[10px] leading-[18px]  text-current"
            title={title}
            style={{ userSelect: 'none' }}     
          >
            {title}
          </span>
        )}

        {!disabled && !editing && (
          <>
            {titleLoading ? (
              <span
                aria-label={localize('chat.titleGenerating')}
                className="absolute right-[14px] top-1/2 -translate-y-1/2 w-[14px] h-[14px]
                           border-[1px] border-current/25 border-t-current rounded-full animate-spin"
              />
            ) : (
              !renameOnly && (
                <img
                  src={isDarkTheme ? resolveAssetUrl('/icons/white/arrow-down1.svg') : resolveAssetUrl('/icons/arrow-down.svg')}
                  alt={localize('chat.expand')}
                  className="w-[14px] h-[14px] absolute right-[14px] top-1/2 transform -translate-y-1/2 select-none"
                  style={{ userSelect: 'none' }}   
                  draggable={false}               
                />
              )
            )}
          </>
        )}
      </div>

      {!disabled && isOpen && !renameOnly && (
        <ChatListDropdown
          isOpen={isOpen}
          chats={chats}
          loading={loading}

          onSelect={(id) => {
            onSelect(id);
            close();
          }}
          onClose={close}
        />
      )}
    </div>
  );
};

export default ChatListButton;