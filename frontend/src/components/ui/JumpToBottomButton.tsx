import { resolveAssetUrl } from '../../utils/asset-url';
                                                   
import React from 'react';
import { useLocalize } from '../../localization/useLocalize';
import LiquidGlass from '../../styles/LiquidGlass';

type Props = {
  visible: boolean;
  onClick: () => void;

                                          


  unreadCount?: number;
  className?: string;

               
  sizePx?: number;

                                    
  glassOpacity?: number;

                                    
  showSpecular?: boolean;        
  specularOpacity?: number;
  showStroke?: boolean;          
  strokeOpacity?: number;
  showShadow?: boolean;          
  shadowOpacity?: number;
};

const JumpToBottomButton: React.FC<Props> = ({
  visible,
  onClick,
  unreadCount,
  className = '',
  sizePx = 32,
  glassOpacity = 1.0,
  showSpecular,
  specularOpacity,
  showStroke,
  strokeOpacity,
  showShadow,
  shadowOpacity,
}) => {
  const localize = useLocalize();
  const radius = sizePx / 2;

  return (
    <LiquidGlass
      visible={visible}
      width={sizePx}
      height={sizePx}
      radius={radius}
      glassOpacity={glassOpacity}
      className={className}
      {...(showSpecular !== undefined ? { showSpecular } : {})}
      {...(specularOpacity !== undefined ? { specularOpacity } : {})}
      {...(showStroke !== undefined ? { showStroke } : {})}
      {...(strokeOpacity !== undefined ? { strokeOpacity } : {})}
      {...(showShadow !== undefined ? { showShadow } : {})}
      {...(shadowOpacity !== undefined ? { shadowOpacity } : {})}
    >
      {          }
      <button
        type="button"
        onClick={onClick}
        aria-label={localize('chat.jumpToBottom')}
        style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          width: '100%',
          height: '100%',
          borderRadius: radius,
          pointerEvents: visible ? 'auto' : 'none',
          lineHeight: 0,
        }}
        className="
          relative flex select-none items-center justify-center [&_*]:!select-none
          hover:scale-105 active:scale-95 transition-transform
          rounded-full
        "
      >
        {        }
        <img
          src={resolveAssetUrl('/icons/arrow-down.svg')}
          alt=""
          width={16}
          height={16}
          aria-hidden="true"
          className="block"
        />

        {              }
        {typeof unreadCount === 'number' && unreadCount > 0 && (
          <span
            className="
              absolute -top-1 -right-1 min-w-[16px] h-[16px] px-[4px]
              rounded-full text-[10px] leading-[16px] text-[#ffffff]
              bg-red-500 text-center
            "
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </LiquidGlass>
  );
};

export default JumpToBottomButton;