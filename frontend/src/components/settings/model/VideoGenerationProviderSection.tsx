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

import {
  useLocalize,
} from '../../../localization/useLocalize';

import type {
  UserLlmCredentialSummary,
  VideoGenerationCatalogProvider,
} from './model-settings.types';

export interface VideoGenerationSelection {
  providerKey: string;
  modelKey: string;
}

export default function VideoGenerationProviderSection(
  props: {
    providers:
      VideoGenerationCatalogProvider[];

    selection:
      VideoGenerationSelection;

    savedSelection:
      VideoGenerationSelection;

    credentials:
      UserLlmCredentialSummary[];

    saving?: boolean;

    onSelectionChange: (
      selection:
        VideoGenerationSelection,
    ) => void;

    onSave: (input: {
      providerKey: string;
      modelKey: string;
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
          props.selection.providerKey,
      ) ?? null,
    [
      props.providers,
      props.selection.providerKey,
    ],
  );

  const model = useMemo(
    () =>
      provider?.models.find(
        (item) =>
          item.modelKey ===
          props.selection.modelKey,
      ) ?? null,
    [
      provider,
      props.selection.modelKey,
    ],
  );

  const credential = useMemo(
    () =>
      props.credentials.find(
        (item) =>
          item.providerKey ===
          props.selection.providerKey,
      ) ?? null,
    [
      props.credentials,
      props.selection.providerKey,
    ],
  );

  const disabled = Boolean(
    props.saving || busy,
  );

  const selectionChanged =
    props.selection.providerKey !==
      props.savedSelection.providerKey ||
    props.selection.modelKey !==
      props.savedSelection.modelKey;

  const hasChanges = Boolean(
    selectionChanged ||
    apiKey.trim(),
  );

  const configured = Boolean(
    !selectionChanged &&
    provider &&
    model &&
    credential?.configured,
  );

  const canSave = Boolean(
    !disabled &&
    provider &&
    model &&
    hasChanges &&
    (
      apiKey.trim() ||
      credential?.configured
    ),
  );

  const configuredState =
    configured && !hasChanges;

  const capabilityRows = model
    ? [
        {
          label: localize(
            'settings.model.capability.textToVideo',
          ),
          enabled:
            model.capabilities
              .textToVideo,
        },
        {
          label: localize(
            'settings.model.capability.imageToVideo',
          ),
          enabled:
            model.capabilities
              .imageToVideo,
        },
        {
          label: localize(
            'settings.model.capability.firstLastFrame',
          ),
          enabled:
            model.capabilities
              .firstLastFrame,
        },
        {
          label: localize(
            'settings.model.capability.referenceImages',
          ),
          enabled:
            model.capabilities
              .referenceImages,
        },
        {
          label: localize(
            'settings.model.capability.generatedAudio',
          ),
          enabled:
            model.capabilities
              .generatedAudio,
        },
      ]
    : [];

  return (
    <section
      className={[
        'rounded-[13px] p-[14px]',
        'bg-surface-button-soft ',
      ].join(' ')}
    >
      <div className="select-none text-[13px] font-medium">
        {localize(
          'settings.model.video.title',
        )}
      </div>

      <div
        className={[
          'mt-[5px] text-[11px] leading-[18px]',
          'text-theme-faint ',
        ].join(' ')}
      >
        {localize(
          'settings.model.video.description',
        )}
      </div>

      <div className="mt-[14px] space-y-[14px]">
        <SelectField
          label={localize(
            'settings.model.video.service',
          )}
          items={props.providers.map(
            (item) => ({
              key: item.providerKey,
              label: item.displayName,
            }),
          )}
          value={
            props.selection.providerKey
          }
          placeholder={localize(
            'settings.model.selectService',
          )}
          disabled={disabled}
          onChange={(providerKey) => {
            const nextProvider =
              props.providers.find(
                (item) =>
                  item.providerKey ===
                  providerKey,
              );
            const nextModel =
              nextProvider?.models.find(
                (item) =>
                  item.recommended,
              ) ??
              nextProvider?.models[0];

            setApiKey('');

            props.onSelectionChange({
              providerKey,
              modelKey:
                nextModel?.modelKey ?? '',
            });
          }}
        />

        <SelectField
          label={localize(
            'settings.model.video.model',
          )}
          items={
            provider?.models.map(
              (item) => ({
                key: item.modelKey,
                label: item.displayName,
                recommended:
                  item.recommended,
              }),
            ) ?? []
          }
          value={
            props.selection.modelKey
          }
          placeholder={localize(
            'settings.model.selectModel',
          )}
          disabled={
            disabled || !provider
          }
          onChange={(modelKey) => {
            props.onSelectionChange({
              providerKey:
                props.selection
                  .providerKey,
              modelKey,
            });
          }}
        />

        {model && (
          <div
            className={[
              'rounded-[10px] px-3 py-2 text-[11px] leading-5',
              'bg-[#ffffff]/70 text-theme-quiet dark:bg-[#ffffff]/[0.035] ',
            ].join(' ')}
          >
            {capabilityRows.map(
              (item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-4"
                >
                  <span>
                    {item.label}
                  </span>

                  <span className="shrink-0 opacity-75">
                    {localize(
                      item.enabled
                        ? 'settings.model.capability.available'
                        : 'settings.model.capability.unsupported',
                    )}
                  </span>
                </div>
              ),
            )}
          </div>
        )}

        <ModelApiKeyField
          label={localize(
            'settings.model.video.apiKey',
          )}
          value={apiKey}
          configuredHint={
            credential?.configured
              ? credential.keyHint
              : null
          }
          apiKeyUrl={
            provider?.apiKeyUrl ?? ''
          }
          disabled={
            disabled || !provider
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
              'settings.model.video.apiKeyHint',
            )}
          </div>
        )}

        <div className="flex gap-[6px]">
          <button
            type="button"
            disabled={!canSave}
            onClick={() => {
              if (!provider || !model) {
                return;
              }

              setBusy(true);

              void props
                .onSave({
                  providerKey:
                    provider.providerKey,
                  modelKey:
                    model.modelKey,
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
                  () => undefined,
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
              !props.savedSelection
                .providerKey
            }
            onClick={() => {
              setBusy(true);

              void props
                .onClear()
                .catch(
                  () => undefined,
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

function SelectField(props: {
  label: string;
  items: Array<{
    key: string;
    label: string;
    recommended?: boolean;
  }>;
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const localize = useLocalize();
  const [open, setOpen] =
    useState(false);
  const rootRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const selected =
    props.items.find(
      (item) => item.key === props.value,
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

  useEffect(() => {
    if (props.disabled) {
      setOpen(false);
    }
  }, [props.disabled]);

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
          props.disabled ||
          props.items.length === 0
        }
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
          'bg-surface-control text-theme-body  ',
        ].join(' ')}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected?.label ??
            props.placeholder}
        </span>

        <ChevronDown
          size={14}
          strokeWidth={1.8}
          className={[
            'ml-[10px] shrink-0 opacity-50',
            'transition-transform duration-200',
            open ? 'rotate-180' : '',
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
              'bg-surface-control text-theme-body  ',
              '[&::-webkit-scrollbar]:hidden',
              '[scrollbar-width:none]',
            ].join(' ')}
          >
            <div className="space-y-[4px]">
              {props.items.map(
                (item) => {
                  const isSelected =
                    item.key === props.value;

                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        props.onChange(
                          item.key,
                        );
                        setOpen(false);
                      }}
                      className={[
                        'flex h-[34px] w-full',
                        'items-center justify-between gap-3',
                        'rounded-[8px]',
                        'px-[10px]',
                        'select-none text-left text-[11px] leading-none',
                        'transition-colors',
                        isSelected
                          ? 'bg-action-primary text-[#ffffff] hover:bg-action-primary-hover'
                          : 'bg-surface-button-alt hover:bg-surface-settings-hover  ',
                      ].join(' ')}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>

                      <span className="flex shrink-0 items-center gap-2">
                        {item.recommended && (
                          <span
                            className={[
                              'text-[10px]',
                              isSelected
                                ? 'text-[#ffffff]/70'
                                : 'text-[#9ca3af] dark:text-[#6b7280]',
                            ].join(' ')}
                          >
                            {localize(
                              'settings.model.recommended',
                            )}
                          </span>
                        )}

                        {isSelected && (
                          <span aria-hidden="true">
                            ✓
                          </span>
                        )}
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
