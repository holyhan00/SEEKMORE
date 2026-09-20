import { useAppearance } from '../../../theme/useAppearance';
                                                                

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { resolveAssetUrl } from '../../../utils/asset-url';
import {
  useAuthenticatedImageUrl,
} from '../../../hooks/useAuthenticatedImageUrl';

import type {
  CognitiveAgent,
  CognitiveAgentKnowledgeFile,
} from '.';
import ConfirmModal from '../../../common/modals/ConfirmModal';
import {
  getAgentSkillBindings,
} from '../skill/api/skill.api';
import type {
  AgentSkillBindingRecord,
} from '../skill/types/skill.types';
import { useFormatter } from '../../../localization/useFormatter';
import { useLocalize } from '../../../localization/useLocalize';
import { localizeApiError } from '../../../localization/localizeApiError';
import { useSystemResourcePresentation } from '../../../localization/useSystemResourcePresentation';
import { getSkillDisplayName } from '../skill/shared/skill-display-name';
import {
  deleteCognitiveAgent,
  getCognitiveAgent,
} from './api/cognitive-agent.api';
import { useCognitiveAgentKnowledge } from './hooks/useCognitiveAgentKnowledge';
import { COGNITIVE_AGENT_KNOWLEDGE_ACCEPT } from './utils/cognitive-agent-knowledge.utils';
import CognitiveAgentEditModal from './modals/CognitiveAgentEditModal';

interface AgentDetailViewProps {
  agent: CognitiveAgent;

  onBack: () => void;
  onGoChat?: (agent: CognitiveAgent) => void;
  onEdit?: (agent: CognitiveAgent) => void;
  onDelete?: (agent: CognitiveAgent) => void;
  onChanged?: () => void | Promise<void>;
}

type AgentDetailAgent = CognitiveAgent & {
  isSuper?: boolean;
  systemPrompt?: string | null;
  visibility?: string | null;
};

function formatSize(
  size?: number | null,
): string {
  if (!size) {
    return '0B';
  }

  if (size < 1024) {
    return `${size}B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)}KB`;
  }

  return `${(
    size /
    1024 /
    1024
  ).toFixed(1)}MB`;
}

function formatMimeType(
  type?: string | null,
): string {
  if (!type) {
    return 'FILE';
  }

  const map: Record<string, string> = {
    'application/pdf': 'PDF',
    'text/plain': 'TXT',
    'text/markdown': 'Markdown',
    'application/json': 'JSON',
    'text/html': 'HTML',
    'application/msword': 'Word',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'Word',
    'application/vnd.ms-excel': 'Excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      'Excel',
    'text/csv': 'CSV',
  };

  return map[type] || 'FILE';
}

function safeDisplayName(
  name: string | null | undefined,
  fallback: string,
): string {
  if (!name) {
    return fallback;
  }

  try {
    return decodeURIComponent(
      escape(name),
    );
  } catch {
    return name;
  }
}

function knowledgeStatusLabel(
  status: CognitiveAgentKnowledgeFile['parseStatus'],
  localize: (key: string) => string,
): string {
  return localize(`agents.knowledge.status.${status}`);
}

function knowledgeStatusClass(
  status: CognitiveAgentKnowledgeFile['parseStatus'],
): string {
  switch (status) {
    case 'READY':
      return 'bg-emerald-500/10 text-emerald-500';
    case 'PARSING':
      return 'bg-blue-500/10 text-blue-500';
    case 'FAILED':
      return 'bg-red-500/10 text-red-500';
    case 'PENDING':
    default:
      return 'bg-amber-500/10 text-amber-500';
  }
}

const AgentDetailView: React.FC<
  AgentDetailViewProps
