                                                                                         

import React, { useMemo } from 'react';
import { useLocalize } from '../../../../localization/useLocalize';
import type {
  CognitiveAgentKnowledgeFileSpec,
} from '../api/cognitive-agent.types';
import {
  buildKnowledgeFileSpec,
  COGNITIVE_AGENT_KNOWLEDGE_ACCEPT,
  inferKnowledgeObjectKind,
  stripKnowledgeFileExtension,
} from '../utils/cognitive-agent-knowledge.utils';

interface Props {
  files?: File[];
  specs?: CognitiveAgentKnowledgeFileSpec[];
  onChange: (files: File[]) => void;
  onSpecsChange?: (
    specs: CognitiveAgentKnowledgeFileSpec[],
  ) => void;

}

const CONTENT_MATERIAL_ROLE =
  'content_material' as const;

function formatSize(size: number): string {
  if (size < 1024) {
    return `${size}B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)}KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function getExt(fileName: string): string {
  return (
    fileName.split('.').pop()?.toUpperCase() ||
    'FILE'
  );
}

function getExtColor(ext: string): string {
  const map: Record<string, string> = {
    PDF: 'bg-[#ff5f57]',
    DOC: 'bg-[#4c9aff]',
    DOCX: 'bg-[#4c9aff]',
    XLS: 'bg-[#34c759]',
    XLSX: 'bg-[#34c759]',
    CSV: 'bg-[#34c759]',
    ZIP: 'bg-[#ffb340]',
    PPT: 'bg-[#ff7a59]',
    PPTX: 'bg-[#ff7a59]',
    JSON: 'bg-[#8b7cff]',
    MD: 'bg-[#777777]',
    TXT: 'bg-[#999999]',
    HTML: 'bg-[#ffb340]',
    HTM: 'bg-[#ffb340]',
  };

  return map[ext] || 'bg-[#5b8cff]';
}

const CognitiveAgentKnowledgeUpload: React.FC<
  Props
> = ({
  files = [],
  specs = [],
  onChange,
  onSpecsChange,
  }) => {
  const localize = useLocalize();
  const normalizedSpecs = useMemo(() => {
    return files.map((file, index) => {
      const current = specs[index];

      if (!current) {
        return buildKnowledgeFileSpec(
          file,
          index,
          CONTENT_MATERIAL_ROLE,
        );
      }

      return {
        ...current,
        fileIndex: index,
        originalName:
          current.originalName || file.name,
        name:
          current.name ||
          stripKnowledgeFileExtension(file.name),
        objectKind:
          current.objectKind ||
          inferKnowledgeObjectKind(file.name),
        objectRole:
          current.objectRole ||
          CONTENT_MATERIAL_ROLE,
        sortOrder:
          current.sortOrder ?? index,
      };
    });
  }, [files, specs]);

  const updateFiles = (
    nextFiles: File[],
    nextSpecs: CognitiveAgentKnowledgeFileSpec[],
  ) => {
    onChange(nextFiles);

    onSpecsChange?.(
      nextSpecs.map((spec, index) => ({
        ...spec,
        fileIndex: index,
        sortOrder:
          spec.sortOrder ?? index,
      })),
    );
  };

  const addFiles = (selected: File[]) => {
    if (!selected.length) {
      return;
    }

    const nextFiles = [
      ...files,
      ...selected,
    ];

    const nextSpecs = [
      ...normalizedSpecs,
      ...selected.map((file, index) =>
        buildKnowledgeFileSpec(
          file,
          files.length + index,
          CONTENT_MATERIAL_ROLE,
        ),
      ),
    ];

    updateFiles(nextFiles, nextSpecs);
  };

  const removeFile = (index: number) => {
    const nextFiles = files.filter(
      (_, fileIndex) => fileIndex !== index,
    );

    const nextSpecs = normalizedSpecs
      .filter(
        (_, specIndex) => specIndex !== index,
      )
      .map((spec, nextIndex) => ({
        ...spec,
        fileIndex: nextIndex,
        sortOrder: nextIndex,
      }));

    updateFiles(nextFiles, nextSpecs);
  };

  const uploadCardClass = [
    'group box-border flex h-[68px] w-full min-w-0 max-w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[14px] px-[10px] py-[6px] text-center transition-all',
    'bg-[#f3f4f6] hover:bg-[#e8ebf0] dark:bg-[#151515] dark:hover:bg-[#181818]',
  ].join(' ');

  const uploadIconClass = [
    'mb-[3px] flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-[8px] text-[14px] leading-none transition-all',
    'bg-surface-panel text-theme-muted-strong group-hover:bg-[#dde4f2] group-hover:text-[#0c5cfb]   dark:group-hover:text-[#d6deff]',
  ].join(' ');

  const titleClass = 'text-[12px] font-semibold leading-[14px] text-[#111111] dark:text-[12px] dark:font-semibold dark:leading-[14px] dark:text-[#f1f1f1]';

  const descClass = 'mt-[2px] w-full min-w-0 max-w-[240px] truncate text-[9px] leading-[11px] text-theme-muted-strong dark:mt-[2px] dark:w-full dark:min-w-0 dark:max-w-[240px] dark:truncate dark:text-[9px] dark:leading-[11px] ';

  return (
    <div className="w-full min-w-0 max-w-full">
      <div className="grid w-full min-w-0 max-w-full grid-cols-1 gap-[24px]">
        <div className="w-full min-w-0 max-w-full space-y-[8px]">
          <label className={uploadCardClass}>
            <input
              type="file"
              multiple
              accept={COGNITIVE_AGENT_KNOWLEDGE_ACCEPT}
              className="hidden"
              onChange={(event) => {
                const selected = Array.from(
                  event.target.files || [],
                );

                addFiles(selected);

                event.currentTarget.value = '';
              }}
            />

            <div className={uploadIconClass}>
              +
            </div>

            <div className={titleClass}>
              {localize('agents.knowledge.uploadContent')}
            </div>

            <div
              className={descClass}
              title={localize('agents.knowledge.uploadDescription')}
            >
              {localize('agents.knowledge.uploadDescription')}
            </div>
          </label>

          {files.length > 0 && (
            <div className="w-full min-w-0 max-w-full">
              <div
                className={[
                  'flex w-full min-w-0 max-w-full items-center justify-between text-[12px]',
                  'text-theme-muted-strong ',
                ].join(' ')}
              >
                <span>{localize('agents.knowledge.contentMaterials')}</span>

                <span className="shrink-0">
                  {localize('agents.knowledge.fileCount', { count: files.length })}
                </span>
              </div>

              {files.map((file, fileIndex) => {
                const ext = getExt(file.name);

                return (
                  <div
                    key={`${file.name}-${fileIndex}`}
                    className="flex w-full min-w-0 max-w-full items-start gap-[8px] overflow-hidden rounded-[10px] px-[2px] py-[2px]"
                  >
                    <div className="relative flex h-[32px] w-[32px] shrink-0 items-end justify-center rounded-[4px] bg-[#dcecff] pb-[4px]">
                      <span
                        className={[
                          'rounded-[2px] px-[4px] py-[2px] text-[8px] font-bold leading-none text-[#ffffff]',
                          getExtColor(ext),
                        ].join(' ')}
                      >
                        {ext.slice(0, 4)}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div
                        className={[
                          'block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium leading-5',
                          'text-[#333333] dark:text-[#eaeaea]',
                        ].join(' ')}
                        title={file.name}
                      >
                        {file.name}
                      </div>

                      <div
                        className={[
                          'mt-[1px] max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[10px] leading-4',
                          'text-[#aaaaaa] dark:text-[#777777]',
                        ].join(' ')}
                      >
                        {formatSize(file.size)} · {localize('agents.knowledge.contentMaterial')}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        removeFile(fileIndex)
                      }
                      className={[
                        'mt-[1px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full text-[13px] leading-none transition-all',
                        'bg-[#eeeeee] text-[#999999] hover:bg-[#e0e0e0] hover:text-[#555555] dark:bg-[#2a2a2a] dark:text-[#888888] dark:hover:bg-[#333333] dark:hover:text-[#ffffff]',
                      ].join(' ')}
                      aria-label={localize('common.actions.removeFile')}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CognitiveAgentKnowledgeUpload;
