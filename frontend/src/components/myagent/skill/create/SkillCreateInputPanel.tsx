                                   
import type {
  Dispatch,
  SetStateAction,
} from 'react';

import { useLocalize } from '../../../../localization/useLocalize';

import type {
  SkillCreateMode,
  SkillImportRecognitionState,
  SkillMetadataEntry,
} from './skill-create.types';

interface Props {

  busy: boolean;
  mode: SkillCreateMode;
  inputClass: string;
  sectionClass: string;

  name: string;
  setName: (value: string) => void;

  description: string;
  setDescription: (value: string) => void;

  license: string;
  setLicense: (value: string) => void;

  compatibility: string;
  setCompatibility: (
    value: string,
  ) => void;

  metadata: SkillMetadataEntry[];
  setMetadata: Dispatch<
    SetStateAction<
      SkillMetadataEntry[]
    >
  >;

  allowedTools: string;
  setAllowedTools: (
    value: string,
  ) => void;

  importFile: File | null;
  setImportFile: (
    value: File | null,
  ) => void;

  repositoryUrl: string;
  setRepositoryUrl: (
    value: string,
  ) => void;

  importContent: string;
  setImportContent: (
    value: string,
  ) => void;

  recognitionState: SkillImportRecognitionState;

  onSwitchMode: (
    mode: SkillCreateMode,
  ) => void;
}

