import { resolveAssetUrl } from '../../../utils/asset-url';
                                                                  

import { useAppearance } from '../../../theme/useAppearance';
import { useLocalize } from '../../../localization/useLocalize';

export default function EmbodiedAgentPanel({
}: {

}) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();

  return (
    <main
      className={`h-full overflow-y-auto pb-8 ${
        'bg-surface-page '
      }`}
    >
      <div className="mx-auto w-[95%] min-w-0">
        <header
          className="relative flex min-h-[132px] items-end justify-between overflow-hidden rounded-[18px] bg-cover bg-center bg-no-repeat px-[22px]"
          style={{
            backgroundImage: `url("${
              isDarkTheme
                ? resolveAssetUrl('/backgrounds/agent-card-dark.jpg')
                : resolveAssetUrl('/backgrounds/agent-card-light.jpg')
            }")`,
          }}
          onCopy={(event) =>
            event.preventDefault()
          }
        >
          <div
            className={`pointer-events-none absolute inset-0 ${
              'bg-surface-inverse-soft '
            }`}
          />

          <div className="relative bottom-[16px] z-10 flex min-w-0 select-none flex-col gap-0">
            <h1
              className={`m-0 select-none text-[27px] font-semibold leading-[50px] tracking-[-0.035em] ${
                'text-theme-title '
              }`}
            >
              {localize('embodied.title')}
            </h1>

            <p
              className={`m-0 select-none text-[12px] leading-[10px] ${
                'text-theme-subtle '
              }`}
            >
              {localize('embodied.description')}
            </p>
          </div>
        </header>
      </div>
    </main>
  );
}