> = ({
  agent: initialAgent,
    onBack,
  onGoChat,
  onEdit,
  onDelete,
  onChanged,
}) => {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const formatter = useFormatter();
  const systemPresentation = useSystemResourcePresentation();

  const formatDateTime = useCallback(
    (value?: string | Date | null): string => {
      if (!value) {
        return localize('common.notAvailable');
      }

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return localize('common.notAvailable');
      }

      return formatter.formatDateTime(date, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    },
    [formatter, localize],
  );

  const [currentAgent, setCurrentAgent] =
    useState<CognitiveAgent>(initialAgent);

  const {
    files: knowledgeFiles,
    loading: knowledgeLoading,
    uploading: knowledgeUploading,
    reparsing: knowledgeReparsing,
    deletingId: deletingKnowledgeId,
    error: knowledgeError,
    hasProcessing: knowledgeHasProcessing,
    searchAvailable: knowledgeSearchAvailable,
    refresh: refreshKnowledge,
    uploadFiles: uploadKnowledgeFiles,
    deleteFile: deleteKnowledgeFile,
    reparseAll: reparseKnowledge,
  } = useCognitiveAgentKnowledge({
    agentId: currentAgent.id,
    enabled:
      currentAgent.entityType === 'COGNITIVE',
  });

  const knowledgeInputRef =
    useRef<HTMLInputElement | null>(null);

  const [knowledgeDeleteTarget, setKnowledgeDeleteTarget] =
    useState<CognitiveAgentKnowledgeFile | null>(null);

  const [editOpen, setEditOpen] =
    useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] =
    useState(false);

  const [deleting, setDeleting] =
    useState(false);

  const [skillBindings, setSkillBindings] =
    useState<AgentSkillBindingRecord[]>([]);

  const [skillLoading, setSkillLoading] =
    useState(false);

  const [skillError, setSkillError] =
    useState('');

  const refreshSkillBindings = useCallback(
    async (
      targetAgent: CognitiveAgent,
    ) => {
      if (
        targetAgent.entityType !==
        'COGNITIVE'
      ) {
        setSkillBindings([]);
        setSkillError('');
        setSkillLoading(false);
        return;
      }

      setSkillLoading(true);
      setSkillError('');

      try {
        const response =
          await getAgentSkillBindings(
            targetAgent.id,
          );

        setSkillBindings(
          response.bindings ?? [],
        );
      } catch (reason) {
        setSkillBindings([]);
        setSkillError(
          localizeApiError(reason, 'agents.skills.loadFailed'),
        );
      } finally {
        setSkillLoading(false);
      }
    },
    [localize],
  );

  useEffect(() => {
    setCurrentAgent(initialAgent);
    void refreshSkillBindings(
      initialAgent,
    );
  }, [
    initialAgent,
    refreshSkillBindings,
  ]);

  useEffect(() => {
    const handlePermanentSkillDelete = () => {
      void refreshSkillBindings(currentAgent);
    };

    window.addEventListener(
      'skill:permanently-deleted',
      handlePermanentSkillDelete,
    );

    return () => {
      window.removeEventListener(
        'skill:permanently-deleted',
        handlePermanentSkillDelete,
      );
    };
  }, [currentAgent, refreshSkillBindings]);

  const agent = currentAgent;
  const detailAgent =
    agent as AgentDetailAgent;
  const isSuper = Boolean(
    detailAgent.isSuper,
  );
  const type = localize('agents.type.cognitive');
  const displayedDescription = systemPresentation.systemAgentDescription({
    key: detailAgent.key,
    isSuper,
    fallback: agent.description,
  });
  const knowledgeSearchEnabled =
    agent.knowledgeEnabled !== false &&
    knowledgeSearchAvailable;
  const avatarSourceUrl = resolveAssetUrl(
    agent.avatarUrl
    ?? agent.avatarKey,
    {
      version:
        agent.avatarUpdatedAt,
    },
  );
  const coverSourceUrl = resolveAssetUrl(
    agent.coverUrl
    ?? agent.coverKey,
    {
      version:
        agent.coverUpdatedAt,
    },
  );

  const avatarUrl =
    useAuthenticatedImageUrl(avatarSourceUrl);
  const coverUrl =
    useAuthenticatedImageUrl(coverSourceUrl);

  const pageBg = 'bg-surface-page-soft text-theme-strong  ';

  const cardBg = 'bg-surface-raised';

  const softBg = 'bg-[#f7f8fb] dark:bg-[#151515]';


  const muted = 'text-theme-muted-solid ';

  const metricBg = 'bg-surface-base';

  const secondaryButton = [
    'h-[40px]',
    'w-full',
    'rounded-[10px]',
    'text-[13px]',
    'transition-all',
    'disabled:cursor-not-allowed',
    'disabled:opacity-50',
    'hover:bg-[#f2f3f7] dark:hover:bg-[#262626]',
  ].join(' ');

  const handleKnowledgeInputChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const selected = Array.from(
      event.target.files || [],
    );

    event.currentTarget.value = '';

    if (!selected.length) {
      return;
    }

    const uploaded =
      await uploadKnowledgeFiles(selected);

    if (uploaded) {
      await onChanged?.();
    }
  };

  const handleConfirmKnowledgeDelete = async () => {
    const target = knowledgeDeleteTarget;

    if (!target) {
      return;
    }

    const deleted =
      await deleteKnowledgeFile(target.id);

    if (!deleted) {
      return;
    }

    setKnowledgeDeleteTarget(null);
    await onChanged?.();
  };

  const handleReparseKnowledge = async () => {
    const reparsed = await reparseKnowledge();

    if (reparsed) {
      await onChanged?.();
    }
  };

  const handleGoChat = () => {
    onGoChat?.(agent);

    sessionStorage.setItem(
      'pending-open-agent-id',
      agent.id,
    );

    sessionStorage.setItem(
      'pending-open-agent',
      JSON.stringify(agent),
    );

    window.dispatchEvent(
      new CustomEvent('agentChat:open', {
        detail: {
          agentId: agent.id,
          agent,
        },
      }),
    );

    window.dispatchEvent(
      new CustomEvent('changeView', {
        detail: 'chat',
      }),
    );
  };

  const handleOpenEdit = () => {
    onEdit?.(agent);

    if (
      agent.entityType === 'COGNITIVE'
    ) {
      setEditOpen(true);
      return;
    }

    window.alert(
      localize('agents.detail.unsupportedEditor'),
    );
  };

  const handleDelete = () => {
    onDelete?.(agent);

    if (
      agent.entityType !== 'COGNITIVE'
    ) {
      window.alert(
        localize('agents.detail.unsupportedDelete'),
      );
      return;
    }

    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete =
    async () => {
      setDeleting(true);

      try {
        await deleteCognitiveAgent(
          agent.id,
        );

        sessionStorage.removeItem(
          'pending-open-agent-id',
        );

        sessionStorage.removeItem(
          'pending-open-agent',
        );

        window.dispatchEvent(
          new CustomEvent(
            'agent:deleted',
            {
              detail: {
                agentId: agent.id,
              },
            },
          ),
        );

        await onChanged?.();
        setDeleteConfirmOpen(false);
        onBack();
      } catch {
        window.alert(
          localize('agents.detail.deleteFailed'),
        );
      } finally {
        setDeleting(false);
      }
    };

  const renderTypeEditor = () => {
    if (
      agent.entityType !== 'COGNITIVE'
    ) {
      return null;
    }

    return (
      <CognitiveAgentEditModal
        open={editOpen}
        agentId={agent.id}

        onClose={() =>
          setEditOpen(false)
        }
        onUpdated={async () => {
          const latest =
            await getCognitiveAgent(
              agent.id,
            );

          setCurrentAgent(latest);

          await Promise.all([
            refreshSkillBindings(latest),
            refreshKnowledge(),
          ]);

          await onChanged?.();
        }}
      />
    );
  };

  return (
    <div
      data-agent-detail-page
      className={`h-full w-full select-none overflow-y-auto [&_button]:!select-none [&_button_*]:!select-none ${pageBg}`}
    >
      <div className="mx-auto box-border w-full max-w-[1180px] px-[28px] py-[24px]">
        <div
          className={`overflow-hidden rounded-[24px] shadow-sm ${cardBg}`}
        >
          <div className="relative h-[160px] w-full overflow-hidden">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={localize('agents.coverAlt', { name: agent.name })}
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div
                className="h-full w-full bg-cover bg-center"
                style={{
                  backgroundImage: `url("${
                    isDarkTheme
                      ? resolveAssetUrl('/backgrounds/agent-card-dark.jpg')
                      : resolveAssetUrl('/backgrounds/agent-card-light.jpg')
                  }")`,
                }}
              />
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-[#000000]/65 via-[#000000]/15 to-transparent" />

            <button
              type="button"
              onClick={onBack}
              aria-label={localize('common.back')}
              className={[
                'absolute',
                'left-[10px]',
                'top-[10px]',
                'z-20',
                'flex',
                'h-[32px]',
                'w-[32px]',
                'items-center',
                'justify-center',
                'rounded-full',
                'text-[12px]',
                'transition-all',
                'bg-[#ffffff]/20 text-[#a8a8a8] hover:bg-[#f2f3f7] dark:bg-[#1a1a1a]/20 dark:text-[#d8d8d8] dark:hover:bg-[#242424]',
              ].join(' ')}
            >
              <span className="block text-[18px] leading-none">
                ←
              </span>
            </button>

            <div className="absolute bottom-[22px] left-[28px] right-[28px] flex min-w-0 items-end gap-[18px]">
              <div
                className={`flex h-[88px] w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-[18px] text-[40px] font-bold shadow-lg ${
                  'bg-accent-surface text-accent-foreground  '
                }`}
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={localize('agents.avatarAlt', { name: agent.name })}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  agent.name
                    ?.trim()
                    ?.[0]
                    ?.toUpperCase() || 'A'
                )}
              </div>

              <div className="grid h-[76px] min-w-0 flex-1 self-end grid-rows-[34px_40px] overflow-hidden">
                <div className="flex h-[34px] min-w-0 flex-nowrap items-center gap-[10px] overflow-hidden">
                  <h1
                    className="min-w-0 max-w-[620px] flex-1 truncate text-[28px] font-bold leading-tight text-theme-primary"
                    title={agent.name}
                  >
                    {agent.name}
                  </h1>

                  <span
                    className={`box-border flex h-[24px] shrink-0 items-center rounded-full px-[10px] text-[11px] backdrop-blur ${
                      'bg-surface-pill text-theme-strong  '
                    }`}
                  >
                    {type}
                  </span>


                  {isSuper && (
                    <span
                      className={`box-border flex h-[24px] shrink-0 items-center rounded-full px-[10px] text-[10px] backdrop-blur ${
                        'bg-surface-pill text-theme-strong  '
                      }`}
                    >
                      {localize('agents.systemDefault')}
                    </span>
                  )}
                </div>

                <p
                  className="m-0 max-w-[760px] break-words text-[10px] text-theme-head-description"
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient:
                      'vertical',
                    WebkitLineClamp: 2,
                    lineHeight: '20px',
                    maxHeight: '40px',
                    overflow: 'hidden',
                  }}
                  title={
                    displayedDescription ||
                    localize('common.noDescription')
                  }
                >
                  {displayedDescription ||
                    localize('common.noDescription')}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_240px] gap-[10px] p-[10px]">
            <div className="min-w-0 space-y-[10px]">
              <section
                className={`rounded-[10px] px-[10px] py-[10px] ${softBg}`}
              >
                <input
                  ref={knowledgeInputRef}
                  type="file"
                  multiple
                  accept={COGNITIVE_AGENT_KNOWLEDGE_ACCEPT}
                  className="hidden"
                  onChange={handleKnowledgeInputChange}
                />

                <div className="flex items-center justify-between gap-[10px]">
                  <div className="min-w-0">
                    <h2 className="text-[14px] font-semibold">
                      {localize('agents.knowledge.title')}
                    </h2>

                    <div
                      className={`mt-[3px] text-[9px] ${muted}`}
                    >
                      {localize('agents.knowledge.search')} ·{' '}
                      <span
                        className={
                          knowledgeSearchEnabled
                            ? 'text-emerald-500'
                            : muted
                        }
                      >
                        {knowledgeSearchEnabled
                          ? localize('agents.knowledge.available')
                          : knowledgeFiles.length > 0
                            ? localize('agents.knowledge.waitingReady')
                            : localize('agents.knowledge.noSearchable')}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-[6px]">
                    <span
                      className={`text-[10px] ${muted}`}
                    >
                      {localize('agents.knowledge.fileCount', { count: knowledgeFiles.length })}
                    </span>

                    {!isSuper && knowledgeFiles.length > 0 && (
                      <button
                        type="button"
                        disabled={
                          knowledgeReparsing ||
                          knowledgeHasProcessing ||
                          knowledgeUploading
                        }
                        onClick={() => {
                          void handleReparseKnowledge();
                        }}
                        className={[
                          'rounded-[7px] px-[7px] py-[4px] text-[9px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                          'hover:bg-[#eceef3] dark:hover:bg-[#262626]',
                        ].join(' ')}
                      >
                        {knowledgeReparsing ||
                        knowledgeHasProcessing
                          ? localize('agents.knowledge.parsing')
                          : localize('agents.knowledge.reparse')}
                      </button>
                    )}

                    {!isSuper && (
                      <button
                        type="button"
                        disabled={
                          knowledgeUploading ||
                          knowledgeReparsing ||
                          knowledgeHasProcessing
                        }
                        onClick={() =>
                          knowledgeInputRef.current?.click()
                        }
                        className={[
                          'rounded-[7px] px-[7px] py-[4px] text-[9px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                          'bg-[#eceef3] hover:bg-[#e1e4ea] dark:bg-[#262626] dark:hover:bg-[#303030]',
                        ].join(' ')}
                      >
                        {knowledgeUploading
                          ? localize('agents.knowledge.uploading')
                          : localize('agents.knowledge.add')}
                      </button>
                    )}
                  </div>
                </div>

                {knowledgeError && (
                  <div className="mt-[8px] rounded-[8px] bg-red-500/5 px-[9px] py-[7px] text-[9px] text-red-400">
                    {knowledgeError}
                  </div>
                )}

                <div className="mt-[10px] space-y-[8px]">
                  {knowledgeLoading ? (
                    <div
                      className={`rounded-[10px] p-[16px] text-[10px] ${muted}`}
                    >
                      {localize('agents.knowledge.loading')}
                    </div>
                  ) : knowledgeFiles.length > 0 ? (
                    knowledgeFiles.map((file) => (
                      <div
                        key={file.id}
                        className={`rounded-[10px] px-[10px] py-[9px] ${metricBg}`}
                      >
                        <div className="flex min-w-0 items-center gap-[8px]">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[10px] font-medium">
                              {safeDisplayName(
                                file.originalName,
                                localize('common.untitledFile'),
                              )}
                            </div>

                            <div
                              className={`mt-[4px] flex flex-wrap items-center gap-x-[10px] gap-y-[3px] text-[9px] ${muted}`}
                            >
                              <span>
                                {formatMimeType(
                                  file.mimeType,
                                )}
                              </span>
                              <span>
                                {formatSize(
                                  file.sizeBytes,
                                )}
                              </span>
                              <span>
                                {localize('agents.knowledge.chunkCount', {
                                  count:
                                    file.chunkCount ??
                                    file._count?.chunks ??
                                    0,
                                })}
                              </span>
                              {file.embeddingModel && (
                                <span
                                  className="max-w-[180px] truncate"
                                  title={file.embeddingModel}
                                >
                                  {file.embeddingModel}
                                </span>
                              )}
                            </div>
                          </div>

                          <span
                            className={`shrink-0 rounded-full px-[7px] py-[3px] text-[9px] ${knowledgeStatusClass(
                              file.parseStatus,
                            )}`}
                          >
                            {knowledgeStatusLabel(
                              file.parseStatus,
                              localize,
                            )}
                          </span>

                          {!isSuper && (
                            <button
                              type="button"
                              disabled={
                                deletingKnowledgeId ===
                                  file.id ||
                                file.parseStatus ===
                                  'PENDING' ||
                                file.parseStatus ===
                                  'PARSING'
                              }
                              onClick={() =>
                                setKnowledgeDeleteTarget(
                                  file,
                                )
                              }
                              className={[
                                'shrink-0 rounded-[7px] px-[6px] py-[4px] text-[9px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                'text-[#999999] hover:bg-[#eeeeee] hover:text-red-500 dark:text-[#8f8f8f] dark:hover:bg-[#2a2a2a] dark:hover:text-red-400',
                              ].join(' ')}
                            >
                              {deletingKnowledgeId ===
                              file.id
                                ? localize('common.actions.deleting')
                                : localize('common.actions.delete')}
                            </button>
                          )}
                        </div>

                        {file.parseError && (
                          <div className="mt-[6px] break-words text-[9px] text-red-400">
                            {file.parseError}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div
                      className={`rounded-[10px] p-[16px] text-[10px] ${muted}`}
                    >
                      {localize('agents.knowledge.empty')}
                    </div>
                  )}
                </div>
              </section>

              <section
                className={`rounded-[10px] px-[10px] py-[10px] ${softBg}`}
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-[14px] font-semibold">
                    {localize('agents.skills.title')}
                  </h2>

                  <span
                    className={`text-[10px] ${muted}`}
                  >
                    {localize('agents.skills.count', { count: skillBindings.length })}
                  </span>
                </div>

                <div className="mt-[10px] space-y-[10px]">
                  {skillLoading ? (
                    <div
                      className={`rounded-[10px] p-[16px] text-[10px] ${muted}`}
                    >
                      {localize('skills.loadingBindings')}
                    </div>
                  ) : skillError ? (
                    <div className="rounded-[10px] bg-red-500/5 p-[16px] text-[10px] text-red-400">
                      {skillError}
                    </div>
                  ) : skillBindings.length >
                    0 ? (
                    skillBindings.map(
                      (binding) => {
                        const skill =
                          binding.skill;

                        const versionLabel =
                          binding.pinnedVersion
                            ?.versionLabel ??
                          skill.currentVersion
                            ?.versionLabel ??
                          localize('skills.version.none');
                        const displayName =
                          getSkillDisplayName(skill);
                        const deleted = Boolean(
                          skill.deletedAt,
                        );
                        const activationLabel = localize(
                          `skills.agentActivation.${binding.effectiveActivationMode}`,
                        );

                        return (
                          <div
                            key={binding.id}
                            className={`grid min-w-0 grid-cols-[40px_minmax(0,1fr)_78px] items-center gap-[10px] overflow-hidden rounded-[10px] px-[10px] py-[10px] ${metricBg} ${deleted ? 'opacity-55 grayscale' : ''}`}
                          >
                            <div
                              className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-[15px] font-semibold ${
                                'bg-accent-surface text-accent-foreground  '
                              }`}
                            >
                              {skill.iconUrl ? (
                                <img
                                  src={
                                    skill.iconUrl
                                  }
                                  alt={localize('common.iconAlt', { name: displayName })}
                                  className="h-full w-full object-cover"
                                  draggable={
                                    false
                                  }
                                />
                              ) : (
                                displayName
                                  ?.trim()
                                  ?.[0]
                                  ?.toUpperCase() ||
                                'S'
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-[8px]">
                                <span
                                  className="min-w-0 flex-1 truncate text-[10px] font-medium"
                                  title={displayName}
                                >
                                  {displayName}
                                </span>

                                {deleted && (
                                  <span className="shrink-0 rounded-full bg-status-danger-soft px-[6px] py-[2px] text-[8px] text-status-danger">
                                    {localize('common.status.deleted')}
                                  </span>
                                )}

                                <span
                                  className={`max-w-[76px] shrink-0 truncate text-[9px] ${muted}`}
                                  title={activationLabel}
                                >
                                  {activationLabel}
                                </span>
                              </div>

                              <div
                                className={`mt-[4px] min-w-0 break-words text-[9px] ${muted}`}
                                style={{
                                  display: '-webkit-box',
                                  WebkitBoxOrient: 'vertical',
                                  WebkitLineClamp: 2,
                                  lineHeight: '14px',
                                  maxHeight: '28px',
                                  overflow: 'hidden',
                                }}
                                title={skill.description || localize('common.noDescription')}
                              >
                                {skill.description || localize('common.noDescription')}
                              </div>
                            </div>

                            <div className="min-w-0 text-right">
                              <div
                                className="truncate text-[9px] font-medium"
                                title={versionLabel}
                              >
                                {versionLabel}
                              </div>

                              <div
                                className={`mt-[4px] text-[9px] ${muted}`}
                              >
                                {localize('common.priority')}{' '}
                                {
                                  binding.priority
                                }
                              </div>
                            </div>
                          </div>
                        );
                      },
                    )
                  ) : (
                    <div
                      className={`rounded-[10px] p-[16px] text-[10px] ${muted}`}
                    >
                      {localize('agents.skills.empty')}
                    </div>
                  )}
                </div>
              </section>

              <section
                className={`rounded-[10px] px-[10px] py-[10px] ${softBg}`}
              >
                <h2 className="text-[14px] font-semibold">
                  {localize('agents.role.title')}
                </h2>

                <p
                  className={`mt-[10px] whitespace-pre-wrap break-words text-[10px] leading-6 ${muted}`}
                >
                  {agent.rolePrompt ||
                    detailAgent.systemPrompt ||
                    localize('agents.role.empty')}
                </p>
              </section>
            </div>

            <aside className="min-w-0 space-y-[10px]">
              <section
                className={`rounded-[10px] px-[10px] py-[10px] ${softBg}`}
              >
                <h2 className="text-[14px] font-semibold">
                  {localize('common.actions.title')}
                </h2>

                <div className="mt-[10px] space-y-[10px]">
                  <button
                    type="button"
                    onClick={handleGoChat}
                    className="h-[40px] w-full rounded-[10px] bg-action-primary text-[14px] font-medium text-[#ffffff] transition-all hover:bg-action-primary-hover hover:text-[#ffffff]"
                  >
                    {localize('agents.actions.goChat')}
                  </button>

                  {!isSuper && (
                    <button
                      type="button"
                      onClick={
                        handleOpenEdit
                      }
                      className={
                        secondaryButton
                      }
                    >
                      {localize('agents.actions.edit')}
                    </button>
                  )}

                  {!isSuper && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="mb-[10px] h-[40px] w-full rounded-[10px] text-[13px] text-status-danger transition-all hover:bg-status-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deleting
                        ? localize('common.actions.deleting')
                        : localize('agents.actions.delete')}
                    </button>
                  )}
                </div>
              </section>

              <section
                className={`rounded-[10px] px-[10px] py-[10px] ${softBg}`}
              >
                <h2 className="text-[14px] font-semibold">
                  {localize('common.basicInfo')}
                </h2>

                <div className="mb-[10px] mt-[10px] space-y-[10px] text-[10px]">
                  <InfoRow
                    label={localize('common.type')}
                    value={type}
                    muted={muted}
                  />

                  <InfoRow
                    label={localize('common.visibility')}
                    value={
                      detailAgent.visibility ||
                      'PRIVATE'
                    }
                    muted={muted}
                  />


                  <InfoRow
                    label={localize('common.createdAt')}
                    value={formatDateTime(
                      agent.createdAt,
                    )}
                    muted={muted}
                  />

                  <InfoRow
                    label={localize('common.updatedAt')}
                    value={formatDateTime(
                      agent.updatedAt,
                    )}
                    muted={muted}
                  />

                  <InfoRow
                    label={localize('agents.knowledge.title')}
                    value={localize('agents.knowledge.fileCount', { count: knowledgeFiles.length })}
                    muted={muted}
                  />

                  <InfoRow
                    label={localize('agents.skills.title')}
                    value={localize('agents.skills.count', { count: skillBindings.length })}
                    muted={muted}
                  />
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>

      {renderTypeEditor()}

      <ConfirmModal
        isOpen={Boolean(knowledgeDeleteTarget)}

        title={localize('agents.knowledge.deleteConfirmTitle')}
        description={
          knowledgeDeleteTarget
            ? localize('agents.knowledge.deleteConfirmDescription', {
                name: safeDisplayName(
                  knowledgeDeleteTarget.originalName,
                  localize('common.untitledFile'),
                ),
              })
            : ''
        }
        confirmText={
          deletingKnowledgeId
            ? localize('common.actions.deleting')
            : localize('common.actions.delete')
        }
        cancelText={localize('common.actions.cancel')}
        danger
        onClose={() => {
          if (!deletingKnowledgeId) {
            setKnowledgeDeleteTarget(null);
          }
        }}
        onConfirm={() => {
          void handleConfirmKnowledgeDelete();
        }}
      />

      <ConfirmModal
        isOpen={deleteConfirmOpen}

        title={localize('agents.delete.confirmTitle')}
        description={localize('agents.delete.confirmDescription')}
        confirmText={
          deleting ? localize('common.actions.deleting') : localize('common.actions.delete')
        }
        cancelText={localize('common.actions.cancel')}
        danger
        onClose={() => {
          if (!deleting) {
            setDeleteConfirmOpen(false);
          }
        }}
        onConfirm={() => {
          if (!deleting) {
            void handleConfirmDelete();
          }
        }}
      />
    </div>
  );
};

const InfoRow: React.FC<{
  label: string;
  value: React.ReactNode;
  muted: string;
}> = ({
  label,
  value,
  muted,
}) => {
  return (
    <div className="flex items-center justify-between gap-[10px]">
      <span
        className={`shrink-0 ${muted}`}
      >
        {label}
      </span>

      <span
        className="min-w-0 truncate text-right"
        title={
          typeof value === 'string'
            ? value
            : undefined
        }
      >
        {value}
      </span>
    </div>
  );
};

export default AgentDetailView;
