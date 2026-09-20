                                                              
import { useLocalize } from '../../../localization/useLocalize';

export default function ModelApiKeyField(props: {
  label?: string;
  value: string;
  configuredHint: string | null;
  apiKeyUrl: string;
  disabled?: boolean;

  onChange: (value: string) => void;
}) {
  const localize = useLocalize();

  const openKeyPage = async () => {
    const url = props.apiKeyUrl.trim();
    if (!url) return;

    try {
      const desktopResult =
        await window.seekmoreDesktop?.web?.openExternal?.(
          url,
        );

      if (desktopResult?.opened) return;
    } catch {
                                                                                
    }

    window.open(
      url,
      '_blank',
      'noopener,noreferrer',
    );
  };

  return (
    <div>
      <div className="select-none text-[11px] font-medium">
        {props.label ??
          localize('common.apiKey')}
      </div>

      <div
        className={[
          'relative h-[44px] w-full',
          'rounded-[10px]',
          'bg-surface-control text-theme-body  ',
        ].join(' ')}
      >
        <input
          type="password"
          autoComplete="off"
          value={props.value}
          disabled={props.disabled}
          onChange={(event) =>
            props.onChange(
              event.target.value,
            )
          }
          placeholder={
            props.configuredHint
              ? localize(
                  'settings.model.apiKey.saved',
                  {
                    hint:
                      props.configuredHint,
                  },
                )
              : localize(
                  'settings.model.apiKey.paste',
                )
          }
          className={[
            'h-full w-full min-w-0 truncate',
            'rounded-[10px]',
            'border-0 appearance-none',
            'bg-transparent',
            'pl-[12px] pr-[68px]',
            'text-[11px] font-medium',
            'outline-none ring-0 shadow-none',
            'focus:border-0 focus:outline-none focus:ring-0 focus:shadow-none',
            'text-theme-body placeholder:text-[#9ca3af]  dark:placeholder:text-[#6b7280]',
          ].join(' ')}
        />

        <button
          type="button"
          disabled={
            props.disabled ||
            !props.apiKeyUrl
          }
          onClick={() => {
            void openKeyPage();
          }}
          className={[
            'absolute right-[6px] top-1/2',
            'inline-flex h-[32px] -translate-y-1/2 items-center justify-center',
            'shrink-0 rounded-[8px]',
            'select-none',
            'px-[10px] py-0',
            'text-[11px] font-medium leading-none',
            'transition-colors',
            'disabled:cursor-not-allowed',
            'disabled:opacity-40',
            'bg-action-primary text-[#ffffff]',
            'hover:bg-action-primary-hover hover:text-[#ffffff]',
          ].join(' ')}
        >
          {localize(
            'settings.model.apiKey.get',
          )}
        </button>
      </div>
    </div>
  );
}