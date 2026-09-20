import { useState } from 'react';

import type {
  AgentSkillActivationMode,
  AgentSkillBindingInput,
  EffectiveAgentSkillActivationMode,
  SkillSummary,
} from '../types/skill.types';
import { useLocalize } from '../../../../localization/useLocalize';
import { getSkillDisplayName } from '../shared/skill-display-name';
import {
  AGENT_SKILL_PRIORITY_MAX,
  AGENT_SKILL_PRIORITY_MIN,
  sortAgentSkillBindings,
} from './agent-skill-binding.utils';


const AGENT_SKILL_ACTIVATION_MODES: AgentSkillActivationMode[] = [
  'INHERIT',
  'AUTOMATIC',
  'MANUAL',
  'ALWAYS',
];

interface AgentSkillBindingEditorProps {
  value: AgentSkillBindingInput[];
  skills?: SkillSummary[];
  defaultMode: EffectiveAgentSkillActivationMode;
  onChange: (
    next: AgentSkillBindingInput[],
  ) => void;

  disabled?: boolean;
}

export default function AgentSkillBindingEditor({
  value,
  skills = [],
  defaultMode,
  onChange,
    disabled = false,
}: AgentSkillBindingEditorProps) {
  const localize = useLocalize();

  const [notice, setNotice] =
    useState('');

  const skillMap = new Map(
    skills.map((skill) => [skill.id, skill]),
  );

  const patch = (
    skillId: string,
    data: Partial<AgentSkillBindingInput>,
    reorder = false,
  ) => {
    const next = value.map((item) =>
      item.skillId === skillId
        ? {
            ...item,
            ...data,
          }
        : item,
    );

    onChange(
      reorder
        ? sortAgentSkillBindings(next)
        : next,
    );
  };

  const remove = (skillId: string) => {
    setNotice('');
    onChange(
      value.filter(
        (item) => item.skillId !== skillId,
      ),
    );
  };

  if (value.length === 0) {
    return null;
  }

  return (
    <section
      className={`
        min-w-0
        rounded-[14px]
        border
        p-[12px]
        ${
          'border-edge-strong bg-[#fafafa]  dark:bg-[#171717]'
        }
      `}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] opacity-50">
          {localize('skills.binding.summary')}
        </div>

        <span className="ml-[8px] shrink-0 text-[10px] opacity-50">
          {localize('skills.binding.count', { count: value.length })}
        </span>
      </div>

      {notice && (
        <div className="mt-[8px] rounded-[8px] border border-[#ef4444]/25 bg-[#ef4444]/5 px-[8px] py-[7px] text-[9px] text-status-danger">
          {notice}
        </div>
      )}

      <div
        className="
          mt-[10px]
          space-y-[8px]
        "
      >
        {value.map((binding) => {
          const skill = skillMap.get(
            binding.skillId,
          );
          const deleted = Boolean(
            skill?.deletedAt,
          );
          const displayName = skill
            ? getSkillDisplayName(skill)
            : localize('skills.binding.fallbackName');
          const controlsDisabled =
            disabled || deleted;

          const inheritText =
            binding.activationMode === 'INHERIT'
              ? localize('skills.agentActivation.current', {
                  mode: localize(`skills.agentActivation.${defaultMode}`),
                })
              : localize(
                  `skills.agentActivationDescription.${binding.activationMode}`,
                );

          return (
            <div
              key={binding.skillId}
              className={`
                rounded-[12px]
                border
                p-[12px]
                transition-opacity
                ${
                  deleted
                    ? 'border-[#dddddd] bg-[#f4f4f4] opacity-65 dark:border-[#383838] dark:bg-[#1b1b1b] dark:opacity-60'
                    : binding.enabled
                      ? 'border-[#0c5cfb] opacity-100'
                      : 'border-[#0c5cfb] opacity-55'
                }
                ${
                  deleted
                    ? ''
                    : 'bg-surface-panel '
                }
              `}
            >
              <div className="flex min-w-0 items-start justify-between gap-[8px]">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-[7px]">
                    <div
                      className="min-w-0 flex-1 truncate text-[11px] font-medium"
                      title={displayName}
                    >
                      {displayName}
                    </div>

                    {deleted && (
                      <span className="shrink-0 rounded-[5px] bg-status-danger-soft px-[5px] py-[2px] text-[8px] text-status-danger">
                        {localize('skills.binding.deleted')}
                      </span>
                    )}
                  </div>

                  <div
                    className="mt-[4px] line-clamp-2 text-[9px] leading-[16px] opacity-55"
                    title={
                      skill?.description ||
                      localize('skills.binding.unavailable')
                    }
                  >
                    {skill?.description ||
                      localize('skills.binding.unavailable')}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    remove(binding.skillId)
                  }
                  className={`
                    shrink-0
                    select-none
                    rounded-[7px]
                    border-0
                    px-[8px]
                    py-[5px]
                    text-[9px]
                    outline-none
                    transition-colors
                    disabled:cursor-not-allowed
                    disabled:opacity-50
                    ${
                      'bg-[#eeeeee] text-[#777777] hover:bg-[#e4e4e4] hover:text-[#000000] dark:bg-[#2b2b2b] dark:text-[#b5b5b5] dark:hover:bg-[#333333] dark:hover:text-[#ffffff]'
                    }
                  `}
                >
                  {localize('skills.binding.unlink')}
                </button>
              </div>

              <div
                className="
                  mt-[12px]
                  grid
                  w-full
                  min-w-0
                  grid-cols-2
                  gap-[8px]
                "
              >
                <label className="min-w-0 text-[9px]">
                  {localize('skills.binding.usageMode')}

                  <select
                    disabled={controlsDisabled}
                    value={binding.activationMode}
                    onChange={(event) =>
                      patch(binding.skillId, {
                        activationMode:
                          event.target
                            .value as AgentSkillActivationMode,
                      })
                    }
                    className={`
                      mt-[4px]
                      block
                      box-border
                      w-full
                      max-w-full
                      min-w-0
                      rounded-[8px]
                      border-0
                      px-[8px]
                      py-[8px]
                      text-[10px]
                      outline-none
                      disabled:cursor-not-allowed
                      disabled:opacity-50
                      ${
                        'bg-[#f5f5f5] text-theme-primary dark:bg-[#151515] '
                      }
                    `}
                  >
                    {AGENT_SKILL_ACTIVATION_MODES.map(
                      (mode) => (
                        <option
                          key={mode}
                          value={mode}
                        >
                          {localize(`skills.agentActivation.${mode}`)}
                        </option>
                      ),
                    )}
                  </select>

                  <span className="mt-[4px] block leading-[14px] opacity-45">
                    {deleted
                      ? localize('skills.binding.deletedPreserved')
                      : inheritText}
                  </span>
                </label>

                <label className="min-w-0 text-[9px]">
                  {localize('skills.binding.priority')}

                  <input
                    disabled={controlsDisabled}
                    type="number"
                    step={1}
                    min={AGENT_SKILL_PRIORITY_MIN}
                    max={AGENT_SKILL_PRIORITY_MAX}
                    value={binding.priority}
                    onChange={(event) => {
                      const priority = Number(
                        event.target.value,
                      );

                      if (
                        Number.isInteger(priority) &&
                        priority >=
                          AGENT_SKILL_PRIORITY_MIN &&
                        priority <=
                          AGENT_SKILL_PRIORITY_MAX
                      ) {
                        patch(binding.skillId, {
                          priority,
                        });
                      }
                    }}
                    onBlur={() =>
                      onChange(
                        sortAgentSkillBindings(
                          value,
                        ),
                      )
                    }
                    className={`
                      mt-[4px]
                      block
                      box-border
                      w-full
                      max-w-full
                      min-w-0
                      rounded-[8px]
                      border-0
                      px-[8px]
                      py-[8px]
                      text-[10px]
                      outline-none
                      [appearance:textfield]
                      [&::-webkit-inner-spin-button]:m-0
                      [&::-webkit-inner-spin-button]:appearance-none
                      [&::-webkit-outer-spin-button]:m-0
                      [&::-webkit-outer-spin-button]:appearance-none
                      disabled:cursor-not-allowed
                      disabled:opacity-50
                      ${
                        'bg-[#f5f5f5] text-theme-primary dark:bg-[#151515] '
                      }
                    `}
                  />

                  <span className="mt-[4px] block leading-[14px] opacity-45">
                    {localize('skills.binding.priorityHint')}
                  </span>
                </label>
              </div>

              <label className="mt-[10px] flex select-none items-center gap-[6px] text-[9px]">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={binding.enabled}
                  onChange={(event) => {
                    if (deleted) {
                      setNotice(
                        localize('skills.binding.restoreFirst'),
                      );
                      return;
                    }

                    setNotice('');
                    patch(
                      binding.skillId,
                      {
                        enabled:
                          event.target.checked,
                      },
                      true,
                    );
                  }}
                />

                <span>
                  {deleted
                    ? binding.enabled
                      ? localize('skills.binding.enabledDeleted')
                      : localize('skills.binding.pausedDeleted')
                    : binding.enabled
                      ? localize('skills.binding.enabled')
                      : localize('skills.binding.paused')}
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </section>
  );
}
