                              
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocalize } from '../../../../localization/useLocalize';

import {
  commitSkillImport,
  createSkill,
  generateSkill,
  inspectSkillImport,
  validateAndActivateSkill,
} from '../api/skill.api';

import type {
  SkillDocumentDiagnostic,
  SkillImportInspection,
  SkillImportSourceInput,
  SkillValidationSummary,
} from '../types/skill.types';

import SkillCreateInputPanel from './SkillCreateInputPanel';
import SkillGenerationPreview from './SkillGenerationPreview';

import type {
  SkillCreateAction,
  SkillCreateMode,
  SkillImportRecognitionState,
  SkillMetadataEntry,
} from './skill-create.types';

import {
  actualSkillMarkdown,
  draftVersionId,
  importInspectionAccepted,
  metadataObject,
  requestErrorMessage,
  requestIssues,
  requestValidation,
} from './skill-create.utils';

interface SkillCreateModalProps {

  onClose: () => void;
  onSaved: (
    skillId: string,
    targetView: 'mine' | 'drafts',
  ) => void | Promise<void>;
}

interface PersistedDraftReference {
  skillId: string;
  versionId: string;
  mode: SkillCreateMode;
  fingerprint: string;
}

const TRANSITION_MS = 200;
const IMPORT_DEBOUNCE_MS = 600;

function createEmptySkill(
  localize: (
    key: string,
    values?: Record<string, unknown>,
  ) => string,
): string {
  return [
    '---',
    'name: skill-draft',
    `description: ${localize('skills.create.templateDescription')}`,
    '---',
    '',
    `# ${localize('skills.create.templateHeading')}`,
    '',
    localize('skills.create.templateBody'),
    '',
  ].join('\n');
}

