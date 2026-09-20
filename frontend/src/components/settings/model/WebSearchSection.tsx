                                                              
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
} from 'lucide-react';
import ModelApiKeyField from './ModelApiKeyField';
import { useLocalize } from '../../../localization/useLocalize';
import type {
  UserWebSearchSettings,
  WebSearchCatalogProvider,
} from './model-settings.types';

export default function WebSearchSection(props: {
  providers:
    WebSearchCatalogProvider[];
  settings:
    UserWebSearchSettings;
  disabled?: boolean;

  onSave: (input: {
    providerKey: string;
    apiKey?: string;
  }) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const localize = useLocalize();

  const initialProvider =
    props.settings.providerKey ??
    props.providers.find(
      (item) => item.enabled,
    )?.providerKey ??
    '';

  const [
    providerKey,
    setProviderKey,
  ] = useState(initialProvider);

  const [apiKey, setApiKey] =
    useState('');

  const [busy, setBusy] =
    useState(false);

  const provider = useMemo(
    () =>
      props.providers.find(
        (item) =>
          item.providerKey ===
          providerKey,
      ) ?? null,
    [
      providerKey,
      props.providers,
    ],
  );

  const configured = Boolean(
    props.settings.credential
      .configured &&
    props.settings.providerKey ===
      providerKey,
  );

  const disabled = Boolean(
    props.disabled || busy,
  );

  const savedProviderKey =
    props.settings.providerKey ??
    '';

  const providerChanged =
    providerKey !==
    savedProviderKey;

  const hasChanges = Boolean(
    providerChanged ||
    apiKey.trim(),
  );

  const configuredState =
    configured && !hasChanges;

  const canSave = Boolean(
    !disabled &&
    providerKey &&
    hasChanges &&
    (
      apiKey.trim() ||
      configured
    ),
  );

  const panelClass =
    'bg-surface-button-soft ';

  return (
    <section
      className={`rounded-[13px] p-[14px] ${panelClass}`}
    >
      <div className="select-none text-[13px] font-medium">
        {localize(
          'settings.model.web.title',
        )}
      </div>

      <div
        className={[
          'mt-[5px] text-[11px] leading-[18px]',
          'text-[#9ca3af] dark:text-[#6b7280]',
        ].join(' ')}
      >
        {localize(
          'settings.model.web.description',
        )}
      </div>

      <div className="mt-[14px] space-y-[14px]">
        <ProviderSelect
          label={localize(
            'settings.model.web.service',
          )}
          providers={props.providers.filter(
            (item) => item.enabled,
          )}
          providerKey={providerKey}
          disabled={
            disabled ||
            props.providers.length === 0
          }

          placeholder={localize(
            'settings.model.selectService',
          )}
          onChange={(nextProviderKey) => {
            setProviderKey(
              nextProviderKey,
            );

            setApiKey('');
          }}
        />

        <ModelApiKeyField
          label={localize(
            'settings.model.web.apiKey',
          )}
          value={apiKey}
          configuredHint={
            configured
              ? props.settings
                  .credential.keyHint
              : null
          }
          apiKeyUrl={
            provider?.apiKeyUrl ??
            ''
          }
          disabled={disabled}

          onChange={setApiKey}
        />

        <div className="flex gap-[6px]">
          <button
            type="button"
            disabled={!canSave}
            onClick={() => {
              setBusy(true);

              void props
                .onSave({
                  providerKey,
                  ...(apiKey.trim()
                    ? {
                        apiKey:
                          apiKey.trim(),
                      }
                    : {}),
                })
                .then(() =>
                  setApiKey(''),
                )
                .catch(
                  () =>
                    undefined,
                )
                .finally(() =>
                  setBusy(false),
                );
            }}
            className={[
              'inline-flex h-[36px] flex-1 items-center justify-center select-none rounded-[10px] p-0 text-[11px] font-medium leading-none',
              'transition-opacity disabled:cursor-not-allowed',
              configuredState
                ? 'disabled:opacity-100'
                : 'disabled:opacity-40',
              configuredState
                ? 'bg-surface-button text-[#6b7280]  dark:text-[#9ca3af]'
                : 'bg-action-primary text-[#ffffff] hover:bg-action-primary-hover',
            ].join(' ')}
          >
            {busy
              ? localize(
                  'settings.model.validatingAndSaving',
                )
              : configuredState
                ? localize(
                    'settings.model.configured',
                  )
                : localize(
                    'settings.model.saveSettings',
                  )}
          </button>

          <button
            type="button"
            disabled={
              disabled ||
              !props.settings
                .credential.configured
            }
            onClick={() => {
              setBusy(true);

              void props
                .onClear()
                .catch(
                  () =>
                    undefined,
                )
                .finally(() =>
                  setBusy(false),
                );
            }}
            className={[
              'inline-flex h-[36px] items-center justify-center select-none rounded-[10px] px-[14px] py-0 text-[11px] font-medium leading-none',
              'transition-opacity disabled:cursor-not-allowed disabled:opacity-40',
              'bg-surface-button text-[#374151] hover:bg-[#D8D8D8]  dark:text-[#d1d5db] dark:hover:bg-[#333333]',
            ].join(' ')}
          >
            {localize(
              'common.actions.clear',
            )}
          </button>
        </div>
      </div>
    </section>
  );
}

function ProviderSelect(props: {
  label: string;
  providers: Array<{
    providerKey: string;
    displayName: string;
  }>;
  providerKey: string;
  disabled?: boolean;

  placeholder: string;
  onChange: (
    providerKey: string,
  ) => void;
}) {
  const [open, setOpen] =
    useState(false);

  const rootRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const selectedProvider =
    props.providers.find(
      (item) =>
        item.providerKey ===
        props.providerKey,
    ) ?? null;

  useEffect(() => {
    const handlePointerDown = (
      event: MouseEvent,
    ) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(
          event.target as Node,
        )
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener(
      'mousedown',
      handlePointerDown,
    );

    document.addEventListener(
      'keydown',
      handleKeyDown,
    );

    return () => {
      document.removeEventListener(
        'mousedown',
        handlePointerDown,
      );

      document.removeEventListener(
        'keydown',
        handleKeyDown,
      );
    };
  }, []);

  const triggerClass =
    'bg-surface-control text-theme-body  ';

  const dropdownClass =
    'bg-surface-control text-theme-body  ';

  return (
    <div
      ref={rootRef}
      className="relative"
    >
      <label className="block select-none text-[11px] font-medium">
        {props.label}
      </label>

      <button
        type="button"
        disabled={props.disabled}
        aria-expanded={open}
        onClick={() =>
          setOpen(
            (current) => !current,
          )
        }
        className={[
          'relative mt-[5px]',
          'flex h-[44px] w-full',
          'items-center',
          'rounded-[10px]',
          'px-[12px]',
          'select-none text-left text-[11px] font-medium',
          'outline-none',
          'transition-all duration-200',
          'disabled:cursor-not-allowed disabled:opacity-40',
          triggerClass,
        ].join(' ')}
      >
        <span className="min-w-0 flex-1 truncate">
          {selectedProvider
            ?.displayName ??
            props.placeholder}
        </span>

        <ChevronDown
          size={14}
          strokeWidth={1.8}
          className={[
            'ml-[10px] shrink-0 opacity-50',
            'transition-transform duration-200',
            open
              ? 'rotate-180'
              : '',
          ].join(' ')}
        />
      </button>

      {open &&
        !props.disabled && (
          <div
            className={[
              'absolute left-0 right-0 top-full z-50',
              'mt-[6px]',
              'max-h-[220px]',
              'overflow-y-auto',
              'rounded-[10px]',
              'p-[6px]',
              'shadow-[0_12px_32px_rgba(0,0,0,0.18)]',
              dropdownClass,
              '[&::-webkit-scrollbar]:hidden',
              '[scrollbar-width:none]',
            ].join(' ')}
          >
            <div className="space-y-[4px]">
              {props.providers.map(
                (item) => {
                  const selected =
                    item.providerKey ===
                    props.providerKey;

                  return (
                    <button
                      key={
                        item.providerKey
                      }
                      type="button"
                      onClick={() => {
                        props.onChange(
                          item.providerKey,
                        );

                        setOpen(false);
                      }}
                      className={[
                        'flex h-[34px] w-full',
                        'items-center justify-between',
                        'rounded-[8px]',
                        'px-[10px]',
                        'select-none text-left text-[11px] leading-none',
                        'transition-colors',
                        selected
                          ? 'bg-action-primary text-[#ffffff] hover:bg-action-primary-hover'
                          : 'bg-surface-button-alt hover:bg-surface-settings-hover  ',
                      ].join(' ')}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {
                          item.displayName
                        }
                      </span>
                    </button>
                  );
                },
              )}
            </div>
          </div>
        )}
    </div>
  );
}