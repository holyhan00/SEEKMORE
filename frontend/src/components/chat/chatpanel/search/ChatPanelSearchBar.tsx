import { resolveAssetUrl } from '../../../../utils/asset-url';
                                                                
import React from 'react';
import { useLocalize } from '../../../../localization/useLocalize';
interface Props {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;

  placeholder?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  className?: string; 
}

const ChatPanelSearchBar: React.FC<Props> = ({
  value, onChange, onFocus, onBlur,   placeholder,
  inputRef, className,
}) => {
  const localize = useLocalize();
  return (
    <div
      className={`relative flex items-center rounded-[8px] h-[30px] transition-colors ${className || ''} 
        ${'bg-[#e8e8e8] text-theme-primary dark:bg-[#222222] '}
      `}
      style={{ boxShadow: 'none', width: '100%', userSelect: 'none' }}
    >
      {          }
      <div
        className="absolute left-[10px] top-1/2 -translate-y-1/2 pointer-events-none opacity-60 flex items-center"
        style={{ userSelect: 'none' }}
      >
        <img
          src={resolveAssetUrl('/icons/search.svg')}
          alt="" aria-hidden="true"
          className="w-[14px] h-[14px]"
          draggable={false}
          style={{ userSelect: 'none' }}
        />
      </div>

      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder ?? localize('chat.search.placeholder')}
        className={`w-full bg-transparent outline-none text-[12px] placeholder:opacity-50 ${'text-theme-primary '}`}
        style={{
          paddingLeft: 34, 
          paddingRight: 10,
          height: '100%',
          boxShadow: 'none',
          WebkitBoxShadow: 'none',
          border: 'none',
          outline: 'none',
          userSelect: 'none', 
        }}
      />
    </div>
  );
};

export default ChatPanelSearchBar;