import { resolveAssetUrl } from '../../../utils/asset-url';
                                                             

import { useAppearance } from '../../../theme/useAppearance';
import {
  useMemo,
  useState,
} from 'react';

import { confirm } from '../../../lib/confirm';
import { useLocalize } from '../../../localization/useLocalize';
import { localizeApiError } from '../../../localization/localizeApiError';

import {
  permanentlyDeleteSkill,
  restoreDeletedSkill,
  setSkillLifecycle,
  validateAndActivateSkill,
} from './api/skill.api';
import SkillCreateModal from './create/SkillCreateModal';
import SkillDetailPage from './detail/SkillDetailPage';
import SkillEditor from './edit/SkillEditor';
import { useSkillList } from './hooks/useSkillList';
import SkillCard from './SkillCard';
import { getSkillDisplayName } from './shared/skill-display-name';
import type {
  SkillLibraryView,
  SkillSummary,
} from './types/skill.types';

interface SkillLibraryPageProps {

  onBack?: () => void;
}

type SkillCreateTargetView = Extract<
  SkillLibraryView,
  'mine' | 'drafts'
>;

const SKILL_LIBRARY_VIEWS: Array<{
  value: SkillLibraryView;
  labelKey: string;
}> = [
  {
    value: 'mine',
    labelKey: 'skills.library.mine',
  },
  {
    value: 'drafts',
    labelKey: 'skills.library.drafts',
  },
  {
    value: 'archived',
    labelKey: 'skills.library.archived',
  },
  {
    value: 'deleted',
    labelKey: 'skills.library.deleted',
  },
];

