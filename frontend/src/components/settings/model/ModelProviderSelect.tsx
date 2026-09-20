import { resolveAssetUrl } from '../../../utils/asset-url';
import { useAppearance } from '../../../theme/useAppearance';
                                                                 
import { useLocalize } from '../../../localization/useLocalize';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  LlmCatalogProvider,
  LlmModelRole,
} from './model-settings.types';

interface ModelProviderSelectProps {
  label: string;
  providers: LlmCatalogProvider[];
  role: LlmModelRole;
  providerKey: string;
  modelKey: string;
  disabled?: boolean;
  disabledText?: string;
  excludedSelection?: { providerKey: string; modelKey: string } | null;

  onChange: (
    providerKey: string,
    modelKey: string,
  ) => void;
}

export default function ModelProviderSelect({
  label,
  providers,
  role,
  providerKey,
  modelKey,
  disabled = false,
  disabledText,
  excludedSelection,
    onChange,
}: ModelProviderSelectProps) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const availableProviders = useMemo(
    () =>
      providers
        .filter((provider) => provider.enabled)
        .map((provider) => ({
          ...provider,
          models: provider.models.filter(
            (model) => model.enabled
              && model.roles.includes(role)
              && !(
                excludedSelection
                && provider.providerKey === excludedSelection.providerKey
                && model.modelKey === excludedSelection.modelKey
              ),
          ),
        }))
        .filter((provider) => provider.models.length > 0)
        .sort((left, right) => left.sortOrder - right.sortOrder),
    [excludedSelection, providers, role],
  );

  const selectedProvider = useMemo(
    () =>
      availableProviders.find(
        (provider) => provider.providerKey === providerKey,
      ) ?? null,
    [availableProviders, providerKey],
  );

  const selectedModel = useMemo(
    () =>
      selectedProvider?.models.find(
        (model) => model.modelKey === modelKey,
      ) ?? null,
    [modelKey, selectedProvider],
  );

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  const hasModels = availableProviders.length > 0;
  const displayText = disabled && disabledText
    ? disabledText
    : selectedProvider && selectedModel
      ? `${selectedProvider.displayName} · ${selectedModel.displayName}`
      : hasModels
        ? localize('settings.model.selectModel')
        : localize('settings.model.noModels');

  const triggerClass = 'bg-surface-control text-theme-body  ';

  const dropdownClass = 'bg-surface-control text-theme-body  ';

  return (
    <div
      ref={rootRef}
      data-desktop-no-drag
      className="relative w-full"
    >
      <label className="block select-none text-[11px] font-medium">
        {label}
      </label>

      <button
        type="button"
        disabled={disabled || !hasModels}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          if (disabled || !hasModels) return;
          setIsOpen((current) => !current);
        }}
        className={[
          'relative mt-[5px]',
          'flex h-[44px] w-full',
          'items-center',
          'rounded-[10px]',
          'text-left outline-none',
          'select-none',
          'transition-all duration-200',
          'disabled:cursor-not-allowed',
          disabled ? 'disabled:opacity-70' : 'disabled:opacity-40',
          isOpen ? 'rounded-b-none' : '',
          triggerClass,
        ].join(' ')}
      >
        <span
          title={displayText}
          className="min-w-0 flex-1 truncate px-[12px] pr-[40px] text-[11px] font-medium"
          style={{ userSelect: 'none' }}
        >
          {displayText}
        </span>

        {!disabled && hasModels && (
          <img
            src={
              isDarkTheme
                ? resolveAssetUrl('/icons/white/arrow-down1.svg')
                : resolveAssetUrl('/icons/arrow-down.svg')
            }
            alt={localize('settings.model.expandList')}
            draggable={false}
            className={[
              'pointer-events-none absolute right-[12px] top-1/2',
              'h-[14px] w-[14px] -translate-y-1/2 select-none',
              'transition-transform duration-200',
              isOpen ? 'rotate-180' : '',
            ].join(' ')}
          />
        )}
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label={localize('settings.model.providerListLabel', { label })}
          className={[
            'absolute left-0 top-full z-[100] w-full overflow-hidden',
            'rounded-b-[10px] shadow-lg',
            dropdownClass,
          ].join(' ')}
          style={{ boxShadow: '0 10px 15px -3px rgba(0,0,0,0.14)' }}
        >
          <div className="scroll-container max-h-[260px] overflow-y-auto py-[8px]">
            {availableProviders.map((provider) => (
              <div
                key={provider.providerKey}
                className="mb-[12px] last:mb-0"
              >
                <div
                  className={[
                    'px-[10px] text-[12px] font-medium',
                    'text-[#9ca3af] dark:text-[#6b7280]',
                  ].join(' ')}
                >
                  {provider.displayName}
                </div>

                {provider.models.map((model) => {
                  const selected =
                    provider.providerKey === providerKey
                    && model.modelKey === modelKey;

                  return (
                    <button
                      key={`${provider.providerKey}:${model.modelKey}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onChange(provider.providerKey, model.modelKey);
                        setIsOpen(false);
                      }}
                      className={[
                        'mx-auto mb-[3px] flex h-[38px] w-[95%]',
                        'items-center justify-between gap-3 px-[10px]',
                        'select-none text-left text-[11px] leading-none transition-colors',
                        selected
                          ? 'bg-action-primary text-[#ffffff] hover:bg-action-primary-hover'
                          : 'bg-surface-button-alt hover:bg-surface-settings-hover  ',
                      ].join(' ')}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {model.displayName}
                      </span>

                      <span className="flex shrink-0 items-center gap-2">
                        {model.recommended && (
                          <span
                            className={[
                              'text-[10px]',
                              selected
                                ? 'text-[#ffffff]/70'
                                : 'text-[#9ca3af] dark:text-[#6b7280]',
                            ].join(' ')}
                          >
                            {localize('settings.model.recommended')}
                          </span>
                        )}
                        {selected && <span aria-hidden="true">✓</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
