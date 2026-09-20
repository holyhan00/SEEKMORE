                                    

import type {
  SkillDocumentDiagnostic,
  SkillImportInspection,
  SkillValidationSummary,
} from '../types/skill.types';

import { useLocalize } from '../../../../localization/useLocalize';

import type {
  SkillCreateMode,
  SkillImportRecognitionState,
} from './skill-create.types';

interface Props {

  busy: boolean;
  mode: SkillCreateMode;

  skillMarkdown: string;
  setSkillMarkdown: (
    value: string,
  ) => void;

  importContent: string;

  inspection:
    | SkillImportInspection
    | null;

  diagnostics:
    SkillDocumentDiagnostic[];

  validation:
    | SkillValidationSummary
    | null;

  recognitionState:
    SkillImportRecognitionState;
}

export default function SkillGenerationPreview({
    busy,
  mode,
  skillMarkdown,
  setSkillMarkdown,
  importContent,
  inspection,
  diagnostics,
  validation,
  recognitionState,
}: Props) {
  const localize = useLocalize();
  const panelClass = 'border-edge-soft bg-surface-soft text-theme-primary   ';

  const activeValidation =
    mode === 'IMPORT' && inspection
      ? inspection.validation
      : validation;

  const inspectionDiagnostics =
    inspection
      ? [
          ...(inspection.diagnostics ??
            []),
          ...(inspection.security
            ?.diagnostics ?? []),
        ]
      : [];

  const allDiagnostics =
    activeValidation?.diagnostics
      ?.length
      ? activeValidation.diagnostics
      : inspectionDiagnostics.length
        ? inspectionDiagnostics
        : diagnostics;

  const validationStatus =
    activeValidation
      ? activeValidation.accepted
        ? activeValidation.specCompliant
          ? {
              label: localize('skills.preview.standard'),
              className:
                'bg-emerald-500/10 text-emerald-500',
            }
          : {
              label: localize('skills.preview.compatible'),
              className:
                'bg-amber-500/10 text-amber-500',
            }
        : {
            label: localize('skills.preview.rejected'),
            className:
              'bg-red-500/10 text-red-400',
          }
      : null;

  const recognitionStatus =
    mode === 'IMPORT' &&
    recognitionState === 'INSPECTING'
      ? {
          label: localize('skills.preview.inspecting'),
          className:
            'bg-[#0c5cfb]/10 text-[#0c5cfb]',
        }
      : mode === 'IMPORT' &&
          recognitionState === 'WAITING'
        ? {
            label: localize('skills.preview.waiting'),
            className:
              'bg-[#000000]/5 opacity-55',
          }
        : null;

  const status =
    recognitionStatus ??
    validationStatus;

  const warningCount =
    allDiagnostics.filter(
      (item) =>
        item.severity === 'WARNING',
    ).length;

  const blockingCount =
    allDiagnostics.filter(
      (item) =>
        item.severity === 'ERROR' ||
        item.severity === 'CRITICAL',
    ).length;

  const editorValue =
    mode === 'IMPORT'
      ? inspection?.skillMarkdown ??
        importContent
      : skillMarkdown;

  return (
    <div
      className="
        flex
        min-h-0
        min-w-0
        flex-col
        p-[12px]
      "
    >
      <div
        className="
          mb-[8px]
          flex
          items-center
          justify-between
        "
      >
        <div>
          <div
            className="
              text-[11px]
              font-semibold
            "
          >
            SKILL.md
          </div>

          <div
            className="
              mt-[2px]
              text-[9px]
              opacity-50
            "
          >
            {mode === 'STANDARD'
              ? localize('skills.preview.standardHint')
              : localize('skills.preview.importHint')}
          </div>
        </div>

        {status && (
          <div
            className={`
              rounded-[6px]
              px-[7px]
              py-[4px]
              text-[9px]
              ${status.className}
            `}
          >
            {status.label}
          </div>
        )}
      </div>

      <textarea
        value={editorValue}
        disabled={
          busy ||
          mode === 'IMPORT'
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
          p-[11px]
          font-mono
          text-[11px]
          leading-[1.55]
          outline-none
          ${panelClass}
        `}
        placeholder={
          localize('skills.preview.template')
        }
      />

      {inspection && (
        <div
          className={`
            mt-[8px]
            max-h-[108px]
            overflow-y-auto
            rounded-[9px]
            border
            p-[8px]
            ${panelClass}
          `}
        >
          <div
            className="
              text-[9px]
              font-medium
            "
          >
            {localize('skills.preview.packageContent')} ·{' '}
            {inspection.displayName ||
              localize('skills.preview.untitled')}
          </div>

          <div
            className="
              mt-[4px]
              text-[9px]
              opacity-55
            "
          >
            {inspection.files.length
              ? inspection.files
                  .map(
                    (file) =>
                      file.path,
                  )
                  .join(' · ')
              : localize('skills.preview.onlySkillMd')}
          </div>
        </div>
      )}

      {activeValidation && (
        <div
          className={`
            mt-[8px]
            rounded-[9px]
            border
            p-[8px]
            text-[9px]
            ${panelClass}
          `}
        >
          {activeValidation.accepted ? (
            activeValidation.specCompliant ? (
              <span className="text-emerald-500">
                {localize('skills.preview.canRunStandard')}
              </span>
            ) : (
              <span className="text-amber-500">
                {localize('skills.preview.canRun')}
                {warningCount > 0
                  ? localize('skills.preview.warningCount', { count: warningCount })
                  : localize('skills.preview.compatibleSuffix')}
              </span>
            )
          ) : (
            <span className="text-red-400">
              {localize('skills.preview.rejected')}
              {blockingCount > 0
                ? localize('skills.preview.blockingCount', { count: blockingCount })
                : ''}
            </span>
          )}
        </div>
      )}

      {allDiagnostics.length > 0 && (
        <div
          className={`
            mt-[8px]
            max-h-[146px]
            overflow-y-auto
            rounded-[9px]
            border
            p-[8px]
            ${panelClass}
          `}
        >
          <div
            className="
              mb-[5px]
              text-[9px]
              font-medium
            "
          >
            {localize('skills.preview.diagnostics')}
          </div>

          <div className="space-y-[5px]">
            {allDiagnostics.map(
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
                        : item.severity ===
                            'WARNING'
                          ? 'text-amber-500'
                          : 'opacity-55'
                    }
                  `}
                >
                  {item.line
                    ? localize('skills.preview.linePrefix', {
                        line: item.line,
                        column: item.column ? `:${item.column}` : '',
                      })
                    : ''}

                  {item.field
                    ? `${item.field} · `
                    : ''}

                  {localize(`skills.diagnostic.${item.code}`, {
                    ...(item.params ?? {}),
                    defaultValue: item.message,
                  })}

                  {item.severity ===
                    'WARNING' && (
                    <span
                      className="
                        ml-[4px]
                        opacity-60
                      "
                    >
                      {localize('skills.preview.warningNonBlocking')}
                    </span>
                  )}
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}