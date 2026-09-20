import { resolveAssetUrl } from '../../../../utils/asset-url';
import { useLocalize } from '../../../../localization/useLocalize';
import IconButton from '../../../ui/IconButton';

type CopyState = 'idle' | 'copied' | 'error';

export default function ToolbarUser({
    onCopyClick,
  copyState,
}: {

  onCopyClick: () => void;
  copyState: CopyState;
}) {
  const localize = useLocalize();
  return (
    <div data-desktop-no-drag className="flex items-center justify-end mt-[8px] mr-1 mb-[1rem]">
      <IconButton

        title={copyState === 'copied' ? localize('common.copied') : copyState === 'error' ? localize('common.copyFailed') : localize('common.copy')}
        onClick={onCopyClick}
        icon={
          <img
            src={resolveAssetUrl(`/icons/${copyState === 'copied' ? 'copyed.svg' : 'copy.svg'}`)}
            style={{ height: '1.1rem', userSelect: 'none' }}
            alt={copyState === 'copied' ? localize('common.copied') : localize('common.copy')}
          />
        }
      />
    </div>
  );
}
