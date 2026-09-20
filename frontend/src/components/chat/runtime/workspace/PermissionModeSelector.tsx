                                                                            

import {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  createPortal,
} from 'react-dom';
import clsx from 'clsx';
import {
  Check,
} from 'lucide-react';

import {
  useLocalize,
} from '../../../../localization/useLocalize';

import type {
  RuntimePermissionMode,
} from './runtime-workspace.types';

type Props = {

  value: RuntimePermissionMode;
  onChange?: (
    mode: RuntimePermissionMode,
  ) => void;
};

const options: Array<{
  mode: RuntimePermissionMode;
  titleKey: string;
  descriptionKey: string;
}> = [
  {
    mode: 'confirm_required',
    titleKey:
      'workspace.permission.confirm.title',
    descriptionKey:
      'workspace.permission.confirm.description',
  },
  {
    mode: 'audit_autorun',
    titleKey:
      'workspace.permission.audit.title',
    descriptionKey:
      'workspace.permission.audit.description',
  },
  {
    mode: 'full_access',
    titleKey:
      'workspace.permission.full.title',
    descriptionKey:
      'workspace.permission.full.description',
  },
];

type FloatingRect = {
  left: number;
  bottom: number;
};

type PermissionModeItemProps = {

  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
};

const itemClass =
  'bg-transparent hover:bg-surface-list-hover active:bg-[#e5e5e5] dark:bg-[#2a2a2a]  dark:active:bg-[#1f1f1f]';

function PermissionModeItem({
    title,
  description,
  selected,
  onClick,
}: PermissionModeItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-[8px] rounded-[7px] px-[8px] py-[7px] text-left transition',
        itemClass,
      )}
    >
      <div className="min-w-0 flex-1">
        <div
          className={clsx(
            'text-[10px] font-semibold leading-[14px]',
            'text-theme-primary-soft ',
          )}
        >
          {title}
        </div>

        <div
          className={clsx(
            'mt-[2px] text-[8px] font-normal leading-[11px]',
            'text-[#8b8b8b] dark:text-[#9a9a9a]',
          )}
        >
          {description}
        </div>
      </div>

      <div className="flex h-[13px] w-[13px] shrink-0 items-center justify-center">
        {selected ? (
          <Check
            className={clsx(
              'h-[13px] w-[13px]',
              'text-theme-caption ',
            )}
            strokeWidth={2.4}
          />
        ) : null}
      </div>
    </button>
  );
}

export default function PermissionModeSelector({
    value,
  onChange,
}: Props) {
  const localize =
    useLocalize();

  const [open, setOpen] =
    useState(false);

  const [
    floatingRect,
    setFloatingRect,
  ] = useState<FloatingRect | null>(
    null,
  );

  const ref =
    useRef<HTMLButtonElement | null>(
      null,
    );

  const menuRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const currentOption =
    options.find(
      (item) =>
        item.mode === value,
    )
    ?? options[0];

  const currentLabel =
    localize(
      currentOption.titleKey,
    );

  const updateFloatingRect = () => {
    const rect =
      ref.current
        ?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setFloatingRect({
      left: rect.left,
      bottom:
        window.innerHeight
        - rect.top
        + 6,
    });
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    updateFloatingRect();

    const handler = (
      event: MouseEvent,
    ) => {
      const target =
        event.target as Node | null;

      if (
        target
        && ref.current
          ?.contains(target)
      ) {
        return;
      }

      if (
        target
        && menuRef.current
          ?.contains(target)
      ) {
        return;
      }

      setOpen(false);
    };

    const update = () => {
      updateFloatingRect();
    };

    document.addEventListener(
      'mousedown',
      handler,
    );

    window.addEventListener(
      'resize',
      update,
    );

    window.addEventListener(
      'scroll',
      update,
      true,
    );

    return () => {
      document.removeEventListener(
        'mousedown',
        handler,
      );

      window.removeEventListener(
        'resize',
        update,
      );

      window.removeEventListener(
        'scroll',
        update,
        true,
      );
    };
  }, [open]);

  const menu =
    open
    && floatingRect
    && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              left:
                floatingRect.left,
              bottom:
                floatingRect.bottom,
            }}
            className={clsx(
              'fixed z-[9999] w-[168px] select-none overflow-hidden rounded-[13px] border p-[7px] shadow-[7px_7px_21px_rgba(0,0,0,0.1)] [&_button]:!select-none [&_button_*]:!select-none',
              'border-edge-control bg-surface-menu text-theme-primary-soft   ',
            )}
          >
            <div
              className={clsx(
                'mb-[4px] flex h-[24px] items-center border-b px-[8px]',
                'border-[#e3e3e3] dark:border-[#3a3a3a]',
              )}
            >
              <div
                className={clsx(
                  'text-[8.5px] font-semibold leading-none',
                  'text-[#8a8a8a] dark:text-[#b8b8b8]',
                )}
              >
                {localize(
                  'workspace.permission.approveSeekmore',
                )}
              </div>
            </div>

            <div className="space-y-[2px]">
              {options.map(
                (item) => (
                  <PermissionModeItem
                    key={item.mode}

                    title={localize(
                      item.titleKey,
                    )}
                    description={localize(
                      item.descriptionKey,
                    )}
                    selected={
                      value
                      === item.mode
                    }
                    onClick={() => {
                      onChange?.(
                        item.mode,
                      );

                      setOpen(false);
                    }}
                  />
                ),
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => {
          setOpen(
            (next) => !next,
          );
        }}
        className={clsx(
          'inline-flex h-[21px] min-w-[44px] select-none items-center justify-center whitespace-nowrap rounded-full px-[8px] text-[9px] transition',
          'bg-surface-hover text-neutral-800 hover:bg-[#dddddd]  dark:text-[#f2f2f2] dark:hover:bg-[#1f1f1f]',
        )}
      >
        {currentLabel}
      </button>

      {menu}
    </>
  );
}