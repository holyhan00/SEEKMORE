import { resolveAssetUrl } from '../../../utils/asset-url';
                                                                    
import {
  useEffect,
  useRef,
  useState,
} from 'react';

import { updateUserLocalizationPreferences } from '../../../localization/localization.api';
import type { UiLanguagePreference } from '../../../localization/locale.types';
import { useLocalization } from '../../../localization/LocalizationProvider';
import { useLocalize } from '../../../localization/useLocalize';
import type { AppearancePreference } from '../../../theme/appearance.types';
import { useAppearance } from '../../../theme/useAppearance';

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

function SettingsSelect<T extends string>(props: {
  label: string;
  value: T;
  options: Array<SelectOption<T>>;
  disabled?: boolean;

  onChange: (value: T) => void;
}) {
  const { resolvedTheme } = useAppearance();

  const [isOpen, setIsOpen] =
    useState(false);

  const rootRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleClickOutside = (
      event: MouseEvent,
    ) => {
      const target =
        event.target as Node;

      if (
        rootRef.current &&
        !rootRef.current.contains(
          target,
        )
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener(
      'mousedown',
      handleClickOutside,
    );

    document.addEventListener(
      'keydown',
      handleKeyDown,
    );

    return () => {
      document.removeEventListener(
        'mousedown',
        handleClickOutside,
      );

      document.removeEventListener(
        'keydown',
        handleKeyDown,
      );
    };
  }, [isOpen]);

  useEffect(() => {
    if (props.disabled) {
      setIsOpen(false);
    }
  }, [props.disabled]);

  const triggerClass =
    'bg-surface-control text-theme-body  ';

  const dropdownClass =
    'bg-surface-control text-theme-body  ';

  const selectedLabel =
    props.options.find(
      (item) =>
        item.value ===
        props.value,
    )?.label ?? '';

  return (
    <div
      ref={rootRef}
      data-desktop-no-drag
      className="relative w-full"
    >
      <div className="block select-none text-[12px] font-medium">
        {props.label}
      </div>

      <button
        type="button"
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          if (props.disabled) {
            return;
          }

          setIsOpen(
            (current) =>
              !current,
          );
        }}
        className={[
          'relative mt-[6px]',
          'flex h-[40px] w-full',
          'items-center',
          'rounded-[16px]',
          'text-left outline-none',
          'select-none',
          'transition-all duration-200',
          'disabled:cursor-not-allowed disabled:opacity-70',
          isOpen
            ? 'rounded-b-none'
            : '',
          triggerClass,
        ].join(' ')}
      >
        <span
          title={selectedLabel}
          className="min-w-0 flex-1 truncate px-[12px] pr-[44px] text-[12px] font-medium"
          style={{
            userSelect: 'none',
          }}
        >
          {selectedLabel}
        </span>

        {!props.disabled && (
          <img
            src={
              resolvedTheme === 'dark'
                ? resolveAssetUrl('/icons/white/arrow-down1.svg')
                : resolveAssetUrl('/icons/arrow-down.svg')
            }
            alt=""
            aria-hidden="true"
            draggable={false}
            className={[
              'pointer-events-none absolute right-[14px] top-1/2',
              'h-[14px] w-[14px] -translate-y-1/2 select-none',
              'transition-transform duration-200',
              isOpen
                ? 'rotate-180'
                : '',
            ].join(' ')}
          />
        )}
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label={props.label}
          className={[
            'absolute left-0 top-full z-[100] w-full overflow-hidden',
            'rounded-b-[12px] shadow-lg',
            dropdownClass,
          ].join(' ')}
          style={{
            boxShadow:
              '0 10px 15px -3px rgba(0,0,0,0.14)',
          }}
        >
          <div className="scroll-container max-h-[300px] overflow-y-auto py-[10px]">
            {props.options.map(
              (option) => {
                const selected =
                  option.value ===
                  props.value;

                return (
                  <button
                    key={
                      option.value
                    }
                    type="button"
                    role="option"
                    aria-selected={
                      selected
                    }
                    onClick={() => {
                      setIsOpen(false);
                      props.onChange(
                        option.value,
                      );
                    }}
                    className={[
                      'mx-auto mb-[3px] flex h-[40px] rounded-[16px] w-[95%]',
                      'items-center justify-between gap-[10px] px-[12px]',
                      'select-none text-left text-[12px] leading-none transition-colors',
                      selected
                        ? 'bg-action-primary text-[#ffffff] hover:bg-action-primary-hover'
                        : 'bg-surface-button-alt hover:bg-surface-settings-hover  ',
                    ].join(' ')}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>

                    {selected && (
                      <span
                        aria-hidden="true"
                        className="shrink-0"
                      >
                        ✓
                      </span>
                    )}
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

export default function GeneralSettingsPanel() {
  const t = useLocalize();
  const {
    preference: appearancePreference,
    setPreference: setAppearancePreference,
  } = useAppearance();
  const {
    preference,
    setPreference,
  } = useLocalization();

  const [saving, setSaving] =
    useState(false);

  const [
    selectedLanguage,
    setSelectedLanguage,
  ] = useState(preference);

  useEffect(
    () =>
      setSelectedLanguage(
        preference,
      ),
    [preference],
  );

  const handleLanguageChange =
    async (
      value:
        UiLanguagePreference,
    ) => {
      const previous =
        preference;

      setSelectedLanguage(value);
      setSaving(true);

      try {
        await updateUserLocalizationPreferences(
          {
            preferredLanguage:
              value === 'system'
                ? null
                : value,
          },
        );

        await setPreference(
          value,
        );
      } catch (error) {
        console.error(
          '[Localization] failed to update language preference',
          error,
        );

        setSelectedLanguage(
          previous,
        );
      } finally {
        setSaving(false);
      }
    };

  const contentClass =
    'bg-surface-settings text-theme-primary  ';

  const appearanceOptions: Array<
    SelectOption<AppearancePreference>
  > = [
    {
      value: 'light',
      label: t(
        'settings.appearance.light',
      ),
    },
    {
      value: 'dark',
      label: t(
        'settings.appearance.dark',
      ),
    },
    {
      value: 'system',
      label: t(
        'settings.followSystem',
      ),
    },
  ];

  const languageOptions: Array<
    SelectOption<UiLanguagePreference>
  > = [
    {
      value: 'system',
      label: t(
        'settings.followSystem',
      ),
    },
    {
      value: 'zh-Hans',
      label: t(
        'settings.simplifiedChinese',
      ),
    },
    {
      value: 'zh-Hant',
      label: t(
        'settings.traditionalChinese',
      ),
    },
    {
      value: 'en',
      label: t(
        'settings.english',
      ),
    },
  ];

  return (
    <div
      className={[
        contentClass,
        'box-border h-full w-full min-w-0 overflow-x-hidden overflow-y-auto px-[10px] pb-[28px] [&::-webkit-scrollbar]:hidden [scrollbar-width:none]',
      ].join(' ')}
    >
      <div className="mb-[10px]">
        <div className="mt-[20px] select-none text-[20px] font-semibold">
          {t(
            'settings.general',
          )}
        </div>
      </div>

      <section className="max-w-[520px] space-y-[16px]">
        <SettingsSelect
          label={t(
            'settings.appearance',
          )}
          value={
            appearancePreference
          }
          options={
            appearanceOptions
          }

          onChange={
            setAppearancePreference
          }
        />

        <SettingsSelect
          label={t(
            'settings.language',
          )}
          value={
            selectedLanguage
          }
          options={
            languageOptions
          }
          disabled={saving}

          onChange={(value) =>
            void handleLanguageChange(
              value,
            )
          }
        />
      </section>
    </div>
  );
}
