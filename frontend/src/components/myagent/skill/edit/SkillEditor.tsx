                                                             

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import {
  createSkill,
  createSkillDraftVersion,
  getSkill,
  updateSkillDraftVersion,
} from '../api/skill.api';

import SkillFileManager from '../files/SkillFileManager';
import { getSkillDisplayName } from '../shared/skill-display-name';
import { isAgentGeneratedSkillSource } from '../shared/skill-source';
import { useLocalize } from '../../../../localization/useLocalize';
import { localizeApiError } from '../../../../localization/localizeApiError';

import type {
  SkillDetail,
  SkillDocumentDiagnostic,
  SkillVersionSummary,
} from '../types/skill.types';

import { requestIssues } from '../create/skill-create.utils';

interface SkillEditorProps {
  skillId?: string | null;

  onClose: () => void;
  onSaved: (
    skillId: string,
  ) => void | Promise<void>;
}

const TRANSITION_MS = 200;

function createEmptyDocument(
  localize: (key: string, values?: Record<string, unknown>) => string,
): string {
  return [
    '---',
    'name: skill-draft',
    `description: ${localize('skills.editor.templateDescription')}`,
    '---',
    '',
    `# ${localize('skills.editor.templateHeading')}`,
    '',
    localize('skills.editor.templateBody'),
    '',
  ].join('\n');
}

function editableVersion(
  skill: SkillDetail,
): SkillVersionSummary | null {
  return (
    skill.versions.find(
      (version) =>
        version.status === 'DRAFT',
    ) ??
    skill.currentVersion ??
    skill.versions[0] ??
    null
  );
}

