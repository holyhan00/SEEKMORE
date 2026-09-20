                                                                         

import { useLocalize } from '../../../../localization/useLocalize';
import {
  useRef,
  useState,
} from 'react';

import type {
  SkillFileUploadEntry,
} from '../types/skill.types';

import {
  prepareSkillFileUploadEntries,
  type SkillFileSelectionKind,
} from './skill-file-tree.utils';

interface SkillFileUploadTriggerProps {
  targetDirectory: string;
  allowDirectory?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onSelect: (
    entries: SkillFileUploadEntry[],
  ) => void | Promise<void>;
  onError: (message: string) => void;
}

export default function SkillFileUploadTrigger({
  targetDirectory,
  allowDirectory = false,
  disabled = false,
  compact = false,
  onSelect,
  onError,
}: SkillFileUploadTriggerProps) {
  const localize = useLocalize();

  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  const [selecting, setSelecting] =
    useState(false);

  const acceptSelection = async (
    selectedFiles: File[],
    selectionKind: SkillFileSelectionKind,
  ) => {
    if (selectedFiles.length === 0) {
      return;
    }

    try {
      const entries =
        prepareSkillFileUploadEntries(
          selectedFiles,
          targetDirectory,
          selectionKind,
        );

      if (entries.length === 0) {
        onError(
          localize('skills.files.noneUploadable'),
        );

        return;
      }

      await onSelect(entries);
    } catch (reason) {
      onError(
        reason instanceof Error
          ? reason.message
          : localize('skills.files.selectionFailed'),
      );
    }
  };

  const selectFromDesktop = async () => {
    const desktopFiles =
      window.seekmoreDesktop?.files;

    if (!desktopFiles) {
      fileInputRef.current?.click();

      return;
    }

    setSelecting(true);

    try {
      const selection =
        await desktopFiles.selectForUpload({
          allowDirectories:
            allowDirectory,
          multiple: true,
        });

      if (
        selection.canceled ||
        selection.files.length === 0
      ) {
        return;
      }

      const files =
        selection.files.map(
          (selectedFile) =>
            createBrowserFile(
              selectedFile,
            ),
        );

      await acceptSelection(
        files,
        selection.selectionKind,
      );
    } catch (reason) {
      onError(
        reason instanceof Error
          ? reason.message
          : localize('skills.files.desktopSelectionFailed'),
      );
    } finally {
      setSelecting(false);
    }
  };

  const blocked =
    disabled || selecting;

  return (
    <div
      data-desktop-no-drag
      className="
        relative
        shrink-0
      "
    >
      <button
        type="button"
        disabled={blocked}
        aria-label={
          compact
            ? localize('skills.files.addToDirectory', { directory: targetDirectory })
            : allowDirectory
              ? localize('skills.files.uploadFilesOrFolder')
              : localize('skills.files.uploadFiles')
        }
        onClick={(event) => {
          event.stopPropagation();

          void selectFromDesktop();
        }}
        className={
          compact
            ? `
                flex
                h-[24px]
                w-[24px]
                items-center
                justify-center
                rounded-[6px]
                bg-action-primary
                text-[14px]
                font-medium
                leading-none
                !text-[#ffffff]
                outline-none
                transition-colors
                hover:bg-action-primary-hover
                hover:!text-[#ffffff]
                disabled:cursor-not-allowed
                disabled:opacity-25
              `
            : `
                flex
                h-[30px]
                items-center
                justify-center
                rounded-[8px]
                bg-action-primary
                px-[11px]
                text-[10px]
                font-medium
                text-[#ffffff]
                outline-none
                transition-colors
                hover:bg-action-primary-hover
                disabled:cursor-not-allowed
                disabled:opacity-40
              `
        }
      >
        {compact
          ? '+'
          : selecting
            ? localize('skills.files.reading')
            : localize('skills.files.upload')}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        disabled={blocked}
        onChange={(event) => {
          const selectedFiles =
            Array.from(
              event.currentTarget.files ??
                [],
            );

          event.currentTarget.value =
            '';

          void acceptSelection(
            selectedFiles,
            'FILES',
          );
        }}
      />
    </div>
  );
}

function createBrowserFile(
  selectedFile: SeekmoreDesktopUploadFile,
): File {
  const buffer =
    base64ToArrayBuffer(
      selectedFile.contentBase64,
    );

  const file = new File(
    [buffer],
    selectedFile.name,
    {
      type:
        selectedFile.mimeType ||
        'application/octet-stream',
      lastModified:
        selectedFile.lastModified,
    },
  );

  Object.defineProperty(
    file,
    'webkitRelativePath',
    {
      configurable: true,
      enumerable: true,
      value:
        selectedFile.relativePath,
    },
  );

  return file;
}

function base64ToArrayBuffer(
  value: string,
): ArrayBuffer {
  const binary = atob(value);

  const buffer = new ArrayBuffer(
    binary.length,
  );

  const bytes = new Uint8Array(
    buffer,
  );

  for (
    let index = 0;
    index < binary.length;
    index += 1
  ) {
    bytes[index] =
      binary.charCodeAt(index);
  }

  return buffer;
}