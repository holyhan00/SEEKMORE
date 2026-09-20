import { useLocalize } from '../../../localization/useLocalize';
import type {
  MouseEvent,
} from 'react';
import {
  X,
} from 'lucide-react';

export interface ObjectRemoveButtonProps {
  disabled?: boolean;
  onRemove: () => void;
}

export default function ObjectRemoveButton({
  disabled = false,
  onRemove,
}: ObjectRemoveButtonProps) {
  const localize = useLocalize();
  const label = disabled
    ? localize('object.removeAfterProcessed')
    : localize('object.removeAttachment');

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(
        event: MouseEvent<HTMLButtonElement>,
      ) => {
        event.preventDefault();
        event.stopPropagation();

        if (!disabled) {
          onRemove();
        }
      }}
      className={[
        'flex h-[16px] w-[16px] shrink-0',
        'appearance-none items-center justify-center overflow-hidden',
        'rounded-full p-0 leading-none',
        'bg-[#191919]/50 text-[#ffffff] outline-none transition',
        'hover:bg-[#191919]',
        'disabled:cursor-not-allowed disabled:opacity-45',
      ].join(' ')}
      style={{
        width: 16,
        height: 16,
        minWidth: 16,
        minHeight: 16,
        maxWidth: 16,
        maxHeight: 16,
        padding: 0,
      }}
      aria-label={label}
      title={label}
    >
      <X
        size={10}
        strokeWidth={2}
        aria-hidden="true"
        className="pointer-events-none shrink-0"
      />
    </button>
  );
}
