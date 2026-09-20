                                                                               

import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocalize } from '../../../../localization/useLocalize';
import { localizeApiError } from '../../../../localization/localizeApiError';

import { resolveAssetUrl } from '../../../../utils/asset-url';

import {
  getCognitiveAgent,
  updateCognitiveAgent,
} from '../api/cognitive-agent.api';
import type { CognitiveAgentKnowledgeFileSpec } from '../api/cognitive-agent.types';
import CognitiveAgentImageUpload from '../components/CognitiveAgentImageUpload';
import CognitiveAgentKnowledgeStatus from '../components/CognitiveAgentKnowledgeStatus';
import CognitiveAgentKnowledgeUpload from '../components/CognitiveAgentKnowledgeUpload';
import { useCognitiveAgentKnowledge } from '../hooks/useCognitiveAgentKnowledge';
import CognitiveAgentSkillSettings from '../components/CognitiveAgentSkillSettings';

import {
  getAgentSkillBindings,
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

interface CognitiveAgentEditModalProps {
  open: boolean;
  agentId: string | null;

  onClose: () => void;
  onUpdated?: () => void;
}

const TRANSITION_MS = 200;

function sortSkillsByCreatedAt(
  skills: SkillSummary[],
): SkillSummary[] {
  return [...skills].sort((left, right) => {
    const leftTime = new Date(
      left.createdAt,
    ).getTime();

    const rightTime = new Date(
      right.createdAt,
    ).getTime();

    const normalizedLeftTime =
      Number.isNaN(leftTime)
        ? 0
        : leftTime;

    const normalizedRightTime =
      Number.isNaN(rightTime)
        ? 0
        : rightTime;

    return (
      normalizedRightTime -
        normalizedLeftTime ||
      right.id.localeCompare(left.id)
    );
  });
}

export default function CognitiveAgentEditModal({
  open,
  agentId,
    onClose,
  onUpdated,
}: CognitiveAgentEditModalProps) {
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

  const [existingAvatarUrl, setExistingAvatarUrl] =
    useState('');

  const [existingCoverUrl, setExistingCoverUrl] =
    useState('');

  const [knowledgeFiles, setKnowledgeFiles] =
    useState<File[]>([]);

  const [
    knowledgeFileSpecs,
    setKnowledgeFileSpecs,
  ] = useState<CognitiveAgentKnowledgeFileSpec[]>([]);

  const [bindings, setBindings] =
    useState<AgentSkillBindingInput[]>([]);

  const [policyRevision, setPolicyRevision] =
    useState(0);

  const [defaultMode, setDefaultMode] =
    useState<EffectiveAgentSkillActivationMode>('AUTOMATIC');

  const [skillPickerOpen, setSkillPickerOpen] =
    useState(false);

  const [skills, setSkills] = useState<
    SkillSummary[]
  >([]);

  const [boundSkills, setBoundSkills] =
    useState<SkillSummary[]>([]);

  const [skillLoading, setSkillLoading] =
    useState(false);

  const [skillError, setSkillError] =
    useState('');

  const [loading, setLoading] =
    useState(false);

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] = useState('');

  const {
    files: existingKnowledgeFiles,
    loading: knowledgeLoading,
    reparsing: knowledgeReparsing,
    hasProcessing: knowledgeHasProcessing,
    error: knowledgeError,
    reparseAll: reparseKnowledge,
  } = useCognitiveAgentKnowledge({
    agentId,
    enabled: open,
  });

  const availableSkills = useMemo(() => {
    const merged = new Map<
      string,
      SkillSummary
    >();

    for (const skill of skills) {
      merged.set(skill.id, skill);
    }

    for (const skill of boundSkills) {
      merged.set(skill.id, skill);
    }

    return sortSkillsByCreatedAt(
      Array.from(merged.values()),
    );
  }, [skills, boundSkills]);

  const canSubmit = useMemo(
    () =>
      Boolean(
        agentId &&
          name.trim() &&
          rolePrompt.trim() &&
          !loading &&
          !submitting,
      ),
    [
      agentId,
      name,
      rolePrompt,
      loading,
      submitting,
    ],
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
    if (!open || !agentId) {
      return;
    }

    let active = true;

    setLoading(true);
    setError('');

    setAvatarFile(null);
    setCoverFile(null);
    setExistingAvatarUrl('');
    setExistingCoverUrl('');
    setKnowledgeFiles([]);
    setKnowledgeFileSpecs([]);
    setBindings([]);
    setBoundSkills([]);

    Promise.all([
      getCognitiveAgent(agentId),
      getAgentSkillBindings(agentId),
    ])
      .then(([agent, result]) => {
        if (!active) {
          return;
        }

        setName(agent.name || '');
        setDescription(
          agent.description || '',
        );
        setRolePrompt(
          agent.rolePrompt || '',
        );
        setExistingAvatarUrl(
          resolveAssetUrl(
            agent.avatarUrl
            ?? agent.avatarKey,
            {
              version:
                agent.avatarUpdatedAt,
            },
          ),
        );
        setExistingCoverUrl(
          resolveAssetUrl(
            agent.coverUrl
            ?? agent.coverKey,
            {
              version:
                agent.coverUpdatedAt,
            },
          ),
        );

        setPolicyRevision(
          result.policy?.revision ?? 0,
        );

        setDefaultMode(
          result.policy
            ?.defaultActivationMode ??
            'AUTOMATIC',
        );

        setBindings(
          sortAgentSkillBindings(
            result.bindings.map((item) => ({
              skillId: item.skillId,
              activationMode:
                item.activationMode,
              priority: item.priority,
              enabled: item.enabled,
              versionPolicy:
                item.versionPolicy,
              versionConstraint:
                item.versionConstraint,
              pinnedVersionId:
                item.pinnedVersionId,
              config: item.config ?? {},
              permissionOverrides:
                item.permissionOverrides ?? {},
            })),
          ),
        );

        setBoundSkills(
          result.bindings
            .map((item) => item.skill)
            .filter(
              (
                skill,
              ): skill is SkillSummary =>
                Boolean(skill),
            ),
        );
      })
      .catch((reason) => {
        if (!active) {
          return;
        }

        setError(
          reason instanceof Error
            ? reason.message
            : localizeApiError(reason, 'agents.edit.loadFailed'),
        );
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open, agentId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePermanentSkillDelete = (
      event: Event,
    ) => {
      const skillId = String(
        (event as CustomEvent<{ skillId?: string }>).detail?.skillId ?? '',
      ).trim();

      if (!skillId) {
        return;
      }

      setBindings((current) =>
        current.filter(
          (binding) => binding.skillId !== skillId,
        ),
      );
      setBoundSkills((current) =>
        current.filter((skill) => skill.id !== skillId),
      );
      setSkills((current) =>
        current.filter((skill) => skill.id !== skillId),
      );
    };

    window.addEventListener(
      'skill:permanently-deleted',
      handlePermanentSkillDelete,
    );

    return () => {
      window.removeEventListener(
        'skill:permanently-deleted',
        handlePermanentSkillDelete,
      );
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
    disabled:cursor-not-allowed
    disabled:opacity-50
    ${
      'border-edge-soft bg-surface-soft text-theme-primary   '
    }
  `;

  const submit = async () => {
    if (!canSubmit || !agentId) {
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await updateCognitiveAgent(agentId, {
        name: name.trim(),
        description: description.trim(),
        rolePrompt: rolePrompt.trim(),
        avatarFile,
        coverFile,
        knowledgeFiles,
        knowledgeFileSpecs,
        capabilities: [
          'chat',
          'file_reading',
          'file_render',
          'docx_generation',
          'xlsx_generation',
        ],
      });

      const result =
        await replaceAgentSkillBindings({
          agentId,
          expectedRevision:
            policyRevision,
          defaultActivationMode:
            defaultMode,
          bindings: sortAgentSkillBindings(bindings),
        });

      setPolicyRevision(
        result.policy?.revision ??
          policyRevision + 1,
      );

      onUpdated?.();
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : localizeApiError(reason, 'agents.edit.saveFailed'),
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
        {                                       }
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-cognitive-agent-title"
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
                id="edit-cognitive-agent-title"
                className="
                  select-none
                  text-[15px]
                  font-semibold
                "
              >
                {localize('agents.edit.title')}
              </div>

              <div
                className="
                  mt-[3px]
                  select-none
                  text-[9px]
                  opacity-60
                "
              >
                {localize('agents.edit.description')}
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
                ${
                  loading
                    ? 'pointer-events-none opacity-50'
                    : ''
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
                  {localize('common.name')}

                  <input
                    disabled={loading}
                    className={`${inputClass} mt-[4px]`}
                    value={name}
                    onChange={(event) =>
                      setName(event.target.value)
                    }
                    placeholder={localize('agents.edit.namePlaceholder')}
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
                    disabled={loading}
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
                    placeholder={localize('agents.edit.descriptionPlaceholder')}
                  />
                </label>

                <label
                  className="
                    block
                    text-[10px]
                    font-medium
                  "
                >
                  {localize('agents.role.title')}

                  <textarea
                    rows={5}
                    disabled={loading}
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
                    placeholder={localize('agents.role.placeholder')}
                  />
                </label>

                <CognitiveAgentImageUpload
                  avatarFile={avatarFile}
                  coverFile={coverFile}
                  avatarFallbackText={name}
                  existingAvatarUrl={existingAvatarUrl}
                  existingCoverUrl={existingCoverUrl}
                  onAvatarChange={setAvatarFile}
                  onCoverChange={setCoverFile}

                />

                <section className="min-w-0">
                  <div className="mb-[6px] flex items-center justify-between gap-[8px]">
                    <div className="text-[10px] font-medium">
                      {localize('agents.knowledge.contentLibrary')}
                    </div>

                    {existingKnowledgeFiles.length > 0 && (
                      <button
                        type="button"
                        disabled={
                          knowledgeReparsing ||
                          knowledgeHasProcessing
                        }
                        onClick={() => {
                          void reparseKnowledge();
                        }}
                        className={[
                          'shrink-0 rounded-[6px] px-[6px] py-[3px] text-[9px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                          'text-[#777777] hover:bg-surface-hover-strong hover:text-[#333333] dark:text-[#9f9f9f]  dark:hover:text-[#ffffff]',
                        ].join(' ')}
                      >
                        {knowledgeReparsing ||
                        knowledgeHasProcessing
                          ? localize('agents.knowledge.parsing')
                          : localize('agents.knowledge.reparseAll')}
                      </button>
                    )}
                  </div>

                  <div className="mb-[9px]">
                    <div
                      className={[
                        'mb-[5px] flex items-center justify-between text-[9px]',
                        'text-[#999999] dark:text-[#777777]',
                      ].join(' ')}
                    >
                      <span>{localize('agents.knowledge.existingFiles')}</span>
                      <span>{localize('agents.knowledge.fileCount', { count: existingKnowledgeFiles.length })}</span>
                    </div>

                    {knowledgeLoading ? (
                      <div
                        className={[
                          'rounded-[10px] px-[10px] py-[9px] text-[9px]',
                          'bg-[#f3f4f6] text-[#999999] dark:bg-[#151515] dark:text-[#777777]',
                        ].join(' ')}
                      >
                        {localize('agents.knowledge.loadingExisting')}
                      </div>
                    ) : (
                      <CognitiveAgentKnowledgeStatus
                        files={existingKnowledgeFiles}

                      />
                    )}

                    {knowledgeError && (
                      <div className="mt-[5px] text-[9px] text-red-400">
                        {knowledgeError}
                      </div>
                    )}
                  </div>

                  <div
                    className={[
                      'mb-[5px] text-[9px]',
                      'text-[#999999] dark:text-[#777777]',
                    ].join(' ')}
                  >
                    {localize('agents.knowledge.newFiles')}
                  </div>

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
                  skills={availableSkills}
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
              skills={availableSkills}
              bindings={bindings}
              onChange={setBindings}
              onClose={() =>
                setSkillPickerOpen(false)
              }

              loading={skillLoading}
              error={skillError}
              disabled={loading}
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
                text-[#ffffff]
                outline-none
                transition-opacity
                hover:text-[#ffffff]
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            >
              {submitting
                ? localize('common.saving')
                : loading
                  ? localize('common.loading')
                  : localize('common.actions.save')}
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