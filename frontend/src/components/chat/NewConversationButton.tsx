import { resolveAssetUrl } from '../../utils/asset-url';
                                                         
import React from 'react';
import { useLocalize } from '../../localization/useLocalize';

interface NewConversationButtonProps {

  onClick: () => void;
}

const NewConversationButton: React.FC<NewConversationButtonProps> = ({
    onClick,
}) => {
  const localize = useLocalize();
  const baseBg = 'bg-surface-input ';
  const hoverBg = 'hover:bg-[#0c5cfb]';

  return (
    <button
      type="button"
      onClick={onClick}
      title={localize('chat.newConversation')}
      className={`
        group relative w-[48px] h-[30px] rounded-[12px]
        ${baseBg} ${hoverBg}
        flex items-center justify-center
        transition-all duration-150 ease-in-out
        focus:outline-none active:scale-[0.97]
      `}
      style={{ userSelect: 'none' }} 
    >
      {           }
      <img
        src={resolveAssetUrl('/icons/new.svg')}
        alt={localize('chat.newConversation')}
        className="w-[18px] h-[18px] opacity-100 group-hover:opacity-0 transition-opacity duration-150 ease-in-out"
        style={{ userSelect: 'none' }} 
        draggable={false} 
      />

      {              }
      <img
        src={resolveAssetUrl('/icons/white/new1.svg')}
        alt={localize('chat.newConversation')}
        className="w-[18px] h-[18px] absolute opacity-0 group-hover:opacity-100 transition-opacity duration-150 ease-in-out"
        style={{ userSelect: 'none' }} 
        draggable={false} 
      />
    </button>
  );
};

export default NewConversationButton;