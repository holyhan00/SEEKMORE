                                                                        
import { getSkillDisplayName } from '../shared/skill-display-name';
import type { SkillSummary } from '../types/skill.types';
import { useFormatter } from '../../../../localization/useFormatter';
import { useLocalize } from '../../../../localization/useLocalize';

interface AgentSkillPickerItemProps {
  skill: SkillSummary;
  linked: boolean;
  disabled?: boolean;

  onToggle: () => void;
}

export default function AgentSkillPickerItem({
  skill,
  linked,
  disabled = false,
    onToggle,
}: AgentSkillPickerItemProps) {
  const localize = useLocalize();
  const formatter = useFormatter();

  const createdAt = (() => {
    const date = new Date(skill.createdAt);
    if (Number.isNaN(date.getTime())) return '';
    return formatter.formatDate(date, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  })();

  const displayName =
    getSkillDisplayName(skill);
  const deleted = Boolean(
    skill.deletedAt,
  );

  return (
    <article
      className={`
        box-border
        w-full
        max-w-full
        min-w-0
        overflow-hidden
        rounded-[12px]
        border
        p-[12px]
        transition-colors
        ${
          deleted
            ? 'border-[#dddddd] bg-[#f5f5f5] opacity-65 dark:border-[#383838] dark:bg-[#1b1b1b] dark:opacity-60'
            : linked
              ? 'border-[#0c5cfb]'
              : 'border-edge-strong '
        }
        ${
          deleted
            ? ''
            : 'bg-surface-panel '
        }
      `}
    >
      <div
        className="
          grid
          w-full
          min-w-0
          max-w-full
          grid-cols-[minmax(0,1fr)_auto]
          items-start
          gap-[10px]
        "
      >
        <div className="min-w-0 overflow-hidden">
          <div className="flex min-w-0 max-w-full items-center gap-[7px] overflow-hidden">
            <div
              className="min-w-0 flex-1 truncate text-[11px] font-medium"
              title={displayName}
            >
              {displayName}
            </div>

            {deleted && (
              <span className="shrink-0 rounded-[5px] bg-status-danger-soft px-[5px] py-[2px] text-[8px] text-status-danger">
                {localize('skills.picker.deleted')}
              </span>
            )}

            {skill.category && (
              <span
                className={`
                  max-w-[90px]
                  shrink-0
                  truncate
                  rounded-[5px]
                  px-[5px]
                  py-[2px]
                  text-[8px]
                  ${
                    'bg-surface-hover text-[#777777]  dark:text-[#a0a0a0]'
                  }
                `}
              >
                {skill.category}
              </span>
            )}
          </div>

          <div
            className="mt-[4px] min-w-0 max-w-full line-clamp-2 break-words [overflow-wrap:anywhere] text-[9px] leading-[15px] opacity-55"
            title={skill.description}
          >
            {skill.description}
          </div>

          {deleted ? (
            <div className="mt-[5px] min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-[8px] text-status-danger">
              {linked
                ? localize('skills.picker.deletedLinkedHint')
                : localize('skills.picker.deletedUnlinkedHint')}
            </div>
          ) : createdAt ? (
            <div className="mt-[5px] min-w-0 max-w-full truncate text-[8px] opacity-35">
              {localize('skills.picker.createdAt', { date: createdAt })}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          disabled={disabled || (deleted && !linked)}
          onClick={onToggle}
          title={
            linked
              ? localize('skills.picker.unlink')
              : deleted
                ? localize('skills.picker.deletedCannotLink')
                : localize('skills.picker.linkTitle')
          }
          className={`
            shrink-0
            select-none
            rounded-[7px]
            border-0
            px-[9px]
            py-[6px]
            text-[9px]
            outline-none
            transition-colors
            disabled:cursor-not-allowed
            disabled:opacity-50
            ${
              linked
                ? 'bg-[#eeeeee] text-[#777777] hover:bg-[#e4e4e4] hover:text-[#0000000] dark:bg-[#2b2b2b] dark:text-[#b5b5b5] dark:hover:bg-[#333333] dark:hover:text-[#ffffff]'
                : deleted
                  ? 'cursor-not-allowed bg-status-danger-soft text-status-danger'
                  : 'bg-action-primary text-[#ffffff] hover:text-[#ffffff]'
            }
          `}
        >
          {linked
            ? localize('skills.picker.unlink')
            : deleted
              ? localize('skills.picker.deleted')
              : localize('skills.picker.link')}
        </button>
      </div>
    </article>
  );
}