export default function SkillCreateInputPanel(
  props: Props,
) {
  const {
        busy,
    mode,
    inputClass,
    sectionClass,
    name,
    setName,
    description,
    setDescription,
    license,
    setLicense,
    compatibility,
    setCompatibility,
    metadata,
    setMetadata,
    allowedTools,
    setAllowedTools,
    importFile,
    setImportFile,
    repositoryUrl,
    setRepositoryUrl,
    importContent,
    setImportContent,
    recognitionState,
    onSwitchMode,
  } = props;
  const localize = useLocalize();

  const labelClass =
    'mb-[5px] block text-[10px] font-medium';

  const recognitionLabel = (() => {
    switch (recognitionState) {
      case 'WAITING':
        return {
          text: localize('skills.create.recognition.waiting'),
          className: 'opacity-50',
        };

      case 'INSPECTING':
        return {
          text: localize('skills.create.recognition.inspecting'),
          className: 'text-[#0c5cfb]',
        };

      case 'ACCEPTED_STANDARD':
        return {
          text: localize('skills.create.recognition.standard'),
          className:
            'text-emerald-500',
        };

      case 'ACCEPTED_COMPATIBLE':
        return {
          text: localize('skills.create.recognition.compatible'),
          className: 'text-amber-500',
        };

      case 'REJECTED':
        return {
          text: localize('skills.create.recognition.rejected'),
          className: 'text-red-400',
        };

      default:
        return {
          text: localize('skills.create.recognition.idle'),
          className: 'opacity-45',
        };
    }
  })();

  return (
    <div
      className="
        min-h-0
        overflow-y-auto
        border-r
        border-inherit
        p-[12px]
      "
    >
      <div
        className={`
          mb-[10px]
          flex
          rounded-[8px]
          p-[2px]
          ${
            'bg-[#f2f2f2] dark:bg-[#151515]'
          }
        `}
      >
        {(
          [
            'STANDARD',
            'IMPORT',
          ] as const
        ).map((item) => (
          <button
            key={item}
            type="button"
            disabled={busy}
            onClick={() =>
              onSwitchMode(item)
            }
            className={`
              flex-1
              rounded-[6px]
              px-[8px]
              py-[6px]
              text-[10px]
              transition
              ${
                mode === item
                  ? 'bg-[#ffffff] text-theme-primary shadow-sm dark:bg-[#2b2b2b] '
                  : 'opacity-55'
              }
            `}
          >
            {item === 'STANDARD'
              ? localize('skills.editor.createTitle')
              : localize('skills.create.importTitle')}
          </button>
        ))}
      </div>

      {mode === 'STANDARD' ? (
        <div className="space-y-[9px]">
          <div className={sectionClass}>
            <label
              className={labelClass}
            >
              {localize('skills.editor.name')}{' '}
              <span className="text-red-400">
                *
              </span>
            </label>

            <input
              value={name}
              disabled={busy}
              onChange={(event) =>
                setName(
                  event.target.value,
                )
              }
              className={inputClass}
              placeholder={localize('skills.editor.namePlaceholder')}
            />

            <p
              className="
                mt-[5px]
                text-[9px]
                leading-[1.45]
                opacity-50
              "
            >
              {localize('skills.create.nameHint')}
            </p>
          </div>

          <div className={sectionClass}>
            <label
              className={labelClass}
            >
              {localize('skills.create.instructions')}{' '}
              <span className="text-red-400">
                *
              </span>
            </label>

            <textarea
              value={description}
              disabled={busy}
              maxLength={1024}
              onChange={(event) =>
                setDescription(
                  event.target.value,
                )
              }
              className={`
                ${inputClass}
                min-h-[86px]
                resize-y
              `}
              placeholder={localize('skills.create.instructionsPlaceholder')}
            />

            <div
              className="
                mt-[4px]
                text-right
                text-[9px]
                opacity-45
              "
            >
              {description.length}/1024
            </div>
          </div>

          <div className={sectionClass}>
            <label
              className={labelClass}
            >
              {localize('skills.create.license')}{' '}
              <span
                className="
                  font-normal
                  opacity-45
                "
              >
                {localize('common.optional')}
              </span>
            </label>

            <input
              value={license}
              disabled={busy}
              onChange={(event) =>
                setLicense(
                  event.target.value,
                )
              }
              className={inputClass}
              placeholder="MIT"
            />
          </div>

          <div className={sectionClass}>
            <label
              className={labelClass}
            >
              {localize('skills.create.compatibility')}{' '}
              <span
                className="
                  font-normal
                  opacity-45
                "
              >
                {localize('common.optional')}
              </span>
            </label>

            <textarea
              value={compatibility}
              disabled={busy}
              maxLength={500}
              onChange={(event) =>
                setCompatibility(
                  event.target.value,
                )
              }
              className={`
                ${inputClass}
                min-h-[60px]
                resize-y
              `}
              placeholder={localize('skills.create.compatibilityPlaceholder')}
            />

            <div
              className="
                mt-[4px]
                text-right
                text-[9px]
                opacity-45
              "
            >
              {compatibility.length}/500
            </div>
          </div>

          <div className={sectionClass}>
            <div
              className="
                mb-[6px]
                flex
                items-center
                justify-between
              "
            >
              <label
                className="
                  text-[10px]
                  font-medium
                "
              >
                metadata{' '}
                <span
                  className="
                    font-normal
                    opacity-45
                  "
                >
                  {localize('common.optional')}
                </span>
              </label>

              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setMetadata(
                    (current) => [
                      ...current,
                      {
                        id: crypto.randomUUID(),
                        key: '',
                        value: '',
                      },
                    ],
                  )
                }
                className="
                  text-[9px]
                  opacity-65
                  disabled:cursor-not-allowed
                  disabled:opacity-35
                "
              >
                {localize('common.actions.add')}
              </button>
            </div>

            <div className="space-y-[6px]">
              {metadata.map((row) => (
                <div
                  key={row.id}
                  className="
                    grid
                    grid-cols-[1fr_1fr_auto]
                    gap-[5px]
                  "
                >
                  <input
                    className={inputClass}
                    disabled={busy}
                    value={row.key}
                    placeholder="key"
                    onChange={(event) =>
                      setMetadata(
                        (current) =>
                          current.map(
                            (item) =>
                              item.id ===
                              row.id
                                ? {
                                    ...item,
                                    key: event
                                      .target
                                      .value,
                                  }
                                : item,
                          ),
                      )
                    }
                  />

                  <input
                    className={inputClass}
                    disabled={busy}
                    value={row.value}
                    placeholder="value"
                    onChange={(event) =>
                      setMetadata(
                        (current) =>
                          current.map(
                            (item) =>
                              item.id ===
                              row.id
                                ? {
                                    ...item,
                                    value:
                                      event
                                        .target
                                        .value,
                                  }
                                : item,
                          ),
                      )
                    }
                  />

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setMetadata(
                        (current) =>
                          current.filter(
                            (item) =>
                              item.id !==
                              row.id,
                          ),
                      )
                    }
                    className="
                      px-[4px]
                      text-[12px]
                      opacity-45
                      disabled:opacity-25
                    "
                  >
                    ×
                  </button>
                </div>
              ))}

              {!metadata.length && (
                <div
                  className="
                    text-[9px]
                    opacity-40
                  "
                >
                  {localize('skills.create.metadataHint')}
                </div>
              )}
            </div>
          </div>

          <div className={sectionClass}>
            <label
              className={labelClass}
            >
              {localize('skills.create.allowedTools')}{' '}
              <span
                className="
                  font-normal
                  opacity-45
                "
              >
                {localize('skills.create.optionalExperimental')}
              </span>
            </label>

            <input
              value={allowedTools}
              disabled={busy}
              onChange={(event) =>
                setAllowedTools(
                  event.target.value,
                )
              }
              className={inputClass}
              placeholder="read_file search"
            />

            <p
              className="
                mt-[5px]
                text-[9px]
                leading-[1.45]
                opacity-50
              "
            >
              {localize('skills.create.allowedToolsHint')}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-[9px]">
          <div className={sectionClass}>
            <label
              className={labelClass}
            >
              {localize('skills.create.skillPackage')}
            </label>

            <input
              type="file"
              accept=".zip,.md,.markdown,.txt"
              disabled={busy}
              onChange={(event) =>
                setImportFile(
                  event.target.files?.[0] ??
                    null,
                )
              }
              className="
                block
                w-full
                text-[10px]
              "
            />

            {importFile && (
              <div
                className="
                  mt-[5px]
                  truncate
                  text-[9px]
                  opacity-60
                "
              >
                {importFile.name}
              </div>
            )}

            <div
              className={`
                mt-[6px]
                text-[9px]
                ${recognitionLabel.className}
              `}
            >
              {recognitionLabel.text}
            </div>
          </div>

          <div className={sectionClass}>
            <label
              className={labelClass}
            >
              {localize('skills.create.repositoryUrl')}
            </label>

            <input
              value={repositoryUrl}
              disabled={busy}
              onChange={(event) =>
                setRepositoryUrl(
                  event.target.value,
                )
              }
              className={inputClass}
              placeholder="https://github.com/owner/repository/tree/main/skill"
            />

            <p
              className="
                mt-[5px]
                text-[9px]
                opacity-45
              "
            >
              {localize('skills.create.autoRecognizeAfterInput')}
            </p>
          </div>

          <div className={sectionClass}>
            <label
              className={labelClass}
            >
              {localize('skills.create.rawMarkdown')}
            </label>

            <textarea
              value={importContent}
              disabled={busy}
              onChange={(event) =>
                setImportContent(
                  event.target.value,
                )
              }
              className={`
                ${inputClass}
                min-h-[210px]
                resize-y
                font-mono
              `}
              placeholder={
                localize('skills.create.importPlaceholder')
              }
            />

            <p
              className="
                mt-[5px]
                text-[9px]
                opacity-45
              "
            >
              {localize('skills.create.autoRecognizeAfterInput')}
            </p>
          </div>

          <p
            className="
              px-[2px]
              text-[9px]
              leading-[1.5]
              opacity-50
            "
          >
            {localize('skills.create.importPreserveHint')}
          </p>
        </div>
      )}
    </div>
  );
}