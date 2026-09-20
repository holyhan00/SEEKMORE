                                                                                 

import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocalize } from '../../../../localization/useLocalize';
import { localizeApiError } from '../../../../localization/localizeApiError';

import { createCognitiveAgent } from '../api/cognitive-agent.api';
import type { CognitiveAgentKnowledgeFileSpec } from '../api/cognitive-agent.types';
import CognitiveAgentImageUpload from '../components/CognitiveAgentImageUpload';
import CognitiveAgentKnowledgeUpload from '../components/CognitiveAgentKnowledgeUpload';
import CognitiveAgentSkillSettings from '../components/CognitiveAgentSkillSettings';

import {
  listSkills,
  replaceAgentSkillBindings,
} from '../../skill/api/skill.api';
import AgentSkillPickerDrawer from '../../skill/picker/AgentSkillPickerDrawer';
import { sortAgentSkillBindings } from '../../skill/picker/agent-skill-binding.utils';
import type {
  AgentSkillBindingInput,
  EffectiveAgentSkillActivationMode,
  SkillSummary,
} from '../../skill/types/skill.types';

interface CognitiveAgentCreateModalProps {
  open: boolean;

  onClose: () => void;
  onCreated?: () => void;
}

const TRANSITION_MS = 200;

export default function CognitiveAgentCreateModal({
  open,
    onClose,
  onCreated,
}: CognitiveAgentCreateModalProps) {
  const localize = useLocalize();
  const portalContainer = useMemo(
    () =>
      document.getElementById('shell-portal') ??
      document.body,
    [],
  );

  const [renderModal, setRenderModal] =
    useState(false);

  const [showModal, setShowModal] =
    useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] =
    useState('');
  const [rolePrompt, setRolePrompt] =
    useState('');

  const [avatarFile, setAvatarFile] =
    useState<File | null>(null);

  const [coverFile, setCoverFile] =
    useState<File | null>(null);

  const [knowledgeFiles, setKnowledgeFiles] =
    useState<File[]>([]);

  const [
    knowledgeFileSpecs,
    setKnowledgeFileSpecs,
  ] = useState<CognitiveAgentKnowledgeFileSpec[]>([]);

  const [bindings, setBindings] =
    useState<AgentSkillBindingInput[]>([]);

  const [defaultMode, setDefaultMode] =
    useState<EffectiveAgentSkillActivationMode>('AUTOMATIC');

  const [skillPickerOpen, setSkillPickerOpen] =
    useState(false);

  const [skills, setSkills] = useState<
    SkillSummary[]
  >([]);

  const [skillLoading, setSkillLoading] =
    useState(false);

  const [skillError, setSkillError] =
    useState('');

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] = useState('');

  const canSubmit = useMemo(
    () =>
      Boolean(
        name.trim() &&
          rolePrompt.trim() &&
          !submitting,
      ),
    [name, rolePrompt, submitting],
  );

  useEffect(() => {
    if (open) {
      setSkillPickerOpen(false);
      setRenderModal(true);

      const frame = requestAnimationFrame(() => {
        setShowModal(true);
      });

      return () => {
        cancelAnimationFrame(frame);
      };
    }

    setSkillPickerOpen(false);
    setShowModal(false);

    const timer = window.setTimeout(() => {
      setRenderModal(false);
    }, TRANSITION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;

    setSkillLoading(true);
    setSkillError('');

    listSkills({
      scope: 'mine',
      status: 'ACTIVE',
      limit: 100,
      sort: 'created_desc',
    })
      .then((response) => {
        if (active) {
          setSkills(response.items);
        }
      })
      .catch((reason) => {
        if (!active) {
          return;
        }

        setSkillError(
          reason instanceof Error
            ? reason.message
            : localizeApiError(reason, 'agents.skills.loadFailed'),
        );
      })
      .finally(() => {
        if (active) {
          setSkillLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!renderModal) {
      return;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, [renderModal]);

  useEffect(() => {
    if (!renderModal) {
      return;
    }

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (event.key !== 'Escape') {
        return;
      }

      if (skillPickerOpen) {
        setSkillPickerOpen(false);
        return;
      }

      if (!submitting) {
        onClose();
      }
    };

    document.addEventListener(
      'keydown',
      handleKeyDown,
    );

    return () => {
      document.removeEventListener(
        'keydown',
        handleKeyDown,
      );
    };
  }, [
    renderModal,
    skillPickerOpen,
    submitting,
    onClose,
  ]);

  const inputClass = `
    box-border
    w-full
    rounded-[9px]
    border
    px-[9px]
    py-[7px]
    text-[11px]
    outline-none
    transition-colors
    ${
      'border-edge-soft bg-surface-soft text-theme-primary   '
    }
  `;

  const submit = async () => {
    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const agent = await createCognitiveAgent({
        name: name.trim(),
        description: description.trim(),
        rolePrompt: rolePrompt.trim(),
        avatarFile,
        coverFile,
        capabilities: [
          'chat',
          'file_reading',
          'file_render',
          'docx_generation',
          'xlsx_generation',
        ],
        knowledgeFiles,
        knowledgeFileSpecs,
      });

      await replaceAgentSkillBindings({
        agentId: agent.id,
        expectedRevision: 0,
        defaultActivationMode: defaultMode,
        bindings: sortAgentSkillBindings(bindings),
      });

      onCreated?.();
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : localizeApiError(reason, 'agents.create.failed'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!renderModal) {
    return null;
  }

  const modalNode = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        pointerEvents: 'none',
        opacity: showModal ? 1 : 0,
        transition: `opacity ${TRANSITION_MS}ms ease`,
      }}
    >
      {         }
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'auto',
          background:
            'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(3px)',
          WebkitBackdropFilter:
            'blur(3px)',
        }}
        onMouseDown={() => {
          if (!submitting) {
            onClose();
          }
        }}
      />

      {           }
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          padding: 12,
        }}
      >
        {                                         }
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-cognitive-agent-title"
          className={`
            pointer-events-auto
            relative
            flex
            max-w-[94vw]
            flex-col
            overflow-hidden
            rounded-[12px]
            border
            ${
              'border-edge-default bg-surface-raised text-theme-primary   '
            }
          `}
          style={{
            width: skillPickerOpen
              ? '1010px'
              : '650px',
            height: 'calc(76vh + 40px)',
            maxHeight:
              'calc(100vh - 24px)',
            transform: showModal
              ? 'scale(1)'
              : 'scale(0.96)',
            opacity: showModal ? 1 : 0.96,
            transition: [
              `transform ${TRANSITION_MS}ms ease`,
              `opacity ${TRANSITION_MS}ms ease`,
              `width ${TRANSITION_MS}ms ease`,
            ].join(', '),
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
        >
          <header
            className="
              flex
              shrink-0
              items-center
              justify-between
              border-b
              border-inherit
              px-[14px]
              py-[10px]
            "
          >
            <div className="select-none">
              <div
                id="create-cognitive-agent-title"
                className="
                  select-none
                  text-[15px]
                  font-semibold
                "
              >
                {localize('agents.create.title')}
              </div>

              <div
                className="
                  mt-[3px]
                  select-none
                  text-[9px]
                  opacity-60
                "
              >
                {localize('agents.create.description')}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
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
          </header>

          <div
            className="
              grid
              min-h-0
              flex-1
              overflow-hidden
            "
            style={{
              gridTemplateColumns:
                skillPickerOpen
                  ? 'minmax(0, 650px) minmax(0, 360px)'
                  : 'minmax(0, 650px) 0px',
              transition: `grid-template-columns ${TRANSITION_MS}ms ease`,
            }}
          >
            <div
              className={`
                grid
                min-h-0
                min-w-0
                grid-cols-2
                gap-[11px]
                overflow-hidden
                p-[12px]
                ${
                  'bg-surface-raised '
                }
              `}
            >
            <div
              className="
                min-h-0
                min-w-0
                space-y-[9px]
                overflow-y-auto
                overscroll-contain
                pr-[3px]
                [scrollbar-width:none]
                [-ms-overflow-style:none]
                [&::-webkit-scrollbar]:h-0
                [&::-webkit-scrollbar]:w-0
                [&::-webkit-scrollbar]:bg-transparent
              "
            >
              <label
                className="
                  block
                  text-[10px]
                  font-medium
                "
              >
                {localize('agents.create.name')}
                <input
                  className={`${inputClass} mt-[4px]`}
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                  placeholder={localize('agents.create.namePlaceholder')}
                />
              </label>

              <label
                className="
                  block
                  text-[10px]
                  font-medium
                "
              >
                {localize('common.description')}
                <textarea
                  rows={2}
                  className={`
                    ${inputClass}
                    mt-[4px]
                    resize-none
                  `}
                  value={description}
                  onChange={(event) =>
                    setDescription(
                      event.target.value,
                    )
                  }
                  placeholder={localize('agents.create.descriptionPlaceholder')}
                />
              </label>

              <label
                className="
                  block
                  text-[10px]
                  font-medium
                "
              >
                {localize('agents.create.role')}
                <textarea
                  rows={5}
                  className={`
                    ${inputClass}
                    mt-[4px]
                    resize-none
                  `}
                  value={rolePrompt}
                  onChange={(event) =>
                    setRolePrompt(
                      event.target.value,
                    )
                  }
                  placeholder={localize('agents.create.rolePlaceholder')}
                />
              </label>

              <CognitiveAgentImageUpload
                avatarFile={avatarFile}
                coverFile={coverFile}
                avatarFallbackText={name}
                onAvatarChange={setAvatarFile}
                onCoverChange={setCoverFile}

              />

              <section className="min-w-0">
                <div
                  className="
                    mb-[4px]
                    text-[10px]
                    font-medium
                  "
                >
                  {localize('agents.knowledge.contentLibrary')}                </div>

                <CognitiveAgentKnowledgeUpload
                  files={knowledgeFiles}
                  specs={knowledgeFileSpecs}
                  onChange={setKnowledgeFiles}
                  onSpecsChange={
                    setKnowledgeFileSpecs
                  }

                />
              </section>
            </div>


            <div
              className="
                min-h-0
                min-w-0
                space-y-[9px]
                overflow-y-auto
                pr-[3px]
              "
            >
              <CognitiveAgentSkillSettings

                inputClass={inputClass}
                bindings={bindings}
                onBindingsChange={
                  setBindings
                }
                defaultMode={defaultMode}
                onDefaultModeChange={
                  setDefaultMode
                }
                skills={skills}
                skillError={skillError}
                pickerOpen={skillPickerOpen}
                onOpenPicker={() =>
                  setSkillPickerOpen(true)
                }
              />
            </div>
            </div>

            <AgentSkillPickerDrawer
              open={skillPickerOpen}
              skills={skills}
              bindings={bindings}
              onChange={setBindings}
              onClose={() =>
                setSkillPickerOpen(false)
              }

              loading={skillLoading}
              error={skillError}
            />
          </div>

          {error && (
            <div
              className="
                shrink-0
                px-[12px]
                pb-[6px]
                text-[9px]
                text-red-400
              "
            >
              {error}
            </div>
          )}

          <footer
            className={`
              flex
              shrink-0
              justify-end
              gap-[7px]
              border-t
              border-inherit
              px-[12px]
              py-[8px]
              ${
                'bg-surface-raised '
              }
            `}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className={`
                select-none
                rounded-[7px]
                border-0
                px-[10px]
                py-[6px]
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
              {localize('common.actions.cancel')}
            </button>

            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="
                flex
                select-none
                items-center
                justify-center
                rounded-[7px]
                border-0
                bg-action-primary
                px-[12px]
                py-[6px]
                text-[10px]
                !text-[#ffffff]
                outline-none
                transition-opacity
                hover:!text-[#ffffff]
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            >
              {submitting
                ? localize('agents.create.creating')
                : localize('agents.create.create')}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );

  return createPortal(
    modalNode,
    portalContainer,
  );
}

