import { resolveAssetUrl } from '../../utils/asset-url';
import { useLocalize } from '../../localization/useLocalize';
                                             
import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;

  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  portalContainerId?: string;
                       
  cancelClassName?: string;
  confirmClassName?: string;
                
  overlayOpacity?: number;             
  backdropBlur?: number;            
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
    title,
  description,
  confirmText,
  cancelText,
  danger = true,
  portalContainerId = 'shell-portal',
  cancelClassName,
  confirmClassName,
  overlayOpacity = 0.5,
  backdropBlur = 0.3,
}) => {
  const localize = useLocalize();
  const container = useMemo(
    () => document.getElementById(portalContainerId) ?? document.body,
    [portalContainerId]
  );

  useEffect(() => {
             
                                                         
  }, [isOpen]);

  if (!isOpen) return null;

  const modalBgClass = 'bg-surface-button-muted text-gray-800  dark:text-[#ffffff]';

  const confirmBtnBase =
    'w-[90px] px-4 py-2.5 rounded-[15px] text-sm font-medium transition';
  const confirmBtnClass = confirmClassName
    ? `${confirmBtnBase} ${confirmClassName}`
    : danger
    ? `${confirmBtnBase} bg-[#ef4d4d] hover:bg-[#f9caca] text-[#ffffff]`
    : `${confirmBtnBase} bg-action-primary hover:bg-[#3a7bff] text-[#ffffff]`;

  const cancelBtnBase =
    'w-[90px] px-4 py-2.5 rounded-[15px] text-sm font-medium transition';
  const cancelBtnClass = cancelClassName
    ? `${cancelBtnBase} ${cancelClassName}`
    : `${cancelBtnBase} bg-[#f5f5f5] hover:bg-surface-button-hover text-gray-800 dark:bg-[#2f2f2f]  dark:text-[#ffffff]`;

  const node = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        pointerEvents: 'none',
      }}
    >
      {         }
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `rgba(0,0,0,${overlayOpacity})`,
          backdropFilter: backdropBlur ? `blur(${backdropBlur}px)` : undefined,
          boxShadow: '0 0 40px rgba(0,0,0,0.25)',
          pointerEvents: 'auto',
        }}
        onClick={onClose}
      />

      {          }
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        {        }
        <div
          className={`${modalBgClass} rounded-[15px] w-[400px] p-8 pointer-events-auto select-none [&_button]:!select-none [&_button_*]:!select-none`}
          style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.15)' }}
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-[14px] font-bold flex items-center py-[5px] ml-[10px]">
            <img src={resolveAssetUrl('/icons/warn.svg')} alt="" aria-hidden="true" className="w-[20px] h-[20px] mr-[10px]" />
            {title}
          </h2>

          {description && (
            <p className="text-gray-400 text-sm ml-[12px] mb-6">{description}</p>
          )}

          <div className="flex justify-end gap-[10px] mr-[10px] mb-[10px]">
            <button onClick={onClose} className={cancelBtnClass}>
              {cancelText ?? localize('common.confirm.cancel')}
            </button>
            <button onClick={onConfirm} className={confirmBtnClass}>
              {confirmText ?? localize('common.confirm.delete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, container);
};

export default ConfirmModal;