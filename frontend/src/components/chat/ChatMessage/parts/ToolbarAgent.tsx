import { resolveAssetUrl } from '../../../../utils/asset-url';
import IconButton from '../../../ui/IconButton';
import { useLocalize } from '../../../../localization/useLocalize';

type CopyState = 'idle' | 'copied' | 'error';

interface ToolbarAgentProps {

  onCopyClick: () => void;
  copyState: CopyState;
  onBranchClick?: () => void;
  branching?: boolean;
}

export default function ToolbarAgent({
    onCopyClick,
  copyState,
  onBranchClick,
  branching = false,
}: ToolbarAgentProps) {
  const localize = useLocalize();
  return (
    <div
      data-desktop-no-drag
      className="flex items-center justify-start mt-[-6px] ml-1 mb-[1rem]"
    >
      <IconButton

        title={
          copyState === 'copied'
            ? localize('common.copied')
            : copyState === 'error'
              ? localize('common.copyFailed')
              : localize('common.copy')
        }
        onClick={onCopyClick}
        icon={
          <img
            src={resolveAssetUrl(`/icons/${copyState === 'copied' ? 'copyed.svg' : 'copy.svg'}`)}
            style={{
              height: '1.1rem',
              userSelect: 'none',
            }}
            alt={copyState === 'copied' ? localize('common.copied') : localize('common.copy')}
          />
        }
      />

      {onBranchClick && (
        <IconButton

          title={branching ? localize('chat.toolbar.branching') : localize('chat.toolbar.createBranch')}
          aria-label={localize('chat.branch.createHere')}
          onClick={onBranchClick}
          disabled={branching}
          icon={
            <img
              src={resolveAssetUrl('/icons/tree.svg')}
              style={{
                height: '1.1rem',
                userSelect: 'none',
              }}
              alt={localize('chat.branch.create')}
            />
          }
        />
      )}
    </div>
  );
}