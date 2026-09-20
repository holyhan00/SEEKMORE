import ImageGenerationBlackHoleCanvas
  from '../common/ImageGenerationBlackHoleCanvas';
import { useLocalize } from '../localization/useLocalize';

interface StartupScreenProps {
  error?: boolean;
  onRetry?: () => void;
}

export default function StartupScreen({
  error = false,
  onRetry,
}: StartupScreenProps) {
  const t = useLocalize();

  return (
    <div
      data-desktop-no-drag
      className="relative h-full w-full overflow-hidden bg-black"
    >
      <ImageGenerationBlackHoleCanvas />

      {error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35 px-6">
          <div className="flex max-w-[360px] flex-col items-center gap-4 rounded-[14px] bg-black/55 px-6 py-5 text-center text-white backdrop-blur-md">
            <div className="text-[13px] font-medium">
              {t('app.startupFailed')}
            </div>

            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-[8px] bg-white px-4 py-2 text-[12px] font-semibold text-black"
              >
                {t('common.actions.retry')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
