                                                           
import { useLocalize } from '../../../localization/useLocalize';
import type {
  SkillLibraryView,
  SkillSecurityState,
  SkillStatus,
  SkillSummary,
} from './types/skill.types';
import { getSkillDisplayName } from './shared/skill-display-name';

interface SkillCardProps {
  skill: SkillSummary;
  view: SkillLibraryView;

  actionBusy?: boolean;
  permanentDeleteBusy?: boolean;
  onClick: () => void;
  onAction?: () => void;
  onPermanentDelete?: () => void;
}

interface SkillStatusMeta {
  labelKey: string;
  className: string;
}

interface SkillActionMeta {
  labelKey: string;
  actionable: boolean;
}

function getSkillStatusMeta(
  status: SkillStatus,
  securityState: SkillSecurityState,
  deletedAt?: string | null,
): SkillStatusMeta {
  if (deletedAt) {
    return {
      labelKey: 'skills.status.deleted',
      className:
        'bg-red-500/[0.10] text-red-600 dark:bg-red-500/[0.14] dark:text-red-300',
    };
  }

  if (
    securityState === 'BLOCKED' ||
    securityState === 'QUARANTINED'
  ) {
    return {
      labelKey:
        securityState === 'BLOCKED'
          ? 'skills.status.blocked'
          : 'skills.status.quarantined',
      className:
        'bg-red-500/[0.10] text-red-600 dark:bg-red-500/[0.14] dark:text-red-300',
    };
  }

  if (
    securityState === 'REVIEW_REQUIRED'
  ) {
    return {
      labelKey: 'skills.status.reviewRequired',
      className:
        'bg-amber-500/[0.12] text-amber-700 dark:bg-amber-500/[0.15] dark:text-amber-300',
    };
  }

  switch (status) {
    case 'ACTIVE':
      return {
        labelKey: 'skills.status.ACTIVE',
      className:
        'bg-action-primary text-[#ffffff] dark:bg-[#3b82f6] dark:text-[#ffffff]',
      };

    case 'DRAFT':
      return {
        labelKey: 'skills.status.DRAFT',
      className:
        'bg-[#e5e7eb] text-[#5b616b] dark:bg-[#ffffff]/[0.09] dark:text-[#ffffff]/60',
      };

    case 'VALIDATING':
      return {
        labelKey: 'skills.status.VALIDATING',
      className:
        'bg-blue-500/[0.10] text-blue-700 dark:bg-blue-500/[0.15] dark:text-blue-300',
      };

    case 'REJECTED':
      return {
        labelKey: 'skills.status.REJECTED',
      className:
        'bg-[#fff1e6] text-[#ea580c] dark:bg-orange-500/[0.16] dark:text-orange-300',
      };

    case 'ARCHIVED':
      return {
        labelKey: 'skills.status.ARCHIVED',
      className:
        'bg-[#e5e7eb] text-theme-skill-muted dark:bg-[#ffffff]/[0.09] ',
      };

    case 'DISABLED':
      return {
        labelKey: 'skills.status.DISABLED',
      className:
        'bg-[#e5e7eb] text-theme-skill-muted dark:bg-[#ffffff]/[0.09] ',
      };

    case 'STALE':
      return {
        labelKey: 'skills.status.STALE',
      className:
        'bg-violet-500/[0.10] text-violet-700 dark:bg-violet-500/[0.15] dark:text-violet-300',
      };

    default:
      return {
        labelKey: `skills.status.${status}`,
      className:
        'bg-[#e5e7eb] text-theme-skill-muted dark:bg-[#ffffff]/[0.09] ',
      };
  }
}

function getSkillActionMeta(
  view: SkillLibraryView,
): SkillActionMeta {
  switch (view) {
    case 'drafts':
      return {
        labelKey: 'skills.action.publish',
        actionable: true,
      };

    case 'archived':
    case 'deleted':
      return {
        labelKey: 'skills.action.restore',
        actionable: true,
      };

    default:
      return {
        labelKey: 'skills.status.ACTIVE',
        actionable: false,
      };
  }
}