export default function SkillCreateModal({
    onClose,
  onSaved,
}: SkillCreateModalProps) {
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

  const inspectTimerRef =
    useRef<number | null>(null);

  const inspectionRequestRef =
    useRef(0);

  const [showModal, setShowModal] =
    useState(false);

  const [closing, setClosing] =
    useState(false);

  const [mode, setMode] =
    useState<SkillCreateMode>(
      'STANDARD',
    );

  const [busyAction, setBusyAction] =
    useState<
      SkillCreateAction | null
    >(null);

  const [
    recognitionState,
    setRecognitionState,
  ] =
    useState<SkillImportRecognitionState>(
      'IDLE',
    );

  const [error, setError] =
    useState('');

  const [notice, setNotice] =
    useState('');

  const [
    diagnostics,
    setDiagnostics,
  ] = useState<
    SkillDocumentDiagnostic[]
  >([]);

  const [
    validation,
    setValidation,
  ] =
    useState<SkillValidationSummary | null>(
      null,
    );

  const [name, setName] =
    useState('');

  const [
    description,
    setDescription,
  ] = useState('');

  const [license, setLicense] =
    useState('');

  const [
    compatibility,
    setCompatibility,
  ] = useState('');

  const [metadata, setMetadata] =
    useState<SkillMetadataEntry[]>(
      [],
    );

  const [
    allowedTools,
    setAllowedTools,
  ] = useState('');

  const [
    skillMarkdown,
    setSkillMarkdown,
  ] = useState(() => createEmptySkill(localize));

  const [
    importFile,
    setImportFile,
  ] = useState<File | null>(null);

  const [
    repositoryUrl,
    setRepositoryUrl,
  ] = useState('');

  const [
    importContent,
    setImportContent,
  ] = useState('');

  const [
    inspection,
    setInspection,
  ] =
    useState<SkillImportInspection | null>(
      null,
    );

  const [
    persistedDraft,
    setPersistedDraft,
  ] =
    useState<PersistedDraftReference | null>(
      null,
    );

  const busy =
    busyAction !== null;

  const importSourceReady =
    Boolean(
      importFile ||
        repositoryUrl.trim() ||
        importContent.length,
    );

  const buildImportSource =
    useCallback(
      (): SkillImportSourceInput => ({
        file: importFile,
        repositoryUrl:
          repositoryUrl.trim() ||
          undefined,
        content:
          importContent ||
          undefined,
      }),
      [
        importFile,
        repositoryUrl,
        importContent,
      ],
    );

  useEffect(() => {
    const frame =
      requestAnimationFrame(() => {
        setShowModal(true);
      });

    return () => {
      cancelAnimationFrame(frame);

      inspectionRequestRef.current += 1;

      if (
        closeTimerRef.current !== null
      ) {
        window.clearTimeout(
          closeTimerRef.current,
        );
      }

      if (
        inspectTimerRef.current !==
        null
      ) {
        window.clearTimeout(
          inspectTimerRef.current,
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

  const requestClose =
    useCallback(() => {
      if (busy || closing) {
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
      busy,
      closing,
      onClose,
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

  const inputClass = `
    box-border
    block
    w-full
    min-w-0
    rounded-[9px]
    border-[0.5px]
    px-[9px]
    py-[7px]
    text-[11px]
    outline-none
    transition-colors
    disabled:cursor-not-allowed
    disabled:opacity-50
    ${
      'border-edge-soft bg-surface-soft text-theme-primary placeholder:text-[#999999]    dark:placeholder:text-[#666666]'
    }
  `;

  const sectionClass = `
    min-w-0
    rounded-[10px]
    border
    p-[10px]
    ${
      'border-edge-default bg-[#ffffff]  dark:bg-[#171717]'
    }
  `;

  const resetFeedback =
    useCallback(() => {
      setError('');
      setNotice('');
      setDiagnostics([]);
      setValidation(null);
    }, []);

  const invalidateImportInspection =
    useCallback(() => {
      inspectionRequestRef.current += 1;

      if (
        inspectTimerRef.current !==
        null
      ) {
        window.clearTimeout(
          inspectTimerRef.current,
        );

        inspectTimerRef.current =
          null;
      }

      setInspection(null);
      setRecognitionState('IDLE');
      setPersistedDraft(null);
      resetFeedback();
    }, [resetFeedback]);

  const run = async (
    action: SkillCreateAction,
    work: () => Promise<void>,
  ) => {
    if (busy) {
      return;
    }

    setBusyAction(action);
    resetFeedback();

    try {
      await work();
    } catch (reason) {
      const issues =
        requestIssues(reason);

      const nextValidation =
        requestValidation(reason);

      if (issues.length > 0) {
        setDiagnostics(issues);
      }

      if (nextValidation) {
        setValidation(
          nextValidation,
        );
      }

      setError(
        requestErrorMessage(
          reason,
          localize('skills.request.failed'),
        ),
      );
    } finally {
      setBusyAction(null);
    }
  };

  useEffect(() => {
    if (
      mode !== 'IMPORT' ||
      !importSourceReady
    ) {
      if (mode === 'IMPORT') {
        setRecognitionState(
          'IDLE',
        );
      }

      return;
    }

    const requestId =
      ++inspectionRequestRef.current;

    setRecognitionState(
      importFile
        ? 'INSPECTING'
        : 'WAITING',
    );

    const inspect = async () => {
      if (
        requestId !==
        inspectionRequestRef.current
      ) {
        return;
      }

      setRecognitionState(
        'INSPECTING',
      );

      setError('');
      setNotice('');
      setDiagnostics([]);
      setValidation(null);
      setInspection(null);

      try {
        const result =
          await inspectSkillImport(
            buildImportSource(),
          );

        if (
          requestId !==
          inspectionRequestRef.current
        ) {
          return;
        }

        const nextInspection =
          result.inspection;

        setInspection(
          nextInspection,
        );

        setValidation(
          nextInspection.validation,
        );

        setDiagnostics(
          nextInspection.validation
            .diagnostics ?? [],
        );

        if (
          !nextInspection.validation
            .accepted
        ) {
          setRecognitionState(
            'REJECTED',
          );

          setNotice(
            localize('skills.import.blocked'),
          );

          return;
        }

        if (
          nextInspection.validation
            .specCompliant
        ) {
          setRecognitionState(
            'ACCEPTED_STANDARD',
          );

          setNotice(
            localize('skills.import.standardRecognized'),
          );
        } else {
          setRecognitionState(
            'ACCEPTED_COMPATIBLE',
          );

          setNotice(
            localize('skills.import.compatibleRecognized'),
          );
        }
      } catch (reason) {
        if (
          requestId !==
          inspectionRequestRef.current
        ) {
          return;
        }

        const issues =
          requestIssues(reason);

        const nextValidation =
          requestValidation(reason);

        setInspection(null);

        if (issues.length > 0) {
          setDiagnostics(issues);
        }

        if (nextValidation) {
          setValidation(
            nextValidation,
          );
        }

        setRecognitionState(
          'REJECTED',
        );

        setError(
          requestErrorMessage(
            reason,
            localize('skills.import.inspectFailed'),
          ),
        );
      }
    };

    if (importFile) {
      void inspect();

      return () => {
        if (
          requestId ===
          inspectionRequestRef.current
        ) {
          inspectionRequestRef.current +=
            1;
        }
      };
    }

    inspectTimerRef.current =
      window.setTimeout(
        () => {
          inspectTimerRef.current =
            null;

          void inspect();
        },
        IMPORT_DEBOUNCE_MS,
      );

    return () => {
      if (
        inspectTimerRef.current !==
        null
      ) {
        window.clearTimeout(
          inspectTimerRef.current,
        );

        inspectTimerRef.current =
          null;
      }
    };
  }, [
    mode,
    importFile,
    repositoryUrl,
    importContent,
    importSourceReady,
    buildImportSource,
  ]);

  const aiCreate = () =>
    run('AI', async () => {
      const generated =
        await generateSkill({
          displayName: name.trim(),
          description,
          license:
            license.trim() ||
            undefined,
          compatibility:
            compatibility.trim() ||
            undefined,
          metadata:
            metadataObject(
              metadata,
            ),
          allowedTools:
            allowedTools.trim() ||
            undefined,
        });

      setSkillMarkdown(
        generated.skillMarkdown,
      );

      setDiagnostics(
        generated.validation
          .diagnostics ??
          generated.diagnostics ??
          [],
      );

      setValidation(
        generated.validation,
      );

      setPersistedDraft(null);

      setNotice(
        localize('skills.create.aiGenerated'),
      );
    });

  const activateSavedDraft =
    async (
      skillId: string,
      versionId: string,
    ) => {
      try {
        await validateAndActivateSkill(
          skillId,
          versionId,
        );
      } catch (reason) {
        const issues =
          requestIssues(reason);

        const nextValidation =
          requestValidation(reason);

        if (issues.length > 0) {
          setDiagnostics(issues);
        }

        if (nextValidation) {
          setValidation(
            nextValidation,
          );
        }

        const message =
          requestErrorMessage(
            reason,
            localize('skills.activate.failed'),
          );

        throw new Error(
          localize('skills.activate.draftSavedButFailed', { message }),
        );
      }
    };

  const saveStandard = (
    intent:
      | 'DRAFT'
      | 'ACTIVE',
  ) =>
    run(
      intent === 'DRAFT'
        ? 'SAVE_DRAFT'
        : 'USE_DIRECTLY',
      async () => {
        const fingerprint =
          skillMarkdown;

        let skillId: string;
        let versionId: string;

        const reusableDraft =
          intent === 'ACTIVE' &&
          persistedDraft?.mode ===
            'STANDARD' &&
          persistedDraft.fingerprint ===
            fingerprint;

        if (
          reusableDraft &&
          persistedDraft
        ) {
          skillId =
            persistedDraft.skillId;

          versionId =
            persistedDraft.versionId;
        } else {
          const saved =
            await createSkill({
              displayName: name.trim(),
              skillMarkdown,
            });

          const resolvedVersionId =
            draftVersionId(saved);

          if (!resolvedVersionId) {
            throw new Error(
              localize('skills.draft.missingVersionId'),
            );
          }

          skillId = saved.id;
          versionId =
            resolvedVersionId;

          const actual =
            actualSkillMarkdown(
              saved,
            );

          if (actual) {
            setSkillMarkdown(actual);
          }

          setDiagnostics(
            saved.validation
              ?.diagnostics ??
              saved.diagnostics ??
              [],
          );

          setValidation(
            saved.validation ??
              null,
          );

          if (intent === 'ACTIVE') {
            setPersistedDraft({
              skillId,
              versionId,
              mode: 'STANDARD',
              fingerprint,
            });
          }
        }

        if (intent === 'DRAFT') {
          setNotice(
            localize('skills.draft.saved'),
          );

          await onSaved(
            skillId,
            'drafts',
          );

          return;
        }

        await activateSavedDraft(
          skillId,
          versionId,
        );

        setPersistedDraft(null);

        setNotice(
          localize('skills.active.saved'),
        );

        await onSaved(
          skillId,
          'mine',
        );
      },
    );

  const saveImport = (
    intent:
      | 'DRAFT'
      | 'ACTIVE',
  ) =>
    run(
      intent === 'DRAFT'
        ? 'IMPORT_SAVE_DRAFT'
        : 'IMPORT_USE_DIRECTLY',
      async () => {
        if (!inspection) {
          throw new Error(
            localize('skills.import.notInspected'),
          );
        }

        if (
          !importInspectionAccepted(
            inspection,
          )
        ) {
          throw new Error(
            localize('skills.import.stillBlocked'),
          );
        }

        const fingerprint =
          inspection.inspectionToken;

        let skillId: string;
        let versionId: string;

        const reusableDraft =
          intent === 'ACTIVE' &&
          persistedDraft?.mode ===
            'IMPORT' &&
          persistedDraft.fingerprint ===
            fingerprint;

        if (
          reusableDraft &&
          persistedDraft
        ) {
          skillId =
            persistedDraft.skillId;

          versionId =
            persistedDraft.versionId;
        } else {
          const saved =
            await commitSkillImport(
              buildImportSource(),
              inspection.inspectionToken,
            );

          const resolvedVersionId =
            draftVersionId(saved);

          if (!resolvedVersionId) {
            throw new Error(
              localize('skills.import.missingVersionId'),
            );
          }

          skillId = saved.id;
          versionId =
            resolvedVersionId;

          if (intent === 'ACTIVE') {
            setPersistedDraft({
              skillId,
              versionId,
              mode: 'IMPORT',
              fingerprint,
            });
          }
        }

        if (intent === 'DRAFT') {
          setNotice(
            inspection.validation
              .specCompliant
              ? localize('skills.import.standardDraftSaved')
              : localize('skills.import.compatibleDraftSaved'),
          );

          await onSaved(
            skillId,
            'drafts',
          );

          return;
        }

        await activateSavedDraft(
          skillId,
          versionId,
        );

        setPersistedDraft(null);

        setNotice(
          inspection.validation
            .specCompliant
            ? localize('skills.import.standardActivated')
            : localize('skills.import.compatibleActivated'),
        );

        await onSaved(
          skillId,
          'mine',
        );
      },
    );

  const switchMode = (
    nextMode: SkillCreateMode,
  ) => {
    if (
      busy ||
      nextMode === mode
    ) {
      return;
    }

    inspectionRequestRef.current += 1;

    if (
      inspectTimerRef.current !==
      null
    ) {
      window.clearTimeout(
        inspectTimerRef.current,
      );

      inspectTimerRef.current =
        null;
    }

    setMode(nextMode);
    setPersistedDraft(null);
    setRecognitionState('IDLE');
    setInspection(null);
    resetFeedback();
  };

  const aiValid =
    Boolean(
      name.trim() &&
        description.trim(),
    );

  const standardReady =
    Boolean(
      name.trim() &&
        skillMarkdown.trim(),
    );

  const importReady =
    Boolean(
      inspection &&
        importInspectionAccepted(
          inspection,
        ) &&
        recognitionState !==
          'INSPECTING' &&
        recognitionState !==
          'WAITING',
    );

  const modalNode = (
    <div
      data-desktop-no-drag
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        pointerEvents: 'none',
        opacity: showModal
          ? 1
          : 0,
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
          backdropFilter:
            'blur(3px)',
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
          role="dialog"
          aria-modal="true"
          aria-labelledby="skill-create-title"
          className={`
            pointer-events-auto
            relative
            flex
            max-w-[94vw]
            overflow-hidden
            rounded-[14px]
            border-[0.5px]
            shadow-2xl
            ${
              'border-edge-strong bg-surface-raised text-theme-primary   '
            }
          `}
          style={{
            width: 650,
            height:
              'calc(76vh + 40px)',
            maxHeight:
              'calc(100vh - 24px)',
            transform: showModal
              ? 'scale(1)'
              : 'scale(0.96)',
            opacity: showModal
              ? 1
              : 0.96,
            transition: [
              `transform ${TRANSITION_MS}ms ease`,
              `opacity ${TRANSITION_MS}ms ease`,
            ].join(', '),
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
        >
          <div
            className="
              flex
              min-w-0
              flex-1
              flex-col
            "
          >
            <header
              className={`
                flex
                shrink-0
                items-center
                justify-between
                border-b-[0.5px]
                ${
                  'border-edge-strong '
                }
                px-[14px]
                py-[10px]
              `}
            >
              <div className="select-none">
                <div
                  id="skill-create-title"
                  className="
                    text-[15px]
                    font-semibold
                  "
                >
                  {localize('skills.create.modalTitle')}
                </div>

                <div
                  className="
                    mt-[3px]
                    text-[9px]
                    opacity-60
                  "
                >
                  {localize('skills.create.modalDescription')}
                </div>
              </div>

              <button
                type="button"
                onClick={requestClose}
                disabled={
                  busy || closing
                }
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
              className={`
                grid
                min-h-0
                flex-1
                grid-cols-[minmax(0,325px)_minmax(0,325px)]
                overflow-hidden
                [&>div:first-child]:border-r-[0.5px]
                ${
                  '[&>div:first-child]:border-[#e6e6e6] dark:[&>div:first-child]:border-[#303030]'
                }
              `}
            >
              <SkillCreateInputPanel

                busy={busy}
                mode={mode}
                inputClass={
                  inputClass
                }
                sectionClass={
                  sectionClass
                }
                name={name}
                setName={setName}
                description={
                  description
                }
                setDescription={
                  setDescription
                }
                license={license}
                setLicense={
                  setLicense
                }
                compatibility={
                  compatibility
                }
                setCompatibility={
                  setCompatibility
                }
                metadata={metadata}
                setMetadata={
                  setMetadata
                }
                allowedTools={
                  allowedTools
                }
                setAllowedTools={
                  setAllowedTools
                }
                importFile={
                  importFile
                }
                setImportFile={(
                  value,
                ) => {
                  invalidateImportInspection();
                  setImportFile(
                    value,
                  );
                }}
                repositoryUrl={
                  repositoryUrl
                }
                setRepositoryUrl={(
                  value,
                ) => {
                  invalidateImportInspection();
                  setRepositoryUrl(
                    value,
                  );
                }}
                importContent={
                  importContent
                }
                setImportContent={(
                  value,
                ) => {
                  invalidateImportInspection();
                  setImportContent(
                    value,
                  );
                }}
                recognitionState={
                  recognitionState
                }
                onSwitchMode={
                  switchMode
                }
              />

              <SkillGenerationPreview

                busy={busy}
                mode={mode}
                skillMarkdown={
                  skillMarkdown
                }
                setSkillMarkdown={(
                  value,
                ) => {
                  setSkillMarkdown(
                    value,
                  );

                  setPersistedDraft(
                    null,
                  );

                  setDiagnostics([]);
                  setValidation(null);
                  setError('');
                  setNotice('');
                }}
                importContent={
                  importContent
                }
                inspection={
                  inspection
                }
                diagnostics={
                  diagnostics
                }
                validation={
                  mode === 'IMPORT' &&
                  inspection
                    ? inspection.validation
                    : validation
                }
                recognitionState={
                  recognitionState
                }
              />
            </div>

            {(error || notice) && (
              <div
                className="
                  shrink-0
                  px-[12px]
                  pb-[6px]
                  text-[9px]
                "
              >
                {error && (
                  <div className="text-red-400">
                    {error}
                  </div>
                )}

                {notice && (
                  <div className="text-emerald-500">
                    {notice}
                  </div>
                )}
              </div>
            )}

            <footer
              className={`
                flex
                shrink-0
                items-center
                justify-end
                gap-[7px]
                border-t-[0.5px]
                ${
                  'border-edge-strong '
                }
                px-[12px]
                py-[8px]
                ${
                  'bg-surface-raised '
                }
              `}
            >
              <button
                type="button"
                onClick={requestClose}
                disabled={
                  busy || closing
                }
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

              {mode === 'STANDARD' ? (
                <>
                  <button
                    type="button"
                    disabled={
                      !aiValid ||
                      busy
                    }
                    onClick={() =>
                      void aiCreate()
                    }
                    className={`
                      select-none
                      rounded-[7px]
                      border-0
                      px-[12px]
                      py-[6px]
                      text-[10px]
                      outline-none
                      transition-colors
                      disabled:cursor-not-allowed
                      disabled:opacity-40
                      ${
                        'bg-surface-neutral-strong text-theme-primary hover:bg-surface-control-hover   '
                      }
                    `}
                  >
                    {busyAction ===
                    'AI'
                      ? localize('skills.actions.creating')
                      : localize('skills.actions.aiCreate')}
                  </button>

                  <button
                    type="button"
                    disabled={
                      !standardReady ||
                      busy
                    }
                    onClick={() =>
                      void saveStandard(
                        'DRAFT',
                      )
                    }
                    className={`
                      select-none
                      rounded-[7px]
                      border-0
                      px-[12px]
                      py-[6px]
                      text-[10px]
                      outline-none
                      transition-colors
                      disabled:cursor-not-allowed
                      disabled:opacity-40
                      ${
                        'bg-surface-neutral-strong text-theme-primary hover:bg-surface-control-hover   '
                      }
                    `}
                  >
                    {busyAction ===
                    'SAVE_DRAFT'
                      ? localize('skills.actions.saving')
                      : localize('skills.actions.saveDraft')}
                  </button>

                  <button
                    type="button"
                    disabled={
                      !standardReady ||
                      busy
                    }
                    onClick={() =>
                      void saveStandard(
                        'ACTIVE',
                      )
                    }
                    className="
                      select-none
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
                      disabled:opacity-40
                    "
                  >
                    {busyAction ===
                    'USE_DIRECTLY'
                      ? localize('skills.actions.activating')
                      : persistedDraft
                            ?.mode ===
                          'STANDARD'
                        ? localize('skills.actions.retryActivate')
                        : localize('skills.actions.useDirectly')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={
                      !importReady ||
                      busy
                    }
                    onClick={() =>
                      void saveImport(
                        'DRAFT',
                      )
                    }
                    className={`
                      select-none
                      rounded-[7px]
                      border-0
                      px-[12px]
                      py-[6px]
                      text-[10px]
                      outline-none
                      transition-colors
                      disabled:cursor-not-allowed
                      disabled:opacity-40
                      ${
                        'bg-surface-neutral-strong text-theme-primary hover:bg-surface-control-hover   '
                      }
                    `}
                  >
                    {busyAction ===
                    'IMPORT_SAVE_DRAFT'
                      ? localize('skills.actions.saving')
                      : localize('skills.actions.saveDraft')}
                  </button>

                  <button
                    type="button"
                    disabled={
                      !importReady ||
                      busy
                    }
                    onClick={() =>
                      void saveImport(
                        'ACTIVE',
                      )
                    }
                    className="
                      select-none
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
                      disabled:opacity-40
                    "
                  >
                    {busyAction ===
                    'IMPORT_USE_DIRECTLY'
                      ? localize('skills.actions.activating')
                      : persistedDraft
                            ?.mode ===
                          'IMPORT'
                        ? localize('skills.actions.retryActivate')
                        : localize('skills.actions.useDirectly')}
                  </button>
                </>
              )}
            </footer>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(
    modalNode,
    portalContainer,
  );
}