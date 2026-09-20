//frontend/src/components/chat/object-card/ObjectCard.tsx
import { useLocalize } from '../../../localization/useLocalize';
import clsx from 'clsx';

import type {
  ObjectCardProps,
} from './object-card.types';
import {
  formatDisplaySize,
  resolveFileIcon,
} from './object-card.utils';

export default function ObjectCard({
  title,
  filename,
  size,
  statusText,
  fileType,
  onClick,
    layout = 'compact',
  action,
  children,
  className,
  disabled: disabledProp,
  interactive: interactiveProp,
}: ObjectCardProps) {
  const localize = useLocalize();
  const displayName = String(
    title || filename || localize('object.generatedFile'),
  ).trim();

  const downloadName = String(
    filename || displayName,
  ).trim();


  const interactive =
    interactiveProp
    ?? Boolean(onClick);

  const disabled =
    disabledProp
    ?? !interactive;

  const displaySize =
    formatDisplaySize(size);

  const metadata = [
    displaySize,
    statusText,
  ].filter(Boolean).join(' · ');

  const icon = resolveFileIcon(
    fileType,
    downloadName,
  );

  const compact =
    layout === 'compact';

  const visibleName =
    compact
      ? shortenFilename(
          displayName,
          16,
        )
      : displayName;

  const activate = () => {
    if (
      disabled
      || !interactive
      || !onClick
    ) {
      return;
    }

    onClick();
  };

  return (
    <div
      className={clsx(
        'group/object-card relative shrink-0 select-none overflow-hidden rounded-[9px] text-left',
        'transition-all duration-200',
        compact
          ? 'h-[60px] w-[240px]'
          : 'w-full max-w-[520px]',
        'bg-[#ffffff] dark:bg-[linear-gradient(180deg,#2b2b2b_0%,#242424_100%)]',
        interactive
          && !disabled
          && 'hover:-translate-y-[1px] hover:shadow-lg',
        disabled
          && interactive
          && 'opacity-60',
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/object-card:opacity-100"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent)',
        }}
      />

      <button
        type="button"
        disabled={disabled}
        onClick={activate}
        className={clsx(
          'relative z-10 block w-full min-w-0 border-0 bg-transparent p-0 text-left',
          compact
            ? 'h-full'
            : 'min-h-[60px]',
          disabled
            ? 'cursor-default'
            : 'cursor-pointer',
        )}
        style={{
          padding: 0,
          border: 0,
          background: 'transparent',
        }}
        title={displayName}
      >
        <span
          className={clsx(
            'flex h-full w-full min-w-0 items-center pl-[10px]',
            action
              ? 'pr-[20px]'
              : 'pr-[8px]',
          )}
        >
          <span className="mr-[8px] flex h-[40px] w-[40px] shrink-0 items-center justify-center">
            <img
              src={icon}
              alt=""
              draggable={false}
              className="pointer-events-none block h-[30px] w-[30px] select-none object-contain"
            />
          </span>

          <span className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden">
            <span
              className={clsx(
                'block w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap select-text',
                'text-[13px] font-semibold leading-[18px]',
                'text-neutral-900 dark:text-[#ffffff]',
              )}
              title={displayName}
            >
              {visibleName}
            </span>

            <span className="mt-[2px] flex min-w-0 items-center overflow-hidden">
              {metadata ? (
                <span
                  className={clsx(
                    'block min-w-0 truncate text-[9px] leading-[13px]',
                    'text-neutral-500 dark:text-neutral-400',
                  )}
                  title={metadata}
                >
                  {metadata}
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </button>

      {action ? (
        <div className="absolute right-[5px] top-[5px] z-30">
          {action}
        </div>
      ) : null}

      {children ? (
        <div
          className={clsx(
            'relative z-10 border-t px-[12px] pb-[12px] pt-[10px]',
            'border-[#dedede] dark:border-[#ffffff]/[0.10]',
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function shortenFilename(
  filename: string,
  maxLength: number,
): string {
  if (filename.length <= maxLength) {
    return filename;
  }

  const dotIndex =
    filename.lastIndexOf('.');

  const hasExtension =
    dotIndex > 0
    && dotIndex < filename.length - 1;

  if (!hasExtension) {
    return `${filename.slice(
      0,
      Math.max(
        1,
        maxLength - 1,
      ),
    )}…`;
  }

  const extension =
    filename.slice(dotIndex);

  const baseName =
    filename.slice(
      0,
      dotIndex,
    );

  const availableLength =
    Math.max(
      3,
      maxLength
        - extension.length
        - 1,
    );

  return `${baseName.slice(
    0,
    availableLength,
  )}…${extension}`;
}