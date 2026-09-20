import { resolveAssetUrl } from '../../../utils/asset-url';
import { useAppearance } from '../../../theme/useAppearance';
                                                                 
import { useLocalize } from '../../../localization/useLocalize';
export type ComposerPrimaryActionMode = 'send' | 'pause';

export default function ComposerActionButton(props: {
  mode: ComposerPrimaryActionMode;
  disabled: boolean;
  busy?: boolean;
  onClick(): void;

}) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const pause = props.mode === 'pause';

  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-busy={props.busy || undefined}
      aria-label={pause ? localize('chat.composer.stop') : localize('chat.composer.send')}
      title={pause ? localize('chat.composer.stop') : localize('chat.composer.send')}
      className={`flex h-[28px] w-[28px] select-none items-center justify-center rounded-full [&_*]:!select-none transition ${
        'bg-[#ffffff] hover:bg-[#ececec] dark:bg-[#353638] dark:hover:bg-[#454648]'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <img
        src={
          isDarkTheme
            ? pause
              ? resolveAssetUrl('/icons/white/pause1.svg')
              : resolveAssetUrl('/icons/white/send1.svg')
            : pause
              ? resolveAssetUrl('/icons/pause.svg')
              : resolveAssetUrl('/icons/send.svg')
        }
        alt=""
        draggable={false}
        className="h-[28px] w-[28px]"
      />
    </button>
  );
}
