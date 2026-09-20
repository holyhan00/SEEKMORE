                                                 
import React from 'react';
import type {
  CSSProperties,
  ReactNode,
} from 'react';

interface TimeCardProps {

  emptyText?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

interface TimeCardTimeProps {
  children: ReactNode;
  isDue?: boolean;
}

export const TIME_CARD_HEIGHT = 60;

const TIME_CARD_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  height: TIME_CARD_HEIGHT,
  minHeight: TIME_CARD_HEIGHT,
  maxHeight: TIME_CARD_HEIGHT,
};

export const TimeCardTime: React.FC<TimeCardTimeProps> = ({
  children,
  isDue = false,
}) => {
  return (
    <div
      className={`
        shrink-0
        mt-[4px]
        text-right
        text-[12px]
        font-semibold
        leading-none
        tabular-nums
        ${isDue ? 'text-red-500' : ''}
      `}
    >
      {children}
    </div>
  );
};

const TimeCard: React.FC<TimeCardProps> = ({
    emptyText,
  actions,
  children,
}) => {
  const cardClass = 'bg-surface-input ';

  const emptyTextClass = 'text-[#686868] dark:text-[#a8a8a8]';

  return (
    <div
      className={`
        relative
        flex
        shrink-0
        select-none
        overflow-hidden
        rounded-[8px]
        p-[5px]
        [&_button]:!select-none
        [&_button_*]:!select-none
        ${cardClass}
      `}
      style={TIME_CARD_STYLE}
    >
      {emptyText ? (
        <div
          className={`
            flex
            h-full
            min-h-0
            w-full
            items-center
            justify-center
            text-[7px]
            leading-none
            ${emptyTextClass}
          `}
        >
          {emptyText}
        </div>
      ) : (
        <div className="min-h-0 min-w-0 w-full">
          {children}
        </div>
      )}

      {!emptyText && actions && (
        <div
          className="
            absolute
            bottom-[5px]
            right-[5px]
            flex
            items-center
            gap-[5px]
          "
        >
          {actions}
        </div>
      )}
    </div>
  );
};

export default TimeCard;