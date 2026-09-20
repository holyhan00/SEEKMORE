                                 
import { forwardRef } from 'react';

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

interface ContextMenuProps {
  items: MenuItem[];
  position?: 'left' | 'right';
  theme?: 'light' | 'dark';
  width?: number;
  className?: string;
  style?: React.CSSProperties; 
}

const ContextMenu = forwardRef<HTMLDivElement, ContextMenuProps>(
  ({ 
    items,
    position = 'right',
    theme = 'light',
    width = 100,
    className = '',
    style = {},
  }, ref) => {
    const containerStyle: React.CSSProperties = {
      width: `${width}px`,
      minHeight: '100px',
    };

    return (
      <div 
        ref={ref}
        className={`
          absolute ${position === 'right' ? 'right-0' : 'left-0'} top-6 z-50
          ${theme === 'dark' ? 
            'bg-[#333] text-[#ffffff] shadow-[0_2px_12px_rgba(0,0,0,0.3)]' : 
            'bg-[#ffffff] text-[#111111] shadow-[0_2px_12px_rgba(0,0,0,0.15)]'}
          rounded-[8px] p-[5px] border select-none [&_button]:!select-none [&_button_*]:!select-none
          ${theme === 'dark' ? 'border-[#555]' : 'border-[#e5e5e5]'}
          ${className}
        `}
        style={{ ...containerStyle, ...style }} 
      >
        <div className="flex flex-col space-y-1">
          {items.map((item, index) => (
            <button
              key={index}
              onClick={item.action}
              className={`
                w-full  text-[12px] px-3 py-2 text-left rounded-md
                ${theme === 'dark' ?
                                         
                  `bg-[#333] hover:bg-[#666] ${item.danger ? 'text-[#ff4d4f]' : 'text-[#ffffff]'}` :
                                         
                  `bg-[#ffffff] hover:bg-[#f5f5f5] ${item.danger ? 'text-[#ff4d4f]' : 'text-[#111111]'}`}
                transition-colors duration-200
              `}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
);

export default ContextMenu;