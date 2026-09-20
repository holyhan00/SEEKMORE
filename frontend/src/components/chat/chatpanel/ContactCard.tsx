                                                         
import { useLocalize } from '../../../localization/useLocalize';
import { getAvatarInitial } from '../../../utils/avatar-initial';

import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  useAuthenticatedImageUrl,
} from '../../../hooks/useAuthenticatedImageUrl';

interface ContactCardProps {
  avatarUrl?: string;
  avatarFallbackText?: string;
  name: string;
  lastMessage: string;

  isSelected: boolean;
  onClick: () => Promise<void>;

  editable?: boolean;
  onNameChange?: (newName: string) => void;
  onCancelEdit?: () => void;
}

const ContactCard: React.FC<ContactCardProps> = ({
  avatarUrl,
  avatarFallbackText,
  name,
  lastMessage,
    isSelected,
  onClick,

  editable = false,
  onNameChange,
  onCancelEdit,
}) => {
  const localize = useLocalize();
  const [value, setValue] = useState(name);
  const resolvedAvatarUrl =
    useAuthenticatedImageUrl(avatarUrl);
  const inputRef =
    useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setValue(name);
  }, [name]);

  useEffect(() => {
    if (editable && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editable]);

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onNameChange?.(value.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancelEdit?.();
    }
  };

  return (
    <div
      className={`
        box-border
        flex
        min-w-0
        w-full
        max-w-full
        cursor-pointer
        items-center
        overflow-hidden
        rounded-[8px]
        p-[5px]
        transition-colors
        duration-200
        ${
          isSelected
            ? 'bg-[#e8e8e8] text-theme-primary dark:bg-[#292929] '
            : 'bg-surface-base text-theme-primary  '
        }
      `}
      aria-selected={isSelected}
      onClick={onClick}
    >
      <div
        className="
          flex
          min-w-0
          w-full
          max-w-full
          items-center
          gap-[10px]
          overflow-hidden
        "
      >
        {        }
        <div
          className="
            h-[36px]
            w-[36px]
            shrink-0
            overflow-hidden
            rounded-[6px]
            bg-accent-surface
            text-accent-foreground
          "
        >
          {resolvedAvatarUrl ? (
            <img
              src={resolvedAvatarUrl}
              alt={localize('common.avatarAlt')}
              className="
                h-full
                w-full
                object-cover
              "
              style={{
                userSelect: 'none',
              }}
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center text-[16px] font-semibold leading-none"
              style={{
                userSelect: 'none',
              }}
            >
              {getAvatarInitial(
                avatarFallbackText || name,
                'A',
              )}
            </div>
          )}
        </div>

        {         }
        <div
          className="
            flex
            min-w-0
            flex-1
            flex-col
            overflow-hidden
          "
        >
          {            }
          {editable ? (
            <input
              ref={inputRef}
              value={value}
              onChange={(e) =>
                setValue(e.target.value)
              }
              onKeyDown={handleKeyDown}
              onBlur={() =>
                onNameChange?.(value.trim())
              }
              placeholder={localize('chat.contact.remarkPlaceholder')}
              className={`
                box-border
                min-w-0
                w-[120px]
                max-w-full
                rounded-[6px]
                border
                border-transparent
                px-[2px]
                py-[2px]
                text-[8px]
                font-medium
                leading-[20px]
                outline-none
                ring-0
                transition-[border-color]
                duration-150
                focus:border-[#0c5cfb]
                focus:shadow-none
                focus:ring-0
                ${
                  'bg-surface-raised text-theme-primary  '
                }
              `}
              style={{
                boxShadow: 'none',
                WebkitBoxShadow: 'none',
              }}
            />
          ) : (
            <div
              className="
                min-w-0
                max-w-full
                truncate
                text-[12px]
                font-medium
                leading-[22px]
              "
              style={{
                userSelect: 'none',
              }}
            >
              {name}
            </div>
          )}

          <div
            className="
              min-w-0
              max-w-full
              truncate
              text-[10px]
              leading-[16px]
              opacity-60
            "
            style={{
              userSelect: 'none',
            }}
          >
            {lastMessage}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContactCard;
