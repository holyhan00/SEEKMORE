                                              

import type {
  MouseEvent,
} from 'react';
import { useLocalize } from '../../localization/useLocalize';

interface ToggleSwitchProps {
  checked: boolean;

  disabled?: boolean;
  loading?: boolean;
  ariaLabel: string;
  className?: string;
  onChange: (
    checked: boolean,
  ) => void;
}

export default function ToggleSwitch({
  checked,
  disabled = false,
  loading = false,
  ariaLabel,
  className = '',
  onChange,
}: ToggleSwitchProps) {
  const localize = useLocalize();
  const blocked =
    disabled || loading;

  const handleClick = (
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();

    if (blocked) {
      return;
    }

    onChange(!checked);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      disabled={blocked}
      onClick={handleClick}
      className={`
        relative
        h-[18px]
        w-[36px]
        shrink-0
        select-none
        overflow-hidden
        rounded-full
        border-0
        outline-none
        transition-all
        duration-200
        focus-visible:ring-2
        focus-visible:ring-[#0c5cfb]/40
        disabled:cursor-not-allowed
        disabled:opacity-55
        ${
          checked
            ? '!bg-[#0c5cfb]'
            : '!bg-[#ffffff]'
        }
        ${className}
      `}
    >
      <span
        className={`
          pointer-events-none
          absolute
          left-[5px]
          top-1/2
          -translate-y-1/2
          text-[6px]
          font-semibold
          leading-none
          !text-[#ffffff]
          transition-opacity
          duration-200
          ${
            checked
              ? 'opacity-100'
              : 'opacity-0'
          }
        `}
      >
        {localize('common.toggle.on')}
      </span>

      <span
        className={`
          pointer-events-none
          absolute
          right-[4px]
          top-1/2
          -translate-y-1/2
          text-[6px]
          font-semibold
          leading-none
          !text-[#0c5cfb]
          transition-opacity
          duration-200
          ${
            checked
              ? 'opacity-0'
              : 'opacity-100'
          }
        `}
      >
        {localize('common.toggle.off')}
      </span>

      <span
        className={`
          pointer-events-none
          absolute
          left-[2px]
          top-[2px]
          h-[14px]
          w-[14px]
          rounded-full
          shadow-[0_2px_5px_rgba(0,0,0,0.2)]
          transition-all
          duration-200
          ${
            checked
              ? 'translate-x-[18px] bg-[#ffffff]'
              : 'translate-x-0 bg-action-primary'
          }
        `}
      />

      {loading && (
        <span
          className="
            pointer-events-none
            absolute
            inset-0
            z-10
            bg-[#000000]/10
          "
        />
      )}
    </button>
  );
}