export default function SkillLibraryPage({
  onBack,
}: SkillLibraryPageProps) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();

  const [scope, setScope] =
    useState<SkillLibraryView>('mine');

  const [search, setSearch] =
    useState('');

  const [selected, setSelected] =
    useState<string | null>(null);

  const [creating, setCreating] =
    useState(false);

  const [editing, setEditing] =
    useState<string | undefined>(
      undefined,
    );

  const [
    actionSkillId,
    setActionSkillId,
  ] = useState<string | null>(null);

  const [actionError, setActionError] =
    useState('');

  const params = useMemo(
    () => ({
      scope,
      search,
      limit: 100,
    }),
    [scope, search],
  );

  const {
    items,
    total,
    loading,
    error,
    refresh,
  } = useSkillList(params);

  const handleCreateSaved = async (
    _skillId: string,
    targetView: SkillCreateTargetView,
  ) => {
    const shouldRefreshCurrentView =
      scope === targetView &&
      search.length === 0;

    setCreating(false);
    setEditing(undefined);
    setSelected(null);
    setScope(targetView);
    setSearch('');
    setActionError('');

    if (shouldRefreshCurrentView) {
      await refresh();
    }
  };

  const handleEditorSaved = async (
    skillId: string,
  ) => {
    setEditing(undefined);
    setSelected(skillId);

    await refresh();
  };

  const switchScope = (
    nextScope: SkillLibraryView,
  ) => {
    setScope(nextScope);
    setSelected(null);
    setEditing(undefined);
    setActionError('');
  };

  const handleCardAction = async (
    skill: SkillSummary,
  ) => {
    if (
      actionSkillId ||
      scope === 'mine'
    ) {
      return;
    }

    setActionSkillId(skill.id);
    setActionError('');

    try {
      if (scope === 'drafts') {
        await validateAndActivateSkill(
          skill.id,
        );
      } else if (
        scope === 'archived'
      ) {
        await setSkillLifecycle(
          skill.id,
          'restore',
        );
      } else if (
        scope === 'deleted'
      ) {
        await restoreDeletedSkill(
          skill.id,
        );
      }

      await refresh();
    } catch (reason) {
      setActionError(
        localizeApiError(
          reason,
          'skills.library.actionFailed',
        ),
      );
    } finally {
      setActionSkillId(null);
    }
  };

  const handlePermanentDelete = async (
    skill: SkillSummary,
  ) => {
    if (
      scope !== 'deleted' ||
      actionSkillId
    ) {
      return;
    }

    const confirmed = await confirm({
      title: localize(
        'skills.library.purgeTitle',
      ),
      description: localize(
        'skills.library.purgeDescription',
        {
          name:
            getSkillDisplayName(skill),
        },
      ),
      confirmText: localize(
        'skills.library.purge',
      ),
      cancelText: localize(
        'common.actions.cancel',
      ),
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    setActionSkillId(skill.id);
    setActionError('');

    try {
      await permanentlyDeleteSkill(
        skill.id,
      );

      window.dispatchEvent(
        new CustomEvent(
          'skill:permanently-deleted',
          {
            detail: {
              skillId: skill.id,
            },
          },
        ),
      );

      await refresh();
    } catch (reason) {
      setActionError(
        localizeApiError(
          reason,
          'skills.library.actionFailed',
        ),
      );
    } finally {
      setActionSkillId(null);
    }
  };

  const isDeletedView =
    scope === 'deleted';

  return (
    <>
      {selected ? (
        <SkillDetailPage
          skillId={selected}
          view={scope}
          onBack={() =>
            setSelected(null)
          }
          onEdit={
            isDeletedView
              ? undefined
              : () =>
                  setEditing(selected)
          }
          onChanged={refresh}
          onRestored={async () => {
            setSelected(null);

            await refresh();
          }}
        />
      ) : (
        <section
          className={`
            h-full
            overflow-y-auto
            select-none
            [&_button]:!select-none
            [&_button_*]:!select-none
            pb-8
            ${
              'bg-surface-page text-theme-title  '
            }
          `}
        >
          <div className="mx-auto w-[95%] min-w-0">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className={`
                  mb-[24px]
                  select-none
                  text-[10px]
                  outline-none
                  transition-colors
                  ${
                    'text-[#000000]/38 hover:text-[#000000]/65 dark:text-[#ffffff]/35 dark:hover:text-[#ffffff]/65'
                  }
                `}
              >
                {localize(
                  'common.actions.back',
                )}
              </button>
            )}

            <header
              className="
                relative
                flex
                min-h-[132px]
                items-end
                justify-between
                overflow-hidden
                rounded-[18px]
                bg-cover
                bg-center
                bg-no-repeat
                px-[22px]
              "
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
                className={`
                  pointer-events-none
                  absolute
                  inset-0
                  ${
                    'bg-surface-inverse-soft '
                  }
                `}
              />

              <div
                className="
                  relative
                  bottom-[16px]
                  z-10
                  flex
                  min-w-0
                  select-none
                  flex-col
                  gap-0
                "
              >
                <h1
                  className={`
                    m-0
                    select-none
                    text-[27px]
                    font-semibold
                    leading-[50px]
                    tracking-[-0.035em]
                    ${
                      'text-theme-title '
                    }
                  `}
                >
                  {localize(
                    'skills.library.mine',
                  )}
                </h1>

                <p
                  className={`
                    m-0
                    select-none
                    text-[12px]
                    leading-[10px]
                    ${
                      'text-theme-subtle '
                    }
                  `}
                >
                  {isDeletedView
                    ? localize(
                        'skills.library.deletedDescription',
                      )
                    : localize(
                        'skills.library.description',
                      )}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setCreating(true)
                }
                className="
                  relative
                  bottom-[16px]
                  z-10
                  flex
                  h-10
                  shrink-0
                  select-none
                  items-center
                  justify-center
                  rounded-[11px]
                  bg-action-primary
                  px-5
                  py-0
                  text-[12px]
                  font-medium
                  !text-[#ffffff]
                  shadow-[0_10px_24px_rgba(12,92,251,0.2)]
                  transition
                  hover:bg-action-primary-hover
                  hover:!text-[#ffffff]
                  active:translate-y-px
                "
              >
                {localize(
                  'skills.library.create',
                )}
              </button>
            </header>

            <div
              className="
                mt-[10px]
                flex
                min-w-0
                gap-[10px]
              "
            >
              <input
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value,
                  )
                }
                placeholder={
                  isDeletedView
                    ? localize(
                        'skills.library.searchDeleted',
                      )
                    : localize(
                        'skills.library.search',
                      )
                }
                className={`
                  box-border
                  h-[40px]
                  min-w-0
                  flex-1
                  rounded-[11px]
                  border-[0.5px]
                  px-[12px]
                  text-[11px]
                  outline-none
                  transition-colors
                  focus:border-[#0c5cfb]/55
                  ${
                    'border-edge-alpha-07 bg-surface-control-alt text-theme-primary-alt placeholder:text-[#000000]/28    dark:placeholder:text-[#ffffff]/25'
                  }
                `}
              />

              {SKILL_LIBRARY_VIEWS.map(
                (view) => {
                  const active =
                    scope ===
                    view.value;

                  return (
                    <button
                      key={view.value}
                      type="button"
                      aria-pressed={
                        active
                      }
                      onClick={() =>
                        switchScope(
                          view.value,
                        )
                      }
                      className={`
                        box-border
                        h-[40px]
                        w-[70px]
                        shrink-0
                        select-none
                        rounded-[11px]
                        border
                        text-[10px]
                        font-medium
                        outline-none
                        transition-all
                        ${
                          active
                            ? `
                              border-[#0c5cfb]
                              bg-[#0c5cfb]
                              text-[#ffffff]
                              shadow-[0_7px_18px_rgba(12,92,251,0.18)]
                            `
                            : 'border-edge-alpha-07 bg-surface-control-alt text-[#5b616b] hover:border-[#000000]/[0.12] hover:text-[#171717]   dark:text-[#ffffff]/55 dark:hover:border-[#ffffff]/[0.12] dark:hover:text-[#ffffff]'
                        }
                      `}
                    >
                      {localize(
                        view.labelKey,
                      )}
                    </button>
                  );
                },
              )}
            </div>

            <div
              className={`
                mt-[12px]
                select-none
                text-[10px]
                ${
                  'text-theme-dim '
                }
              `}
            >
              {localize(
                'skills.library.count',
                {
                  count: total,
                },
              )}
            </div>

            {isDeletedView && (
              <div
                className={`
                  mt-[10px]
                  rounded-[10px]
                  px-[12px]
                  py-[9px]
                  text-[10px]
                  leading-[17px]
                  ${
                    'bg-amber-500/[0.09] text-amber-700/75 dark:bg-amber-500/[0.08] dark:text-amber-200/70'
                  }
                `}
              >
                {localize(
                  'skills.library.retentionWarning',
                )}
              </div>
            )}

            {actionError && (
              <div
                className="
                  mt-[8px]
                  text-[10px]
                  text-red-400
                "
              >
                {actionError}
              </div>
            )}

            {loading ? (
              <div
                className={`
                  mt-[16px]
                  flex
                  h-[30px]
                  items-center
                  justify-center
                  rounded-[10px]
                  py-20
                  text-[12px]
                  ${
                    'border-[#000000]/[0.09] text-theme-faint dark:border-[#ffffff]/[0.08] '
                  }
                `}
              >
                {localize(
                  'skills.library.loading',
                )}
              </div>
            ) : error ? (
              <div
                className="
                  mt-[16px]
                  rounded-[20px]
                  text-[12px]
                  text-red-400
                "
              >
                {error}
              </div>
            ) : items.length >
              0 ? (
              <div
                className="
                  mt-[16px]
                  grid
                  w-full
                  min-w-[392px]
                  items-start
                  gap-[16px]
                "
                style={{
                  gridTemplateColumns:
                    'repeat(3, minmax(120px, 1fr))',
                }}
              >
                {items.map(
                  (skill) => (
                    <SkillCard
                      key={
                        skill.id
                      }
                      skill={skill}
                      view={scope}
                      actionBusy={
                        actionSkillId ===
                        skill.id
                      }
                      permanentDeleteBusy={
                        actionSkillId ===
                        skill.id
                      }
                      onClick={() =>
                        setSelected(
                          skill.id,
                        )
                      }
                      onAction={
                        scope ===
                        'mine'
                          ? undefined
                          : () => {
                              void handleCardAction(
                                skill,
                              );
                            }
                      }
                      onPermanentDelete={
                        scope ===
                        'deleted'
                          ? () => {
                              void handlePermanentDelete(
                                skill,
                              );
                            }
                          : undefined
                      }
                    />
                  ),
                )}
              </div>
            ) : (
              <div
                className={`
                  mt-[16px]
                  flex
                  h-[30px]
                  items-center
                  justify-center
                  rounded-[10px]
                  py-20
                  text-[12px]
                  ${
                    'border-edge-alpha-07 text-theme-faint  '
                  }
                `}
              >
                {isDeletedView
                  ? localize(
                      'skills.library.emptyDeleted',
                    )
                  : localize(
                      'skills.library.empty',
                    )}
              </div>
            )}
          </div>
        </section>
      )}

      {creating && (
        <SkillCreateModal
          onClose={() =>
            setCreating(false)
          }
          onSaved={handleCreateSaved}
        />
      )}

      {editing !== undefined &&
        !isDeletedView && (
          <SkillEditor
            skillId={editing}
            onClose={() =>
              setEditing(
                undefined,
              )
            }
            onSaved={
              handleEditorSaved
            }
          />
        )}
    </>
  );
}