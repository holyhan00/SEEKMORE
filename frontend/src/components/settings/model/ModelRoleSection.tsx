                                                              
import { useLocalize } from '../../../localization/useLocalize';
import { useMemo, useState } from 'react';
import ModelApiKeyField from './ModelApiKeyField';
import ModelProviderSelect from './ModelProviderSelect';
import type {
  LlmCatalogProvider,
  LlmModelRole,
  UserLlmCredentialSummary,
} from './model-settings.types';

export interface ModelRoleSelection {
  providerKey: string;
  modelKey: string;
}

export default function ModelRoleSection(props: {
  title: string;
  description: string;
  role: LlmModelRole;
  providers: LlmCatalogProvider[];
  selection: ModelRoleSelection;
  savedSelection: ModelRoleSelection;
  credentials: UserLlmCredentialSummary[];
  disabled?: boolean;
  disabledText?: string;
  hint?: string;
  excludedSelection?: ModelRoleSelection | null;
  optional?: boolean;
  saving?: boolean;

  onSelectionChange: (
    selection: ModelRoleSelection,
  ) => void;
  onSave: (
    input: ModelRoleSelection & {
      apiKey?: string;
    },
  ) => Promise<void>;
  onClear?: () => Promise<void>;
}) {
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
    props.disabled ||
    props.saving ||
    busy,
  );

  const selectionChanged =
    Boolean(
      props.selection.providerKey !==
        props.savedSelection.providerKey ||
      props.selection.modelKey !==
        props.savedSelection.modelKey,
    );

  const hasChanges = Boolean(
    selectionChanged ||
    apiKey.trim(),
  );

  const configured = Boolean(
    !selectionChanged &&
    props.selection.providerKey &&
    props.selection.modelKey &&
    credential?.configured,
  );

  const canSave = Boolean(
    !disabled &&
    props.selection.providerKey &&
    props.selection.modelKey &&
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

  return (
    <section
      className={[
        'rounded-[13px] p-[14px]',
        panelClass,
      ].join(' ')}
    >
      <div className="select-none text-[13px] font-medium">
        {props.title}
      </div>

      <div
        className={[
          'mt-[5px] text-[11px] leading-[18px]',
          'text-[#9ca3af] dark:text-[#6b7280]',
        ].join(' ')}
      >
        {props.description}
      </div>

      {props.hint && (
        <div
          className={[
            'mt-[10px] rounded-[9px] px-3 py-2 text-[11px] leading-[18px]',
            'bg-[#eff6ff] text-[#1d4ed8] dark:bg-[#3b82f6]/10 dark:text-[#93c5fd]',
          ].join(' ')}
        >
          {props.hint}
        </div>
      )}

      <div className="mt-[14px] space-y-[14px]">
        <ModelProviderSelect
          label={localize(
            'settings.model.roleModel',
            {
              title: props.title,
            },
          )}
          providers={
            props.providers
          }
          role={props.role}
          providerKey={
            props.selection.providerKey
          }
          modelKey={
            props.selection.modelKey
          }
          disabled={disabled}
          disabledText={
            props.disabledText
          }
          excludedSelection={
            props.excludedSelection
          }

          onChange={(
            providerKey,
            modelKey,
          ) => {
            setApiKey('');

            props.onSelectionChange({
              providerKey,
              modelKey,
            });
          }}
        />

        {!props.disabled && (
          <ModelApiKeyField
            label={`${props.title} API Key`}
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
            disabled={disabled}

            onChange={setApiKey}
          />
        )}

        {!props.disabled && (
          <div className="flex gap-[6px]">
            <button
              type="button"
              disabled={!canSave}
              onClick={() => {
                setBusy(true);

                void props
                  .onSave({
                    ...props.selection,
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
                  ? 'bg-surface-button text-[#6b7280]  dark:text-[#9ca3af]'
                  : 'bg-action-primary text-[#ffffff] hover:bg-action-primary-hover',
              ].join(' ')}
            >
              {busy
                ? localize(
                    'settings.model.saving',
                  )
                : configuredState
                  ? localize(
                      'settings.model.configured',
                    )
                  : localize(
                      'settings.model.save',
                    )}
            </button>

            {props.optional &&
              props.onClear && (
                <button
                  type="button"
                  disabled={
                    disabled ||
                    !props.selection
                      .providerKey
                  }
                  onClick={() => {
                    setBusy(true);

                    void props
                      .onClear?.()
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
                    'settings.model.clear',
                  )}
                </button>
              )}
          </div>
        )}
      </div>
    </section>
  );
}