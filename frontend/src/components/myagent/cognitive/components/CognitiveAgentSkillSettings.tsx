                                                                                       

import AgentSkillBindingEditor from '../../skill/picker/AgentSkillBindingEditor';
import { useLocalize } from '../../../../localization/useLocalize';
import type {
  AgentSkillBindingInput,
  EffectiveAgentSkillActivationMode,
  SkillSummary,
} from '../../skill/types/skill.types';

interface CognitiveAgentSkillSettingsProps {

  inputClass: string;
  bindings: AgentSkillBindingInput[];
  onBindingsChange: (
    bindings: AgentSkillBindingInput[],
  ) => void;
  defaultMode: EffectiveAgentSkillActivationMode;
  onDefaultModeChange: (
    mode: EffectiveAgentSkillActivationMode,
  ) => void;
  skills: SkillSummary[];
  skillError: string;
  pickerOpen: boolean;
  onOpenPicker: () => void;
}

export default function CognitiveAgentSkillSettings({
    inputClass,
  bindings,
  onBindingsChange,
  defaultMode,
  onDefaultModeChange,
  skills,
  skillError,
  pickerOpen,
  onOpenPicker,
}: CognitiveAgentSkillSettingsProps) {
  const localize = useLocalize();
  const defaultModes: EffectiveAgentSkillActivationMode[] = [
    'AUTOMATIC',
    'MANUAL',
    'ALWAYS',
  ];

  return (
    <>
      <section
        className={`
          rounded-[10px]
          border
          p-[10px]
          ${
            'border-edge-default bg-[#f9f9f9]  dark:bg-[#171717]'
          }
        `}
      >
        <div
          className="
            mb-[8px]
            text-[10px]
            font-medium
          "
        >
          {localize('skills.settings.title')}
        </div>

        <label
          className="
            block
            text-[9px]
          "
        >
          {localize('skills.settings.defaultMode')}

          <select
            value={defaultMode}
            onChange={(event) =>
              onDefaultModeChange(
                event.target
                  .value as EffectiveAgentSkillActivationMode,
              )
            }
            className={`${inputClass} mt-[4px]`}
          >
            {defaultModes.map(
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
            {localize('skills.settings.defaultHint')}
          </span>
        </label>
      </section>

      <section className="min-w-0">
        <div
          className="
            mb-[4px]
            flex
            items-center
            justify-between
          "
        >
          <div className="text-[10px] font-medium">
            {localize('skills.settings.linked')}
          </div>

          <button
            type="button"
            onClick={onOpenPicker}
            className={`
              select-none
              rounded-[7px]
              border-0
              px-[9px]
              py-[5px]
              text-[9px]
              outline-none
              transition-colors
              ${
                'bg-surface-neutral-strong text-theme-primary hover:bg-surface-control-hover   '
              }
            `}
          >
            {localize('skills.settings.add')}
          </button>
        </div>

        {bindings.length > 0 && (
          <AgentSkillBindingEditor
            value={bindings}
            skills={skills}
            defaultMode={defaultMode}
            onChange={onBindingsChange}

          />
        )}

        {skillError && !pickerOpen && (
          <div className="mt-[5px] text-[9px] text-red-400">
            {skillError}
          </div>
        )}
      </section>
    </>
  );
}
