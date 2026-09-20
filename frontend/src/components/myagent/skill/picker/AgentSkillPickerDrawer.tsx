                                                                          

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import type {
  AgentSkillBindingInput,
  SkillSummary,
} from '../types/skill.types';
import AgentSkillPickerItem from './AgentSkillPickerItem';
import { getSkillDisplayName } from '../shared/skill-display-name';
import { useLocalize } from '../../../../localization/useLocalize';
import {
  nextAgentSkillPriority,
  sortAgentSkillBindings,
} from './agent-skill-binding.utils';

interface AgentSkillPickerDrawerProps {
  open: boolean;
  skills: SkillSummary[];
  bindings: AgentSkillBindingInput[];
  onChange: (
    next: AgentSkillBindingInput[],
  ) => void;
  onClose: () => void;

  loading?: boolean;
  error?: string;
  disabled?: boolean;
}

const TRANSITION_MS = 200;

function createDefaultBinding(
  skillId: string,
  priority: number,
): AgentSkillBindingInput {
  return {
    skillId,
    activationMode: 'INHERIT',
    priority,
    enabled: true,
    versionPolicy: 'FOLLOW_CURRENT',
    versionConstraint: null,
    pinnedVersionId: null,
    config: {},
    permissionOverrides: {},
  };
}

export default function AgentSkillPickerDrawer({
  open,
  skills,
  bindings,
  onChange,
  onClose,
    loading = false,
  error = '',
  disabled = false,
}: AgentSkillPickerDrawerProps) {
  const localize = useLocalize();
  const [showDrawer, setShowDrawer] =
    useState(false);

  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) {
      setShowDrawer(false);
      return;
    }

    setSearch('');

    const frame = requestAnimationFrame(() => {
      setShowDrawer(true);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open]);

  const selectedIds = useMemo(
    () =>
      new Set(
        bindings.map(
          (binding) => binding.skillId,
        ),
      ),
    [bindings],
  );

  const filteredSkills = useMemo(() => {
    const keyword = search
      .trim()
      .toLowerCase();

    if (!keyword) {
      return skills;
    }

    return skills.filter((skill) =>
      [
        getSkillDisplayName(skill),
        skill.description,
        skill.category ?? '',
        ...(skill.tags ?? []),
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  }, [skills, search]);

  const toggleSkill = (
    skill: SkillSummary,
  ) => {
    if (disabled) {
      return;
    }

    if (selectedIds.has(skill.id)) {
      onChange(
        bindings.filter(
          (binding) =>
            binding.skillId !== skill.id,
        ),
      );

      return;
    }

    if (skill.deletedAt) {
      return;
    }

    onChange(
      sortAgentSkillBindings([
        ...bindings,
        createDefaultBinding(
          skill.id,
          nextAgentSkillPriority(bindings),
        ),
      ]),
    );
  };

  return (
    <div
      className="
        min-h-0
        min-w-0
        overflow-hidden
      "
      aria-hidden={!open}
    >
      <aside
        role="dialog"
        aria-modal="false"
        aria-labelledby="agent-skill-picker-title"
        className={`
          flex
          h-full
          w-[360px]
          max-w-full
          min-w-0
          flex-col
          overflow-hidden
          border-l
          shadow-2xl
          ${
            'border-edge-default bg-surface-raised text-theme-primary   '
          }
        `}
        style={{
          pointerEvents: open
            ? 'auto'
            : 'none',
          transform: showDrawer
            ? 'translateX(0)'
            : 'translateX(100%)',
          opacity: showDrawer ? 1 : 0,
          transition: [
            `transform ${TRANSITION_MS}ms ease`,
            `opacity ${TRANSITION_MS}ms ease`,
          ].join(', '),
        }}
      >
        <header
          className="
            shrink-0
            border-b
            border-inherit
            px-[14px]
            pb-[12px]
            pt-[12px]
          "
        >
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div
                id="agent-skill-picker-title"
                className="
                  select-none
                  text-[15px]
                  font-semibold
                "
              >
                {localize('skills.picker.addTitle')}
              </div>

              <div
                className="
                  mt-[3px]
                  select-none
                  text-[9px]
                  opacity-60
                "
              >
                {localize('skills.picker.description')}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={disabled}
              className={`
                select-none
                rounded-[7px]
                border-0
                px-[8px]
                py-[5px]
                text-[10px]
                outline-none
                transition-colors
                disabled:cursor-not-allowed
                disabled:opacity-40
                ${
                  'hover:bg-surface-hover-strong '
                }
              `}
            >
              {localize('common.actions.close')}
            </button>
          </div>

          <input
            disabled={disabled}
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder={localize('skills.picker.searchPlaceholder')}
            className={`
              mt-[12px]
              box-border
              block
              w-full
              max-w-full
              rounded-[9px]
              border
              px-[10px]
              py-[8px]
              text-[11px]
              outline-none
              transition-colors
              disabled:cursor-not-allowed
              disabled:opacity-50
              ${
                'border-edge-soft bg-surface-soft text-theme-primary placeholder:text-[#999999]    dark:placeholder:text-[#777777]'
              }
            `}
          />
        </header>

        <div
          className="
            min-h-0
            min-w-0
            flex-1
            overflow-x-hidden
            overflow-y-auto
            overscroll-contain
            p-[12px]
            [scrollbar-width:none]
            [-ms-overflow-style:none]
            [&::-webkit-scrollbar]:h-0
            [&::-webkit-scrollbar]:w-0
          "
        >
          {loading && (
            <div className="py-[24px] text-center text-[10px] opacity-50">
              {localize('skills.picker.loading')}
            </div>
          )}

          {!loading && error && (
            <div className="py-[24px] text-center text-[10px] text-red-400">
              {error}
            </div>
          )}

          {!loading &&
            !error &&
            filteredSkills.length === 0 && (
              <div className="py-[24px] text-center text-[10px] opacity-50">
                {localize('skills.picker.empty')}
              </div>
            )}

          {!loading &&
            !error &&
            filteredSkills.length > 0 && (
              <div className="min-w-0 w-full max-w-full space-y-[8px] overflow-hidden">
                {filteredSkills.map(
                  (skill) => (
                    <AgentSkillPickerItem
                      key={skill.id}
                      skill={skill}
                      linked={selectedIds.has(
                        skill.id,
                      )}
                      disabled={disabled}

                      onToggle={() =>
                        toggleSkill(skill)
                      }
                    />
                  ),
                )}
              </div>
            )}
        </div>

        <footer
          className={`
            flex
            shrink-0
            items-center
            justify-between
            border-t
            border-inherit
            px-[14px]
            py-[10px]
            ${
              'bg-surface-raised '
            }
          `}
        >
          <span className="select-none text-[10px] opacity-50">
            {localize('skills.picker.linkedCount', { count: bindings.length })}
          </span>

          <button
            type="button"
            onClick={onClose}
            disabled={disabled}
            className="
              select-none
              rounded-[7px]
              border-0
              bg-action-primary
              px-[12px]
              py-[6px]
              text-[10px]
              text-[#ffffff]
              outline-none
              transition-opacity
              hover:text-[#ffffff]
              disabled:cursor-not-allowed
              disabled:opacity-50
            "
          >
            {localize('common.actions.done')}
          </button>
        </footer>
      </aside>
    </div>
  );
}