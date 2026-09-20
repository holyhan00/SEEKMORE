import { useLocalize } from '../../../../localization/useLocalize';
                                                                   

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  deleteSkillFiles,
  listSkillFiles,
  uploadSkillFiles,
} from '../api/skill.api';

import type {
  SkillFileRecord,
  SkillFileTreeDirectoryNode,
  SkillFileUploadEntry,
} from '../types/skill.types';

import SkillFileTreeNode from './SkillFileTreeNode';
import SkillFileUploadTrigger from './SkillFileUploadTrigger';

import {
  buildSkillFileTree,
  collectDirectoryFiles,
} from './skill-file-tree.utils';

export default function SkillFileManager({
  skillId,
  versionId,
  isDraft,
  readOnly = false,
  onVersionChanged,
}: {
  skillId: string;
  versionId: string;
  isDraft: boolean;
  readOnly?: boolean;
  onVersionChanged?: (
    versionId: string,
  ) => void | Promise<void>;
}) {
  const localize = useLocalize();
  const [files, setFiles] =
    useState<SkillFileRecord[]>([]);

  const [busy, setBusy] =
    useState(false);

  const [busyLabel, setBusyLabel] =
    useState('');

  const [error, setError] =
    useState('');

  const [notice, setNotice] =
    useState('');

  const canEdit =
    isDraft && !readOnly;

  const refresh = useCallback(
    async (
      targetVersionId = versionId,
    ) => {
      try {
        const nextFiles =
          await listSkillFiles(
            skillId,
            targetVersionId,
          );

        setFiles(nextFiles);
        setError('');

        return nextFiles;
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : localize('skills.files.loadFailed'),
        );

        return null;
      }
    },
    [skillId, versionId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tree = useMemo(
    () => buildSkillFileTree(files),
    [files],
  );

  const applyRevision = useCallback(
    async (nextVersionId: string) => {
      await refresh(nextVersionId);
      await onVersionChanged?.(
        nextVersionId,
      );
    },
    [onVersionChanged, refresh],
  );

  const upload = useCallback(
    async (
      entries: SkillFileUploadEntry[],
    ) => {
      if (
        !canEdit ||
        busy ||
        entries.length === 0
      ) {
        return;
      }

      setBusy(true);
      setBusyLabel(
        localize('skills.files.uploading', { count: entries.length }),
      );
      setError('');
      setNotice('');

      try {
        const result =
          await uploadSkillFiles(
            skillId,
            versionId,
            entries,
          );

        await applyRevision(
          result.version.id,
        );

        setNotice(
          entries.length === 1
            ? localize('skills.files.uploadedOne', { path: entries[0].path })
            : localize('skills.files.uploadedMany', { count: entries.length }),
        );
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : localize('skills.files.uploadFailed'),
        );
      } finally {
        setBusy(false);
        setBusyLabel('');
      }
    },
    [
      applyRevision,
      busy,
      canEdit,
      skillId,
      versionId,
    ],
  );

  const removeFiles = useCallback(
    async (
      fileIds: string[],
      successMessage: string,
    ) => {
      if (
        !canEdit ||
        busy ||
        fileIds.length === 0
      ) {
        return;
      }

      setBusy(true);
      setBusyLabel(
        fileIds.length === 1
          ? localize('skills.files.deletingOne')
          : localize('skills.files.deletingMany', { count: fileIds.length }),
      );
      setError('');
      setNotice('');

      try {
        const result =
          await deleteSkillFiles(
            skillId,
            versionId,
            fileIds,
          );

        await applyRevision(
          result.version.id,
        );

        setNotice(successMessage);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : localize('skills.files.deleteFailed'),
        );
      } finally {
        setBusy(false);
        setBusyLabel('');
      }
    },
    [
      applyRevision,
      busy,
      canEdit,
      skillId,
      versionId,
    ],
  );

  const removeFile = useCallback(
    async (
      fileId: string,
      path: string,
    ) => {
      if (!canEdit) {
        return;
      }

      if (
        !window.confirm(
          localize('skills.files.confirmDeleteFile', { path }),
        )
      ) {
        return;
      }

      await removeFiles(
        [fileId],
        localize('skills.files.deletedFile', { path }),
      );
    },
    [
      canEdit,
      removeFiles,
    ],
  );

  const removeDirectory = useCallback(
    async (
      directory: SkillFileTreeDirectoryNode,
    ) => {
      if (!canEdit) {
        return;
      }

      const directoryFiles =
        collectDirectoryFiles(directory);

      if (directoryFiles.length === 0) {
        return;
      }

      if (
        !window.confirm(
          localize('skills.files.confirmDeleteDirectory', { path: directory.path, count: directoryFiles.length }),
        )
      ) {
        return;
      }

      await removeFiles(
        directoryFiles.map(
          (file) => file.id,
        ),
        localize('skills.files.deletedDirectory', { path: directory.path }),
      );
    },
    [
      canEdit,
      removeFiles,
    ],
  );

  return (
    <section className="min-w-0">
      <div className="flex items-center justify-between gap-[10px]">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold">
            {localize('skills.files.title')}
          </div>

          <div className="mt-[3px] text-[9px] opacity-45">
            {localize('skills.files.versionFileCount', { count: files.length })}
          </div>
        </div>

        {canEdit && (
          <SkillFileUploadTrigger
            targetDirectory=""
            allowDirectory
            disabled={busy}
            onSelect={upload}
            onError={(message) => {
              setNotice('');
              setError(message);
            }}
          />
        )}
      </div>

      {canEdit && (
        <div className="mt-[7px] text-[9px] leading-[1.5] opacity-45">
          {localize('skills.files.uploadHint')}
        </div>
      )}

      {busyLabel && (
        <div className="mt-[8px] text-[10px] text-[#0c5cfb]">
          {busyLabel}
        </div>
      )}

      {error && (
        <div className="mt-[8px] text-[10px] text-red-400">
          {error}
        </div>
      )}

      {notice && (
        <div className="mt-[8px] text-[10px] text-emerald-500">
          {notice}
        </div>
      )}

      <div className="mt-[10px] min-w-0 rounded-[9px] bg-[#000000]/[0.018] p-[5px] dark:border-[#ffffff]/[0.08] dark:bg-[#ffffff]/[0.025]">
        {tree.children.length > 0 ? (
          tree.children.map((node) => (
            <SkillFileTreeNode
              key={`${node.kind}:${node.path}`}
              node={node}
              isDraft={canEdit}
              busy={busy}
              onUpload={upload}
              onDeleteFile={removeFile}
              onDeleteDirectory={
                removeDirectory
              }
              onError={(message) => {
                setNotice('');
                setError(message);
              }}
            />
          ))
        ) : (
          <div className="flex min-h-[150px] items-center justify-center px-[20px] text-center text-[10px] leading-[1.6] opacity-45">
            {canEdit
              ? localize('skills.files.emptyEditable')
              : localize('skills.files.emptyReadonly')}
          </div>
        )}
      </div>
    </section>
  );
}