export default function SkillCard({
  skill,
  view,
    actionBusy = false,
  permanentDeleteBusy = false,
  onClick,
  onAction,
  onPermanentDelete,
}: SkillCardProps) {
  const localize = useLocalize();
  const authorName =
    skill.createdBy?.username?.trim() ||
    localize('skills.unknownAuthor');

  const versionLabel =
    skill.currentVersion?.versionLabel ||
    localize('skills.noVersion');

  const statusMeta =
    getSkillStatusMeta(
      skill.status,
      skill.securityState,
      skill.deletedAt,
    );

  const actionMeta =
    getSkillActionMeta(view);

  const cardBusy =
    actionBusy ||
    permanentDeleteBusy;

  const actionEnabled =
    actionMeta.actionable &&
    Boolean(onAction) &&
    !cardBusy;

  const permanentDeleteEnabled =
    view === 'deleted' &&
    Boolean(onPermanentDelete) &&
    !cardBusy;

  return (
    <article
      onClick={onClick}
      className={`
        group
        box-border
        flex
        min-h-[200px]
        w-full
        min-w-[120px]
        cursor-pointer
        select-none
        [&_button]:!select-none
        [&_button_*]:!select-none
        flex-col
        overflow-hidden
        rounded-[10px]
        p-[10px]
        text-left
        outline-none
        transition-all
        duration-200
        hover:-translate-y-[2px]
        hover:shadow-[0_18px_40px_rgba(12,92,251,0.18)]
        active:translate-y-0
        ${
          'border-[#000000]/[0.055] bg-surface-control-alt hover:border-[#000000]/[0.10] dark:border-[#ffffff]/[0.06]  dark:hover:border-[#ffffff]/[0.11] dark:hover:bg-[#272728]'
        }
      `}
    >
      <div
        className="
          box-border
          flex
          min-h-0
          w-full
          min-w-0
          flex-1
          flex-col
        "
      >
        <div
          className="
            flex
            w-full
            min-w-0
            items-start
            justify-between
            gap-[18px]
          "
        >
          <h2
            className={`
              relative
              m-0
              min-w-0
              flex-1
              truncate
              text-[18px]
              font-semibold
              leading-[18px]
              mb-[4px]
              ${
                'text-theme-primary-alt '
              }
            `}
            title={getSkillDisplayName(skill)}
          >
            {getSkillDisplayName(skill)}
          </h2>

          <span
            className={`
              inline-flex
              h-[14px]
              shrink-0
              self-start
              select-none
              items-center
              justify-center
              whitespace-nowrap
              rounded-[8px]
              px-[10px]
              text-[8px]
              leading-none
              ${statusMeta.className}
            `}
          >
            {localize(statusMeta.labelKey)}
          </span>
        </div>

        <div
          className={`
            line-clamp-3
            mt-[10px]
            min-h-[54px]
            min-w-0
            text-[10px]
            leading-[18px]
            ${
              'text-[#000000]/48 dark:text-[#ffffff]/42'
            }
          `}
        >
          {skill.description ||
            localize('skills.noDescription')}
        </div>

        <div
          className="
            mt-auto
            grid
            w-full
            min-w-0
            grid-cols-[minmax(0,1fr)_auto]
            items-center
            gap-[10px]
          "
        >
          <span
            className={`
              box-border
              flex
              h-[30px]
              w-full
              min-w-0
              items-center
              justify-center
              overflow-hidden
              rounded-[10px]
              px-[10px]
              text-center
              text-[10px]
              ${
                'bg-surface-card text-[#000000]/50  dark:text-[#ffffff]/45'
              }
            `}
            title={localize('skills.author', { name: authorName })}
          >
            <span
              className="
                block
                w-full
                min-w-0
                truncate
                text-center
              "
            >
              {localize('skills.author', { name: authorName })}
            </span>
          </span>

          <span
            className={`
              box-border
              inline-flex
              h-[30px]
              shrink-0
              items-center
              justify-center
              whitespace-nowrap
              rounded-[10px]
              px-[8px]
              text-center
              text-[9px]
              ${
                'bg-surface-card text-[#000000]/50  dark:text-[#ffffff]/45'
              }
            `}
            title={versionLabel}
          >
            {versionLabel}
          </span>
        </div>
      </div>

      {view === 'deleted' ? (
        <div
          className="
            mt-[10px]
            grid
            w-full
            grid-cols-2
            gap-[8px]
          "
        >
          <button
            type="button"
            disabled={!actionEnabled}
            onClick={(event) => {
              event.stopPropagation();

              if (actionEnabled) {
                onAction?.();
              }
            }}
            className="
              box-border
              flex
              h-[34px]
              w-full
              select-none
              items-center
              justify-center
              rounded-[10px]
              border-0
              bg-action-primary
              px-0
              py-0
              text-[10px]
              font-medium
              text-[#ffffff]
              outline-none
              transition-all
              hover:bg-action-primary-hover
              disabled:cursor-default
              disabled:opacity-45
            "
          >
            {actionBusy
              ? localize('skills.processing')
              : localize(actionMeta.labelKey)}
          </button>

          <button
            type="button"
            disabled={
              !permanentDeleteEnabled
            }
            onClick={(event) => {
              event.stopPropagation();

              if (
                permanentDeleteEnabled
              ) {
                onPermanentDelete?.();
              }
            }}
            className={`
              box-border
              flex
              h-[34px]
              w-full
              select-none
              items-center
              justify-center
              rounded-[10px]
              border-[0.5px]
              px-0
              py-0
              text-[10px]
              font-medium
              outline-none
              transition-all
              disabled:cursor-default
              disabled:opacity-45
              ${
                'border-red-500/15 bg-red-500/[0.08] text-red-600 hover:bg-red-500/[0.13] dark:border-red-400/20 dark:bg-red-500/[0.10] dark:text-red-300 dark:hover:bg-red-500/[0.16]'
              }
            `}
          >
            {permanentDeleteBusy
              ? localize('skills.deleting')
              : localize('skills.permanentDelete')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!actionEnabled}
          onClick={(event) => {
            event.stopPropagation();

            if (actionEnabled) {
              onAction?.();
            }
          }}
          className={`
            mt-[10px]
            box-border
            flex
            h-[34px]
            w-full
            shrink-0
            select-none
            items-center
            justify-center
            rounded-[10px]
            border-0
            px-0
            py-0
            text-[10px]
            font-medium
            outline-none
            transition-all
            disabled:cursor-default
            ${
              actionMeta.actionable
                ? 'bg-action-primary text-[#ffffff] hover:bg-action-primary-hover disabled:opacity-45'
                : 'bg-surface-card text-[#000000]/42  dark:text-[#ffffff]/42'
            }
          `}
        >
          {actionBusy
            ? localize('skills.processing')
            : localize(actionMeta.labelKey)}
        </button>
      )}
    </article>
  );
}
