import { resolveAssetUrl } from '../../../../utils/asset-url';
                                                                    

import { useState } from 'react';
import { useLocalize } from '../../../../localization/useLocalize';

import type {
  SkillFileTreeDirectoryNode,
  SkillFileTreeNode as SkillFileTreeNodeRecord,
  SkillFileUploadEntry,
} from '../types/skill.types';

import SkillFileUploadTrigger from './SkillFileUploadTrigger';

import {
  countDirectoryFiles,
  formatSkillFileSize,
} from './skill-file-tree.utils';

interface SkillFileTreeNodeProps {
  node: SkillFileTreeNodeRecord;
  depth?: number;
  isDraft: boolean;
  busy: boolean;
  onUpload: (
    entries: SkillFileUploadEntry[],
  ) => void | Promise<void>;
  onDeleteFile: (
    fileId: string,
    path: string,
  ) => void | Promise<void>;
  onDeleteDirectory: (
    directory: SkillFileTreeDirectoryNode,
  ) => void | Promise<void>;
  onError: (message: string) => void;
}

export default function SkillFileTreeNode({
  node,
  depth = 0,
  isDraft,
  busy,
  onUpload,
  onDeleteFile,
  onDeleteDirectory,
  onError,
}: SkillFileTreeNodeProps) {
  const localize = useLocalize();
  const [expanded, setExpanded] =
    useState(true);

  const indent = depth * 15;

  if (node.kind === 'file') {
    return (
      <div
        className="
          group
          flex
          min-w-0
          items-center
          gap-[7px]
          rounded-[7px]
          px-[7px]
          py-[6px]
          text-[10px]
          hover:bg-[#000000]/[0.035]
          dark:hover:bg-[#ffffff]/[0.045]
        "
        style={{
          paddingLeft: indent + 27,
        }}
        title={node.path}
      >
        <span
          aria-hidden="true"
          className="
            shrink-0
            text-[12px]
            opacity-45
          "
        >
          ▦
        </span>

        <div className="min-w-0 flex-1">
          <div className="truncate">
            {node.name}
          </div>

          <div
            className="
              mt-[2px]
              truncate
              text-[8px]
              opacity-40
            "
          >
            {node.file.fileType} ·{' '}
            {formatSkillFileSize(
              node.file.sizeBytes,
            )}
          </div>
        </div>

        {isDraft && (
          <button
            type="button"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();

              void onDeleteFile(
                node.file.id,
                node.path,
              );
            }}
            className="
              flex
              h-[24px]
              shrink-0
              items-center
              justify-center
              rounded-[6px]
              bg-[#e5e7eb]
              px-[7px]
              text-[9px]
              text-[#6b7280]
              outline-none
              transition-colors
              hover:bg-[#d8dbe0]
              disabled:cursor-not-allowed
              disabled:opacity-25
              dark:bg-[#303030]
              dark:text-[#b5b5b5]
              dark:hover:bg-[#383838]
            "
          >
            {localize('common.actions.delete')}
          </button>
        )}
      </div>
    );
  }

  const fileCount =
    countDirectoryFiles(node);

  return (
    <div className="min-w-0">
      <div
        className="
          group
          flex
          min-w-0
          items-center
          gap-[6px]
          rounded-[7px]
          py-[6px]
          hover:bg-[#000000]/[0.035]
          dark:hover:bg-[#ffffff]/[0.045]
        "
        style={{}}
      >
        <img
          src={resolveAssetUrl('/icons/blue/libraryblue.svg')}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="
            h-[13px]
            w-[13px]
            shrink-0
            object-contain
          "
        />

        <button
          type="button"
          onClick={() =>
            setExpanded(
              (value) => !value,
            )
          }
          className="
            min-w-0
            flex-1
            truncate
            text-left
            text-[12px]
            font-medium
            outline-none
          "
          title={node.path}
        >
          {node.name}

          <span
            className="
              ml-[10px]
              text-[10px]
              font-normal
              opacity-35
            "
          >
            {fileCount}
          </span>
        </button>

        {isDraft && (
          <div
            className="
              flex
              shrink-0
              items-center
              gap-[4px]
            "
          >
            <SkillFileUploadTrigger
              compact
              targetDirectory={
                node.path
              }
              allowDirectory={false}
              disabled={busy}
              onSelect={onUpload}
              onError={onError}
            />

            <button
              type="button"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();

                void onDeleteDirectory(
                  node,
                );
              }}
              className="
                flex
                h-[24px]
                shrink-0
                items-center
                justify-center
                rounded-[6px]
                bg-[#e5e7eb]
                px-[7px]
                text-[9px]
                text-[#6b7280]
                outline-none
                transition-colors
                hover:bg-[#d8dbe0]
                disabled:cursor-not-allowed
                disabled:opacity-25
                dark:bg-[#303030]
                dark:text-[#b5b5b5]
                dark:hover:bg-[#383838]
              "
            >
              {localize('common.actions.delete')}
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="min-w-0">
          {node.children.map(
            (child) => (
              <SkillFileTreeNode
                key={`${child.kind}:${child.path}`}
                node={child}
                depth={depth + 1}
                isDraft={isDraft}
                busy={busy}
                onUpload={onUpload}
                onDeleteFile={
                  onDeleteFile
                }
                onDeleteDirectory={
                  onDeleteDirectory
                }
                onError={onError}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}