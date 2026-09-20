import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  deleteCognitiveAgentKnowledge,
  listCognitiveAgentKnowledge,
  reparseCognitiveAgentKnowledge,
  uploadCognitiveAgentKnowledge,
} from '../api/cognitive-agent.api';
import type {
  CognitiveAgentKnowledgeFile,
} from '../api/cognitive-agent.types';
import {
  buildKnowledgeFileSpecs,
} from '../utils/cognitive-agent-knowledge.utils';

interface UseCognitiveAgentKnowledgeOptions {
  agentId?: string | null;
  enabled?: boolean;
  pollIntervalMs?: number;
}

function requestMessage(
  reason: unknown,
  fallback: string,
): string {
  if (
    reason instanceof Error &&
    reason.message
  ) {
    return reason.message;
  }

  return fallback;
}

export function useCognitiveAgentKnowledge({
  agentId,
  enabled = true,
  pollIntervalMs = 2500,
}: UseCognitiveAgentKnowledgeOptions) {
  const [files, setFiles] = useState<
    CognitiveAgentKnowledgeFile[]
  >([]);
  const [loading, setLoading] =
    useState(false);
  const [uploading, setUploading] =
    useState(false);
  const [reparsing, setReparsing] =
    useState(false);
  const [deletingId, setDeletingId] =
    useState<string | null>(null);
  const [error, setError] =
    useState('');

  const requestRevisionRef = useRef(0);

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!enabled || !agentId) {
        setFiles([]);
        return [] as CognitiveAgentKnowledgeFile[];
      }

      const requestRevision =
        ++requestRevisionRef.current;

      if (!options?.silent) {
        setLoading(true);
      }

      try {
        const nextFiles =
          await listCognitiveAgentKnowledge(
            agentId,
          );

        if (
          requestRevision ===
          requestRevisionRef.current
        ) {
          setFiles(nextFiles);
          setError('');
        }

        return nextFiles;
      } catch (reason) {
        if (
          requestRevision ===
          requestRevisionRef.current
        ) {
          setError(
            requestMessage(
              reason,
              '[CognitiveKnowledge] Load failed',
            ),
          );
        }

        return [] as CognitiveAgentKnowledgeFile[];
      } finally {
        if (
          !options?.silent &&
          requestRevision ===
            requestRevisionRef.current
        ) {
          setLoading(false);
        }
      }
    },
    [agentId, enabled],
  );

  useEffect(() => {
    if (!enabled || !agentId) {
      requestRevisionRef.current += 1;
      setFiles([]);
      setError('');
      setLoading(false);
      return;
    }

    void refresh();
  }, [agentId, enabled, refresh]);

  const hasProcessing = useMemo(
    () =>
      files.some(
        (file) =>
          file.parseStatus === 'PENDING' ||
          file.parseStatus === 'PARSING',
      ),
    [files],
  );

  useEffect(() => {
    if (
      !enabled ||
      !agentId ||
      !hasProcessing
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refresh({ silent: true });
    }, pollIntervalMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    agentId,
    enabled,
    hasProcessing,
    pollIntervalMs,
    refresh,
    files,
  ]);

  const uploadFiles = useCallback(
    async (selectedFiles: File[]) => {
      if (!agentId || !selectedFiles.length) {
        return null;
      }

      requestRevisionRef.current += 1;
      setUploading(true);
      setError('');

      try {
        const nextFiles =
          await uploadCognitiveAgentKnowledge(
            agentId,
            {
              files: selectedFiles,
              specs:
                buildKnowledgeFileSpecs(
                  selectedFiles,
                ),
            },
          );

        setFiles(nextFiles);
        return nextFiles;
      } catch (reason) {
        setError(
          requestMessage(
            reason,
            '[CognitiveKnowledge] Upload failed',
          ),
        );
        return null;
      } finally {
        setUploading(false);
      }
    },
    [agentId],
  );

  const deleteFile = useCallback(
    async (fileId: string) => {
      if (!agentId || !fileId) {
        return false;
      }

      requestRevisionRef.current += 1;
      setDeletingId(fileId);
      setError('');

      try {
        await deleteCognitiveAgentKnowledge(
          agentId,
          fileId,
        );

        setFiles((current) =>
          current.filter(
            (file) => file.id !== fileId,
          ),
        );

        return true;
      } catch (reason) {
        setError(
          requestMessage(
            reason,
            '[CognitiveKnowledge] Delete failed',
          ),
        );
        return false;
      } finally {
        setDeletingId(null);
      }
    },
    [agentId],
  );

  const reparseAll = useCallback(
    async () => {
      if (!agentId || !files.length) {
        return false;
      }

      requestRevisionRef.current += 1;
      setReparsing(true);
      setError('');

      try {
        await reparseCognitiveAgentKnowledge(
          agentId,
        );

        setFiles((current) =>
          current.map((file) => ({
            ...file,
            parseStatus: 'PENDING',
            parseError: null,
          })),
        );

        void refresh({ silent: true });
        return true;
      } catch (reason) {
        setError(
          requestMessage(
            reason,
            '[CognitiveKnowledge] Reparse failed',
          ),
        );
        return false;
      } finally {
        setReparsing(false);
      }
    },
    [agentId, files.length, refresh],
  );

  return {
    files,
    loading,
    uploading,
    reparsing,
    deletingId,
    error,
    hasProcessing,
    searchAvailable: files.some(
      (file) => file.parseStatus === 'READY',
    ),
    refresh,
    uploadFiles,
    deleteFile,
    reparseAll,
  };
}
