                                                                            

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
  AudioCapabilityAccess,
  AudioGenerationCatalogProvider,
  UserLlmCredentialSummary,
} from './model-settings.types';

export default function AudioGenerationProviderSection(
  props: {
    providers:
      AudioGenerationCatalogProvider[];

    providerKey: string;

    savedProviderKey: string;

    credentials:
      UserLlmCredentialSummary[];

    saving?: boolean;



    hint?: string;

    onProviderChange: (
      providerKey: string,
    ) => void;

    onSave: (input: {
      providerKey: string;
      apiKey?: string;
    }) => Promise<void>;

    onClear: () => Promise<void>;
  },
) {
  const localize = useLocalize();

  const [apiKey, setApiKey] =
    useState('');

  const [busy, setBusy] =
    useState(false);

  const provider = useMemo(
    () =>
      props.providers.find(
        (item) =>
          item.providerKey ===
          props.providerKey,
      ) ?? null,
    [
      props.providerKey,
      props.providers,
    ],
  );

  const credential = useMemo(
    () =>
      props.credentials.find(
        (item) =>
          item.providerKey ===
          props.providerKey,
      ) ?? null,
    [
      props.credentials,
      props.providerKey,
    ],
  );

  const disabled = Boolean(
    props.saving || busy,
  );

  const providerChanged =
    props.providerKey !==
    props.savedProviderKey;

  const hasChanges = Boolean(
    providerChanged ||
    apiKey.trim(),
  );

  const configured = Boolean(
    !providerChanged &&
    props.providerKey &&
    credential?.configured,
  );

  const canSave = Boolean(
    !disabled &&
    provider &&
    hasChanges &&
    (
      apiKey.trim() ||
      credential?.configured
    ),
  );

  const configuredState =
    configured && !hasChanges;

  const panelClass =
    'bg-surface-button-soft ';

  const capabilityRows = provider
    ? [
        {
          id: 'speech',

          label: localize(
            'settings.model.capability.speechGeneration',
          ),

          enabled:
            provider.capabilities
              .speechGeneration,

          access:
            provider.capabilities
              .access
              ?.speechGeneration,
        },

        {
          id: 'voiceCloning',

          label: localize(
            'settings.model.capability.voiceCloning',
          ),

          enabled:
            provider.capabilities
              .voiceCloning,

          access:
            provider.capabilities
              .access
              ?.voiceCloning,
        },

        {
          id: 'music',

          label: localize(
            'settings.model.capability.musicGeneration',
          ),

          enabled:
            provider.capabilities
              .musicGeneration,

          access:
            provider.capabilities
              .access
              ?.musicGeneration,
        },
      ]
    : [];

  return (
    <section
      className={[
        'rounded-[13px] p-[14px]',
        panelClass,
      ].join(' ')}
    >
      <div className="select-none text-[13px] font-medium">
        {localize(
          'settings.model.audio.title',
        )}
      </div>

      <div
        className={[
          'mt-[5px] text-[11px] leading-[18px]',
          'text-theme-faint ',
        ].join(' ')}
      >
        {localize(
          'settings.model.audio.description',
        )}
      </div>

      {props.hint && (
        <div
          className={[
            'mt-[10px] rounded-[9px] px-3 py-2 text-[11px] leading-[18px]',
            'bg-[#000000]/[0.04] text-theme-balanced-50 dark:bg-[#ffffff]/[0.04] ',
          ].join(' ')}
        >
          {props.hint}
        </div>
      )}

      <div className="mt-[14px] space-y-[14px]">
        <ProviderSelect
          label={localize(
            'settings.model.audio.service',
          )}
          providers={
            props.providers
          }
          providerKey={
            props.providerKey
          }
          disabled={disabled}

          placeholder={localize(
            'settings.model.selectService',
          )}
          onChange={(
            nextProviderKey,
          ) => {
            setApiKey('');

            props.onProviderChange(
              nextProviderKey,
            );
          }}
        />

        {provider && (
          <div
            className={[
              'rounded-[10px] px-3 py-2 text-[11px] leading-5',
              'bg-[#ffffff]/70 text-theme-quiet dark:bg-[#ffffff]/[0.035] ',
            ].join(' ')}
          >
            {capabilityRows.map(
              (item) => (
                <div
                  key={
                    item.label
                  }
                  className="flex items-center justify-between gap-4"
                >
                  <span>
                    {item.label}
                  </span>

                  <span className="shrink-0 opacity-75">
                    {capabilityText(
                      item.enabled,
                      item.access,
                      provider.providerKey,
                      item.id,
                      localize,
                    )}
                  </span>
                </div>
              ),
            )}
          </div>
        )}

        <ModelApiKeyField
          label={localize(
            'settings.model.audio.apiKey',
          )}
          value={apiKey}
          configuredHint={
            credential?.configured
              ? credential.keyHint
              : null
          }
          apiKeyUrl={
            provider?.apiKeyUrl ??
            ''
          }
          disabled={
            disabled ||
            !provider
          }

          onChange={setApiKey}
        />

        {provider && (
          <div
            className={[
              'text-[10px] leading-5',
              'text-theme-faint ',
            ].join(' ')}
          >
            {localize(
              'settings.model.audio.apiKeyHint',
            )}
          </div>
        )}

        <div className="flex gap-[6px]">
          <button
            type="button"
            disabled={!canSave}
            onClick={() => {
              if (!provider) {
                return;
              }

              setBusy(true);

              void props
                .onSave({
                  providerKey:
                    provider.providerKey,

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
                ? 'bg-[#000000]/[0.08] text-theme-balanced-45 dark:bg-[#ffffff]/[0.08] '
                : 'bg-action-primary text-[#ffffff] hover:bg-action-primary-hover',
            ].join(' ')}
          >
            {busy
              ? localize(
                  'common.saving',
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
              !props.providerKey
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

              'bg-[#000000]/[0.08] text-[#000000]/70 hover:bg-[#000000]/[0.12] dark:bg-[#ffffff]/[0.08] dark:text-[#ffffff]/70 dark:hover:bg-[#ffffff]/[0.12]',
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
      if (
        event.key === 'Escape'
      ) {
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
        disabled={
          props.disabled
        }
        aria-expanded={open}
        onClick={() =>
          setOpen(
            (current) =>
              !current,
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

function capabilityText(
  enabled: boolean,

  access:
    | AudioCapabilityAccess
    | undefined,

  providerKey: string,

  capabilityId: string,

  localize: ReturnType<
    typeof useLocalize
  >,
): string {
  if (!enabled) {
    return localize(
      'settings.model.capability.unsupported',
    );
  }

  if (
    access === 'paid_only'
  ) {
    return localize(
      'settings.model.capability.paidOnly',
    );
  }

  if (
    access ===
    'plan_dependent'
  ) {
    return localize(
      'settings.model.capability.planDependent',
    );
  }

  if (
    providerKey ===
      'elevenlabs' &&
    capabilityId ===
      'speech'
  ) {
    return localize(
      'settings.model.capability.freeCredits',
    );
  }

  return localize(
    'settings.model.capability.available',
  );
}