                                                                           

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocalize } from '../../../../localization/useLocalize';
import clsx from 'clsx';
import { FolderOpen } from 'lucide-react';
import { createRuntimeWorkspace } from './runtime-workspace.api';
import type { RuntimeWorkspaceView } from './runtime-workspace.types';
import { useDesktopRuntime } from '../../../../runtime/desktop/useDesktopRuntime';

type FloatingRect = {
  left: number;
  bottom: number;
};

type Props = {

  open: boolean;
  anchorRect: FloatingRect | null;
  onClose: () => void;
  onCreated: (workspace: RuntimeWorkspaceView) => void;
};

type RequestErrorResponse = {
  response?: {
    data?: {
      message?: string | string[];
      error?: string;
    };
  };
};

function getRequestErrorMessage(error: unknown): string {
  const requestError = error as RequestErrorResponse;
  const responseData = requestError.response?.data;
  const responseMessage = responseData?.message;

  if (Array.isArray(responseMessage)) {
    const normalized = responseMessage
      .map((item) => String(item).trim())
      .filter(Boolean);

    if (normalized.length > 0) {
      return normalized.join('；');
    }
  }

  if (typeof responseMessage === 'string' && responseMessage.trim()) {
    return responseMessage.trim();
  }

  if (typeof responseData?.error === 'string' && responseData.error.trim()) {
    return responseData.error.trim();
  }

  if (error instanceof Error) {
    return error.message;
  }

  return '';
}

function maskLocalPath(value: string): string {
  const match = value.match(/^\/Users\/[^/]+(\/.*)?$/);
  return match ? `~${match[1] ?? ''}` : value;
}

export default function WorkspaceCreateDialog({
    open,
  anchorRect,
  onClose,
  onCreated,
}: Props) {
  const localize = useLocalize();
  const desktopRuntime = useDesktopRuntime();
  const [name, setName] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectingDirectory, setSelectingDirectory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName('');
    setParentPath('');
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting || selectingDirectory) {
      return;
    }

    onClose();
  }, [onClose, selectingDirectory, submitting]);

  const chooseParentDirectory = useCallback(async () => {
    if (desktopRuntime.phase === 'web') {
      setError(localize('workspace.create.desktopOnly'));
      return;
    }
    if (desktopRuntime.phase === 'unknown') {
      setError(localize('workspace.create.bridgeLoading'));
      return;
    }

    if (!desktopRuntime.bridgeReady || !desktopRuntime.capabilities.workspace) {
      setError(localize('workspace.create.bridgeFailed'));
      return;
    }

    const picker = window.seekmoreDesktop?.workspace?.selectDirectory;
    if (!picker) {
      setError(localize('workspace.create.bridgeFailed'));
      return;
    }

    setSelectingDirectory(true);
    setError(null);

    try {
      const selection = await picker();
      if (selection.canceled || !selection.rootPath) return;
      setParentPath(selection.rootPath);
    } catch (selectionError) {
      console.error('[Workspace] Directory picker failed', selectionError);
      setError(localize('workspace.create.openPickerFailed'));
    } finally {
      setSelectingDirectory(false);
    }
  }, [desktopRuntime]);

  const submit = useCallback(async () => {
    if (submitting || selectingDirectory) {
      return;
    }

    const cleanName = name.trim();
    const cleanParentPath = parentPath.trim();

    if (!cleanName) {
      setError(localize('workspace.create.nameRequired'));
      return;
    }

    if (!cleanParentPath) {
      setError(localize('workspace.create.locationRequired'));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const workspace = await createRuntimeWorkspace({
        name: cleanName,
        rootPath: cleanParentPath,
        source: 'desktop_picker',
      });

      onCreated(workspace);
      resetForm();
      onClose();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }, [
    name,
    onClose,
    onCreated,
    parentPath,
    resetForm,
    selectingDirectory,
    submitting,
  ]);

  if (!open || !anchorRect || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      style={{
        left: anchorRect.left,
        bottom: anchorRect.bottom,
      }}
      className={clsx(
        'fixed z-[10001] w-[340px] rounded-[18px] border p-[12px] shadow-[10px_10px_30px_rgba(0,0,0,0.12)]',
        'border-[#dddddd] bg-[#f8f8f8] text-[#111] dark:border-[#ffffff]/10 dark:bg-[#202020] dark:text-[#ffffff]',
      )}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <input
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          if (error) setError(null);
        }}
        placeholder={localize('workspace.create.namePlaceholder')}
        aria-label={localize('workspace.create.name')}
        disabled={submitting || selectingDirectory}
        className={clsx(
          'h-[36px] w-full rounded-[12px] border px-3 text-[13px] outline-none',
          'disabled:cursor-not-allowed disabled:opacity-60',
          'border-[#dddddd] bg-[#ffffff] text-[#111] placeholder:text-[#999] dark:border-[#ffffff]/10 dark:bg-[#ffffff]/5 dark:text-[#ffffff] dark:placeholder:text-neutral-500',
        )}
        autoFocus
      />

      <div className="mt-2 flex gap-2">
        <div
          className={clsx(
            'flex h-[36px] min-w-0 flex-1 items-center rounded-[12px] border px-3 text-[12px]',
            'border-[#dddddd] bg-[#ffffff] text-theme-caption dark:border-[#ffffff]/10 dark:bg-[#ffffff]/5 ',
          )}
          title={parentPath || localize('workspace.create.locationUnset')}
        >
          <span className="truncate">
            {parentPath ? maskLocalPath(parentPath) : localize('workspace.create.locationUnset')}
          </span>
        </div>

        <button
          type="button"
          onClick={() => void chooseParentDirectory()}
          disabled={submitting || selectingDirectory}
          className={clsx(
            'inline-flex h-[36px] shrink-0 items-center gap-2 rounded-[12px] px-3 text-[12px] font-medium transition',
            'disabled:cursor-not-allowed disabled:opacity-60',
            'bg-[#eeeeee] text-[#444] hover:bg-[#e5e5e5] dark:bg-[#ffffff]/10 dark:text-[#ffffff] dark:hover:bg-[#ffffff]/15',
          )}
        >
          <FolderOpen className="h-[15px] w-[15px]" strokeWidth={2} />
          {selectingDirectory ? localize('workspace.create.selecting') : localize('workspace.create.selectLocation')}
        </button>
      </div>

      {error ? (
        <div role="alert" className="mt-2 text-[12px] leading-5 text-red-400">
          {error}
        </div>
      ) : null}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={handleClose}
          disabled={submitting || selectingDirectory}
          className={clsx(
            'h-[32px] rounded-full px-4 text-[13px]',
            'disabled:cursor-not-allowed disabled:opacity-60',
            'bg-[#eeeeee] text-[#555] hover:bg-[#e5e5e5] dark:bg-[#ffffff]/10 dark:text-[#ffffff] dark:hover:bg-[#ffffff]/15',
          )}
        >
          {localize('common.actions.cancel')}
        </button>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || selectingDirectory}
          className={clsx(
            'h-[32px] rounded-full px-4 text-[13px] font-medium',
            'disabled:cursor-not-allowed',
            submitting ? 'opacity-60' : '',
            'bg-[#111] text-[#ffffff] hover:bg-[#333] dark:bg-[#ffffff] dark:text-[#000000] dark:hover:bg-neutral-200',
          )}
        >
          {submitting ? localize('workspace.create.creating') : localize('workspace.create.createAndSelect')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
