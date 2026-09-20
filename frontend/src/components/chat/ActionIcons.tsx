import { resolveAssetUrl } from '../../utils/asset-url';
import { useAppearance } from '../../theme/useAppearance';
                                               
import React from 'react';
import { useLocalize } from '../../localization/useLocalize';
interface ActionIconsProps {

  showTask?: boolean;
  activeIcons: {
    task: boolean;
    mcp: boolean;
  };
  onIconClick: (
    icon: 'task' | 'mcp',
  ) => void;
  onAddAttachment?: () => void;
  showText?: boolean;
}
const ActionIcons = ({
    showTask = false,
  activeIcons,
  onIconClick,
  onAddAttachment = () => {},
}: ActionIconsProps) => {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const getIconSrc = (
    iconName: string,
    isActive: boolean,
  ) => {
    const baseName =
      iconName.split('.')[0];
    if (
      iconName === 'task.svg'
      && isActive
    ) {
      return resolveAssetUrl('/icons/blue/taskblue.svg');
    }
    if (iconName === 'mcp.svg') {
      if (isActive) {
        return resolveAssetUrl('/icons/blue/mcpblue.svg');
      }
      return isDarkTheme
        ? resolveAssetUrl('/icons/white/mcp1.svg')
        : resolveAssetUrl('/icons/mcp.svg');
    }
    if (isActive) {
      return resolveAssetUrl(`/icons/blue/${baseName}blue.svg`);
    }
    return isDarkTheme
      ? resolveAssetUrl(`/icons/white/${baseName}1.svg`)
      : resolveAssetUrl(`/icons/${iconName}`);
  };
  const buttonStyle = (
    isActive: boolean,
  ): React.CSSProperties => ({
    padding: '0',
    width: '28px',
    height: '28px',
    border: 'none',
    borderRadius: '50%',
    transition: 'all 0.2s ease',
    color: isActive
      ? isDarkTheme
        ? '#3388ff'
        : '#FFFFFF'
      : isDarkTheme
        ? '#E5E7EB'
        : '#898989',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1px',
    cursor: 'pointer',
    boxShadow: isActive
      ? '0 2px 4px rgba(37, 99, 235, 0.3)'
      : 'none',
    userSelect: 'none',
  });
  const buttonClassName = (
    isActive: boolean,
  ) => {
    if (isActive) {
      return 'bg-[#2563EB] hover:bg-[#3388ff] dark:bg-[#1f1f1f] dark:hover:bg-[#272936]';
    }
    return 'bg-surface-chat-raised hover:bg-[#E2E2E2]  dark:hover:bg-[#303030]';
  };
  const iconStyle: React.CSSProperties = {
    width: '16px',
    height: '18px',
  };
  return (
    <div className="flex gap-[8px]">
      <button
        type="button"
        onClick={onAddAttachment}
        style={buttonStyle(false)}
        className={`${buttonClassName(false)} focus:outline-none`}
        title={localize('chat.attachments.add')}
      >
        <img
          src={getIconSrc(
            'plus.svg',
            false,
          )}
          alt={localize('chat.attachments.add')}
          style={iconStyle}
        />
      </button>
      <button
        type="button"
        onClick={() =>
          onIconClick('mcp')
        }
        style={buttonStyle(false)}
        className={`${buttonClassName(false)} focus:outline-none`}
        title={
          activeIcons.mcp
            ? localize('chat.actions.mcpManageEnabled')
            : localize('chat.actions.mcpManageDisabled')
        }
        aria-pressed={activeIcons.mcp}
      >
        <img
          src={getIconSrc(
            'mcp.svg',
            activeIcons.mcp,
          )}
          alt="" aria-hidden="true"
          style={iconStyle}
        />
      </button>
      {showTask && (
        <button
          type="button"
          onClick={() =>
            onIconClick('task')
          }
          style={buttonStyle(
            activeIcons.task,
          )}
          className={`${buttonClassName(activeIcons.task)} focus:outline-none`}
          title={
            activeIcons.task
              ? localize('chat.actions.collapseWorkflow')
              : localize('chat.actions.expandWorkflow')
          }
          aria-label={
            activeIcons.task
              ? localize('chat.actions.collapseWorkflow')
              : localize('chat.actions.expandWorkflow')
          }
          aria-pressed={activeIcons.task}
        >
          <img
            src={getIconSrc(
              'task.svg',
              activeIcons.task,
            )}
            alt="" aria-hidden="true"
            style={iconStyle}
          />
        </button>
      )}
    </div>
  );
};
export default ActionIcons;