export default function SkillEditor({
  skillId,
    onClose,
  onSaved,
}: SkillEditorProps) {
  const localize = useLocalize();

  const portalContainer = useMemo(
    () =>
      document.getElementById(
        'shell-portal',
      ) ?? document.body,
    [],
  );

  const closeTimerRef =
    useRef<number | null>(null);

  const filePreparationKeyRef =
    useRef<string | null>(null);

  const [showModal, setShowModal] =
    useState(false);

  const [closing, setClosing] =
    useState(false);

  const [loading, setLoading] =
    useState(Boolean(skillId));

  const [saving, setSaving] =
    useState(false);

  const [preparingFiles, setPreparingFiles] =
    useState(false);

  const [skill, setSkill] =
    useState<SkillDetail | null>(null);

  const [sourceVersion, setSourceVersion] =
    useState<SkillVersionSummary | null>(
      null,
    );

  const [displayName, setDisplayName] =
    useState('');

  const [skillMarkdown, setSkillMarkdown] =
    useState(() => createEmptyDocument(localize));

  const [changeLog, setChangeLog] =
    useState('');

  const [error, setError] =
    useState('');

  const [diagnostics, setDiagnostics] =
    useState<SkillDocumentDiagnostic[]>(
      [],
    );

  useEffect(() => {
    const frame =
      requestAnimationFrame(() => {
        setShowModal(true);
      });

    return () => {
      cancelAnimationFrame(frame);

      if (
        closeTimerRef.current !== null
      ) {
        window.clearTimeout(
          closeTimerRef.current,
        );
      }
    };
  }, []);

  useEffect(() => {
    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      'hidden';

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, []);

  const applySkill = useCallback(
    (
      value: SkillDetail,
      options?: {
        preserveMarkdown?: boolean;
        preferredVersionId?: string;
      },
    ) => {
      const nextVersion =
        value.versions.find(
          (version) =>
            version.id ===
            options?.preferredVersionId,
        ) ?? editableVersion(value);

      setSkill(value);
      setDisplayName(getSkillDisplayName(value));
      setSourceVersion(nextVersion);

      if (!options?.preserveMarkdown) {
        setSkillMarkdown(
          nextVersion?.skillMarkdown ??
            createEmptyDocument(localize),
        );
      }
    },
    [localize],
  );

  const refreshSkill = useCallback(
    async (options?: {
      preserveMarkdown?: boolean;
      preferredVersionId?: string;
    }) => {
      if (!skillId) {
        return null;
      }

      const value = await getSkill(skillId);

      applySkill(value, options);

      return value;
    },
    [
      applySkill,
      skillId,
    ],
  );

  useEffect(() => {
    if (!skillId) {
      setSkill(null);
      setDisplayName('');
      setSourceVersion(null);
      setSkillMarkdown(createEmptyDocument(localize));
      setLoading(false);
      setError('');
      setDiagnostics([]);
      return;
    }

    let active = true;

    setLoading(true);
    setError('');
    setDiagnostics([]);

    void getSkill(skillId)
      .then((value) => {
        if (!active) {
          return;
        }

        applySkill(value);
      })
      .catch((reason) => {
        if (!active) {
          return;
        }

        setError(
          localizeApiError(reason, 'skills.editor.loadFailed'),
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
  }, [
    applySkill,
    localize,
    skillId,
  ]);

  const requestClose = useCallback(() => {
    if (
      saving ||
      preparingFiles ||
      closing
    ) {
      return;
    }

    setClosing(true);
    setShowModal(false);

    closeTimerRef.current =
      window.setTimeout(
        onClose,
        TRANSITION_MS,
      );
  }, [
    closing,
    onClose,
    preparingFiles,
    saving,
  ]);

  useEffect(() => {
    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (event.key === 'Escape') {
        requestClose();
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
  }, [requestClose]);

  const ensureEditableDraft =
    useCallback(async () => {
      if (!skillId) {
        return null;
      }

      if (
        sourceVersion?.status ===
        'DRAFT'
      ) {
        return sourceVersion;
      }

      const created =
        await createSkillDraftVersion(
          skillId,
          {
            skillMarkdown,
            changeLog:
              changeLog.trim() ||
              undefined,
          },
        );

      setSourceVersion(created);

      await refreshSkill({
        preserveMarkdown: true,
        preferredVersionId: created.id,
      });

      return created;
    }, [
      changeLog,
      refreshSkill,
      skillId,
      skillMarkdown,
      sourceVersion,
    ]);

  useEffect(() => {
    filePreparationKeyRef.current = null;
  }, [skillId]);

  useEffect(() => {
    if (
      !skillId ||
      !skill ||
      !sourceVersion ||
      loading ||
      preparingFiles ||
      sourceVersion.status ===
        'DRAFT'
    ) {
      return;
    }

    const preparationKey =
      `${skillId}:${sourceVersion?.id ?? 'current'}`;

    if (
      filePreparationKeyRef.current ===
      preparationKey
    ) {
      return;
    }

    filePreparationKeyRef.current =
      preparationKey;

    setPreparingFiles(true);
    setError('');
    setDiagnostics([]);

    void ensureEditableDraft()
      .catch((reason) => {
        setDiagnostics(
          requestIssues(reason),
        );

        setError(
          localizeApiError(reason, 'skills.editor.prepareDraftFailed'),
        );
      })
      .finally(() => {
        setPreparingFiles(false);
      });
  }, [
    ensureEditableDraft,
    loading,
    preparingFiles,
    skill,
    skillId,
    sourceVersion,
  ]);

  const handleFilesChanged =
    useCallback(async (
      nextVersionId: string,
    ) => {
      if (!skillId) {
        return;
      }

      try {
        await refreshSkill({
          preserveMarkdown: true,
          preferredVersionId:
            nextVersionId,
        });
      } catch (reason) {
        setError(
          localizeApiError(reason, 'skills.editor.fileRefreshFailed'),
        );
      }
    }, [
      refreshSkill,
      skillId,
    ]);

  const save = async () => {
    if (
      saving ||
      loading ||
      preparingFiles ||
      !displayName.trim() ||
      !skillMarkdown.trim()
    ) {
      return;
    }

    setSaving(true);
    setError('');
    setDiagnostics([]);

    try {
      if (!skillId) {
        const created =
          await createSkill({
            displayName: displayName.trim(),
            skillMarkdown,
          });

        await onSaved(created.id);
        return;
      }


      const editable =
        await ensureEditableDraft();

      if (!editable) {
        throw new Error('SKILL_EDITABLE_DRAFT_REQUIRED');
      }

      const updated =
        await updateSkillDraftVersion(
          skillId,
          editable.id,
          {
            skillMarkdown,
            changeLog:
              changeLog.trim() ||
              undefined,
            expectedRevision:
              editable.revision,
            displayName:
              displayName.trim() !==
              (skill
                ? getSkillDisplayName(skill)
                : '')
                ? displayName.trim()
                : undefined,
            expectedSkillRevision:
              skill?.revision,
          },
        );

      setSourceVersion(updated);

      await onSaved(skillId);
    } catch (reason) {
      setDiagnostics(
        requestIssues(reason),
      );

      setError(
        localizeApiError(reason, 'skills.editor.saveFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const panelClass = 'border-edge-input bg-surface-panel text-theme-strong   ';

  const softPanelClass = 'border-edge-input bg-[#fafafa] text-theme-strong  dark:bg-[#181818] ';

  const mutedClass = 'text-theme-balanced-50 ';

  const currentFileCount =
    sourceVersion?._count?.files ?? 0;

  const modalNode = (
    <div
      data-desktop-no-drag
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        pointerEvents: 'none',
        opacity: showModal ? 1 : 0,
        transition: `opacity ${TRANSITION_MS}ms ease`,
      }}
    >
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
          requestClose();
        }}
      />

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
        <div
          data-skill-editor-dialog
          role="dialog"
          aria-modal="true"
          aria-labelledby="skill-editor-title"
          className={`
            pointer-events-auto
            relative
            grid
            w-[960px]
            max-w-[94vw]
            grid-rows-[auto_minmax(0,1fr)_auto]
            overflow-hidden
            rounded-[14px]
            border
            shadow-2xl
            ${panelClass}
          `}
          style={{
            height: 'calc(82vh + 20px)',
            maxHeight:
              'calc(100vh - 24px)',
            transform: showModal
              ? 'scale(1)'
              : 'scale(0.96)',
            opacity: showModal ? 1 : 0.96,
            transition: [
              `transform ${TRANSITION_MS}ms ease`,
              `opacity ${TRANSITION_MS}ms ease`,
            ].join(', '),
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onCopy={(event) => {
            const target = event.target;

            if (
              !(
                target instanceof Element &&
                target.closest(
                  '[data-skill-editor-editable="true"]',
                )
              )
            ) {
              event.preventDefault();
            }
          }}
          onDragStart={(event) => {
            const target = event.target;

            if (
              !(
                target instanceof Element &&
                target.closest(
                  '[data-skill-editor-editable="true"]',
                )
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <style>
            {`
              [data-skill-editor-dialog],
              [data-skill-editor-dialog] * {
                -webkit-user-select: none !important;
                user-select: none !important;
              }

              [data-skill-editor-dialog]
                [data-skill-editor-editable="true"],
              [data-skill-editor-dialog]
                [data-skill-editor-editable="true"] * {
                -webkit-user-select: text !important;
                user-select: text !important;
              }
            `}
          </style>

          <header
            className="
              flex
              shrink-0
              items-center
              justify-between
              border-b
              border-inherit
              px-[16px]
              py-[11px]
            "
          >
            <div className="select-none">
              <div
                id="skill-editor-title"
                className="
                  text-[15px]
                  font-semibold
                "
              >
                {skillId
                  ? localize('skills.editor.editTitle')
                  : localize('skills.editor.createTitle')}
              </div>

              <div
                className="
                  mt-[3px]
                  text-[9px]
                  opacity-55
                "
              >
                {localize('skills.editor.description')}
              </div>
            </div>

            <button
              type="button"
              disabled={
                saving ||
                preparingFiles
              }
              onClick={requestClose}
              className={`
                select-none
                rounded-[7px]
                border-0
                px-[8px]
                py-[5px]
                text-[10px]
                opacity-65
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
              grid-cols-[250px_minmax(0,1fr)]
              overflow-hidden
            "
          >
            <aside
              className="
                min-h-0
                overflow-y-auto
                border-r
                border-inherit
                p-[14px]
              "
            >
              {loading ? (
                <div className="text-[11px] opacity-50">
                  {localize('common.loading')}
                </div>
              ) : (
                <div className="space-y-[12px]">
                  <label className="block">
                    <div className="text-[10px] font-medium">
                      {localize('skills.editor.name')}
                    </div>

                    <input
                      value={displayName}
                      disabled={saving || preparingFiles}
                      maxLength={120}
                      onChange={(event) =>
                        setDisplayName(event.target.value)
                      }
                      placeholder={localize('skills.editor.namePlaceholder')}
                      className={`
                        mt-[5px]
                        box-border
                        block
                        w-full
                        rounded-[8px]
                        border
                        px-[8px]
                        py-[7px]
                        text-[10px]
                        outline-none
                        ${
                          'border-edge-strong bg-surface-soft text-theme-primary   '
                        }
                      `}
                    />

                    <div className="mt-[4px] text-[8px] leading-[13px] opacity-45">
                      {localize('skills.editor.nameHint')}
                    </div>
                  </label>

                  <div>
                    <div className="text-[10px] font-medium">
                      {localize('skills.editor.editSource')}
                    </div>

                    <div className="mt-[4px] text-[11px] opacity-65">
                      {sourceVersion
                        ? `${sourceVersion.versionLabel} · ${localize(`skills.version.${sourceVersion.status}`)}`
                        : localize('skills.editor.newDocument')}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-medium">
                      {localize('skills.editor.versionFiles')}
                    </div>

                    <div className="mt-[4px] text-[11px] opacity-65">
                      {sourceVersion
                        ? localize('skills.editor.fileCount', { count: currentFileCount })
                        : localize('skills.editor.noVersionYet')}
                    </div>
                  </div>

                  {skill?.source && (
                    <div>
                      <div className="text-[10px] font-medium">
                        {localize('common.source')}
                      </div>

                      <div className="mt-[4px] break-all text-[11px] opacity-65">
                        {localize(
                          isAgentGeneratedSkillSource(skill.source)
                            ? 'skills.source.AI_GENERATED'
                            : `skills.source.${skill.source.kind}`,
                        )}
                        {skill.source.sourceRef
                          ? ` · ${skill.source.sourceRef}`
                          : ''}
                      </div>
                    </div>
                  )}

                  <div
                    className={`
                      rounded-[9px]
                      border
                      p-[6px]
                      ${softPanelClass}
                    `}
                  >
                    <div className="mb-[5px] text-[10px] font-medium">
                      {localize('skills.editor.changeLog')}
                    </div>

                    <textarea
                      data-skill-editor-editable="true"
                      value={changeLog}
                      disabled={
                        saving ||
                        preparingFiles
                      }
                      onChange={(event) =>
                        setChangeLog(
                          event.target.value,
                        )
                      }
                      className={`
                        min-h-[100px]
                        w-full
                        resize-y
                        rounded-[9px]
                        box-border
                        min-w-0
                        max-w-full
                        border
                        text-[10px]
                        outline-none
                        ${panelClass}
                      `}
                      placeholder={localize('common.optional')}
                    />
                  </div>

                  <div
                    className={`
                      rounded-[9px]
                      border
                      p-[9px]
                      ${softPanelClass}
                    `}
                  >
                    <div className="text-[10px] font-medium">
                      {localize('skills.create.skillPackage')}
                    </div>

                    <div
                      className={`
                        mt-[6px]
                        space-y-[4px]
                        text-[9px]
                        leading-[1.5]
                        ${mutedClass}
                      `}
                    >
                      <div>{localize('skills.editor.package.main')}</div>
                      <div>{localize('skills.editor.package.reference')}</div>
                      <div>{localize('skills.editor.package.script')}</div>
                      <div>{localize('skills.editor.package.asset')}</div>
                      <div>{localize('skills.editor.package.other')}</div>
                    </div>
                  </div>

                  {diagnostics.length > 0 && (
                    <div className="space-y-[5px]">
                      <div className="text-[10px] font-medium">
                        {localize('skills.editor.diagnostics')}
                      </div>

                      {diagnostics.map(
                        (item, index) => (
                          <div
                            key={`${item.code}-${index}`}
                            className={`
                              text-[9px]
                              leading-[1.45]
                              ${
                                item.severity ===
                                  'ERROR' ||
                                item.severity ===
                                  'CRITICAL'
                                  ? 'text-red-400'
                                  : 'text-amber-500'
                              }
                            `}
                          >
                            {item.line
                              ? localize('skills.editor.diagnosticLocation', {
                                  line: item.line,
                                  column: item.column ? `:${item.column}` : '',
                                })
                              : ''}
                            {localize(`skills.diagnostic.${item.code}`, {
                              ...(item.params ?? {}),
                              defaultValue: item.message,
                            })}
                          </div>
                        ),
                      )}
                    </div>
                  )}

                  {error && (
                    <div className="text-[10px] text-red-400">
                      {error}
                    </div>
                  )}
                </div>
              )}
            </aside>

            <main
              className="
                grid
                min-h-0
                min-w-0
                grid-cols-2
                gap-[10px]
                overflow-hidden
                p-[14px]
              "
            >
              <section
                className="
                  flex
                  min-h-0
                  min-w-0
                  flex-col
                "
              >
                <div
                  className="
                    mb-[7px]
                    shrink-0
                    text-[11px]
                    font-semibold
                  "
                >
                  SKILL.md
                </div>

                <textarea
                  data-skill-editor-editable="true"
                  value={skillMarkdown}
                  disabled={
                    loading ||
                    saving ||
                    preparingFiles
                  }
                  spellCheck={false}
                  onChange={(event) =>
                    setSkillMarkdown(
                      event.target.value,
                    )
                  }
                  className={`
                    min-h-0
                    flex-1
                    resize-none
                    rounded-[10px]
                    border
                    p-[12px]
                    font-mono
                    text-[11px]
                    leading-[1.6]
                    outline-none
                    ${panelClass}
                  `}
                />
              </section>

              <section
                className="
                  flex
                  min-h-0
                  min-w-0
                  flex-col
                "
              >
                <div
                  className="
                    mb-[7px]
                    shrink-0
                    text-[11px]
                    font-semibold
                  "
                >
                  {localize('common.files')}
                </div>

                <div
                  className={`
                    min-h-0
                    flex-1
                    overflow-y-auto
                    rounded-[10px]
                    border
                    p-[12px]
                    ${softPanelClass}
                  `}
                >
                  {!skillId ? (
                    <div
                      className={`
                        flex
                        h-full
                        min-h-[220px]
                        items-center
                        justify-center
                        px-[24px]
                        text-center
                        text-[10px]
                        leading-[1.6]
                        ${mutedClass}
                      `}
                    >
                      {localize('skills.editor.filesCreateFirst')}
                    </div>
                  ) : preparingFiles ? (
                    <div
                      className={`
                        flex
                        h-full
                        min-h-[220px]
                        items-center
                        justify-center
                        text-[10px]
                        ${mutedClass}
                      `}
                    >
                      {localize('skills.editor.preparingDraft')}
                    </div>
                  ) : sourceVersion?.status ===
                    'DRAFT' ? (
                    <SkillFileManager
                      skillId={skillId}
                      versionId={
                        sourceVersion.id
                      }
                      isDraft
                      onVersionChanged={
                        handleFilesChanged
                      }
                    />
                  ) : (
                    <div
                      className={`
                        flex
                        h-full
                        min-h-[220px]
                        items-center
                        justify-center
                        px-[24px]
                        text-center
                        text-[10px]
                        leading-[1.6]
                        ${mutedClass}
                      `}
                    >
                      {localize('skills.editor.currentVersionLocked')}
                    </div>
                  )}
                </div>
              </section>
            </main>
          </div>

          <footer
            className={`
              relative
              z-10
              flex
              shrink-0
              justify-end
              gap-[7px]
              border-t
              border-inherit
              px-[12px]
              py-[8px]
              ${
                'bg-surface-panel '
              }
            `}
          >
            <button
              type="button"
              onClick={requestClose}
              disabled={
                saving ||
                preparingFiles ||
                closing
              }
              className={`
                select-none
                rounded-[7px]
                border-0
                px-[10px]
                py-[6px]
                text-[10px]
                opacity-70
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
              onClick={() => {
                void save();
              }}
              disabled={
                loading ||
                saving ||
                preparingFiles ||
                !displayName.trim() ||
                !skillMarkdown.trim()
              }
              className="
                rounded-[7px]
                border-0
                bg-action-primary
                px-[13px]
                py-[6px]
                text-[10px]
                text-[#ffffff]
                outline-none
                transition-opacity
                hover:!text-[#ffffff]
                disabled:cursor-not-allowed
                disabled:opacity-40
              "
            >
              {saving
                ? localize('common.saving')
                : skillId
                  ? localize('skills.editor.saveNewVersion')
                  : localize('skills.editor.createTitle')}
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