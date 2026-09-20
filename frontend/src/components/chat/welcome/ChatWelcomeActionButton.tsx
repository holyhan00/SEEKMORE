                                                                   

import type {
  MouseEventHandler,
} from 'react';

export default function ChatWelcomeActionButton({
  label,
    onClick,
}: {
  label: string;

  onClick: MouseEventHandler;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        h-[30px]
        shrink-0
        select-none
        whitespace-nowrap
        rounded-full
        px-[10px]
        text-[10px]
        font-medium
        transition-all
        duration-200

        hover:-translate-y-[2px]
        hover:shadow-[0_8px_20px_rgba(12,92,251,0.18)]

        active:translate-y-0
        active:scale-[0.98]

        ${
          'bg-[#e8e8e8] text-[#252525] hover:bg-[#dedede] dark:bg-[#2a2a2a] dark:text-[#f5f5f5] dark:hover:bg-[#333333]'
        }
      `}
    >
      {label}
    </button>
  );
}