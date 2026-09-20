                                                   
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SettingMenu, { SettingMenuKey } from './SettingMenu';
import SettingContent from './SettingContent';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialActiveKey?: SettingMenuKey;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialActiveKey = 'general',
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [activeKey, setActiveKey] =
    useState<SettingMenuKey>(initialActiveKey);

  const handleOutsideClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) onClose();
  };

  if (!isOpen) return null;

  const modalBgClass = 'bg-surface-button-muted text-theme-strong  ';

  const portalContainer =
    document.getElementById('shell-portal')
    ?? document.body;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center w-full h-full backdrop-blur-sm select-none"
      onClick={handleOutsideClick}
      role="presentation"
    >
      <div
        ref={modalRef}
        className={`relative w-[700px] h-[500px] ${modalBgClass} rounded-[20px] select-none [&_input]:select-text [&_textarea]:select-text [&_select]:select-text
        shadow-[0_20px_50px_rgba(0,0,0,0.3),0_15px_30px_rgba(0,0,0,0.2),0_10px_15px_rgba(0,0,0,0.1)]
        transition-all duration-300 flex overflow-hidden`}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="w-[240px]">
          <SettingMenu
            activeKey={activeKey}
            onSelect={setActiveKey}
          />
        </div>

        <div className="flex-1 overflow-hidden">
          <SettingContent
            activeKey={activeKey}
          />
        </div>
      </div>
    </div>,
    portalContainer,
  );
};

export default SettingsModal;
