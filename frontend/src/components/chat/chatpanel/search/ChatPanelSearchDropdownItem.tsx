import { resolveAssetUrl } from '../../../../utils/asset-url';
                                                                         
import React from 'react';

import {
  useAuthenticatedImageUrl,
} from '../../../../hooks/useAuthenticatedImageUrl';

interface ChatPanelSearchDropdownItemProps {
  avatarUrl?: string;
  title: string;
  subtitle?: string;

  onClick: () => void;
                           
  scaleWithContainer?: boolean;
}

function clampTextByChar(input: string, maxChars: number): string {
  const arr = Array.from(input || '');
  if (arr.length <= maxChars) return input || '';
  return arr.slice(0, maxChars).join('') + '…';
}

const ChatPanelSearchDropdownItem: React.FC<ChatPanelSearchDropdownItemProps> = ({
  avatarUrl,
  title,
  subtitle,
    onClick,
  scaleWithContainer = true,
}) => {
  const iconSize = scaleWithContainer ? 'clamp(22px, 3vw, 36px)' : '35px';
  const titleSize = scaleWithContainer ? 'clamp(12px, 1.15vw, 14px)' : '12px';
  const subSize   = scaleWithContainer ? 'clamp(10px, 0.95vw, 12px)' : '10px';
  const padY      = scaleWithContainer ? 'clamp(3px, 0.8vw, 12px)' : '10px';
  const padX      = scaleWithContainer ? 'clamp(3px, 0.8vw, 12px)' : '10px';
  const radius    = '8px';

                                    
  const displayTitle = clampTextByChar(title, 8);

                                                    
                  
  const resolvedAvatar =
    avatarUrl && avatarUrl.includes(resolveAssetUrl('/icons/chat.svg'))
      ? resolveAssetUrl('/avatars/DefaultAvatar2.svg')
      : avatarUrl;
  const displayedAvatar =
    useAuthenticatedImageUrl(resolvedAvatar);

  return (
    <div
      onClick={onClick}
      className={`
        w-[95%] max-w-[95%] mx-auto
        overflow-hidden box-border
        border rounded-[8px] cursor-pointer transition-colors duration-150
        ${'bg-[#ffffff] hover:bg-[#f7f7f7] border-[#efefef] text-theme-primary dark:bg-[#1b1b1b] dark:hover:bg-[#222] dark:border-[#2a2a2a] '
        }
      `}
      style={{
        padding: `${padY} ${padX}`,
        borderRadius: radius,
      }}
    >
      <div className="flex items-center gap-[5px] min-w-0">
        {                           }
        <div
          className="flex-shrink-0 rounded-[6px] overflow-hidden flex items-center justify-center"
          style={{
            width: iconSize,
            height: iconSize,
            background: '#cccccc',
          }}
        >
          {displayedAvatar ? (
            <img
              src={displayedAvatar}
              alt="" aria-hidden="true"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <img
              src={resolveAssetUrl('/icons/search.svg')}
              alt="" aria-hidden="true"
              style={{ width: '70%', height: '70%', opacity: 0.7 }}
              draggable={false}
            />
          )}
        </div>

        {                                 }
        <div className="min-w-0 flex-1">
          <div
            className="font-medium truncate leading-tight"
            style={{ fontSize: titleSize, lineHeight: 1.15 }}
            title={title}
          >
            {displayTitle}
          </div>
          {subtitle && (
            <div
              className="truncate opacity-70 leading-tight"
              style={{ fontSize: subSize, lineHeight: 1.2, marginTop: 2 }}
              title={subtitle}
            >
              {subtitle}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatPanelSearchDropdownItem;