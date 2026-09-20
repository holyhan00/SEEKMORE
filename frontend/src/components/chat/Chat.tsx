//frontend/src/components/chat/Chat.tsx                                        
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { Dispatch, FC, SetStateAction } from "react";
import {
  useRecoilValue,
  useSetRecoilState,
  useRecoilState,
  useRecoilCallback,
} from "recoil";
import ChatHead from "./ChatHead";
import ChatInput from "./ChatInput";
import VirtualMessageList, {
  type VirtualMessageListHandle,
  type VisibleMessageRange,
} from "./ChatMessage/VirtualMessageList";
import TurnMinimap from "./navigation/TurnMinimap";
import {
  buildTurnNavigationAnchors,
  resolveActiveTurnId,
} from "./navigation/turn-navigation";
import type { Message } from "../../utils/types";
import { useSocket } from "./hooks/useSocket";
import { cn } from "../../lib/utils";
import { useLocalize } from "../../localization/useLocalize";
import {
  formatFileSize,
  inferFileType,
  uploadFileAsset,
  isUnsupportedObjectUploadError,
} from "../../lib/file-runtime-api";
import {
  CHAT_PENDING_FILE_LIMIT,
  type ChatPendingFile,
} from "./file-upload.types";
import {
  messageListState,
  messageMapState,
  selectedAgentIdState,
  selectedConversationIdState,
  chatConversationTurnState,
} from "./store/chatState";
import { useChatComposerController } from "./composer/useChatComposerController";
import JumpToBottomButton from "../ui/JumpToBottomButton";
import { useSmartAction } from "./hooks/useSmartAction";
import { useChatTitle } from "./hooks/useChatTitle";
import { useNewConversation } from "./hooks/useNewConversation";
import { useConversationBranch } from "./hooks/useConversationBranch";
import type { ConversationBranchResponse } from "../../lib/conversation-branch-api";
import ToastCard from "../ui/ToastCard";
import ConfirmModal from "../../common/modals/ConfirmModal";
import { createConversation } from "../../lib/api";
import { modelSettingsApi } from "../settings/model/model-settings.api";
import type { UserLlmSettings } from "../settings/model/model-settings.types";
import { runtimeEventListState } from "./runtime/store/runtimeEventState";
import { normalizeRuntimeEvent } from "./runtime/events/runtime-events.types";
import type { RuntimeApprovalDecision } from "./runtime/approval/runtimeApprovalClient";
import RuntimeControlPanel from "./RuntimeControlPanel";
import {
  conversationRuntimeSettingsState,
} from "./runtime/workspace/runtimeWorkspaceState";
import {
  normalizeConversationRuntimeSettings,
  updateConversationRuntimeSettings,
} from "./runtime/workspace/runtime-workspace.api";
import type {
  RuntimeConversationSettingsView,
  RuntimePermissionMode,
  RuntimeWorkspaceView,
} from "./runtime/workspace/runtime-workspace.types";
import {
  reduceRuntimeEvents,
  mergeRuntimeTimelineStates,
  upsertRuntimeEvent,
} from "./runtime/store/runtimeEventReducer";
import { getRuntimeTimeline } from "./runtime/api/runtime-timeline.api";
import WorkflowLine from "./runtime/workflow/WorkflowLine";
import { useActiveWorkflow } from "./runtime/workflow/useActiveWorkflow";
import { activeWorkflowState, workflowStateFromSnapshot } from "./runtime/workflow/workflowState";
import type { ActiveWorkflowLoadState } from "./runtime/workflow/workflow.types";
import { getChatBootstrap } from "./runtime/bootstrap/chat-bootstrap.api";
import { chatHydrationState } from "./runtime/bootstrap/chatHydrationState";
import { emptyRuntimeTimelineState } from "./runtime/store/runtimeEventState";
import {
  emptyChatTurnState,
  reduceChatTurnState,
  type ChatConversationTurnState,
} from "./store/chat-turn-state.reducer";
import ChatWelcome from "./welcome/ChatWelcome";
import type { ChatWelcomeAction } from "./welcome/chat-welcome.config";
import { useChatWelcomeVisibility } from "./welcome/useChatWelcomeVisibility";
import LiveObjectPreviewSync from "./object-preview/LiveObjectPreviewSync";
import {
  getCurrentUserIdFromToken,
  inferOptimisticTitle,
  createUploadClientId,
  ensureAssistantShell,
  mergeBootstrapMessages,
  normalizeUploadedFileCard,
  mapHistoryToMessages,
  pendingFileToMessageObject,
  projectMessage,
} from "./Chat.utils";

interface ChatProps {

  collapsed?: boolean;
  setCollapsed?: Dispatch<SetStateAction<boolean>>;
  onOpenModelSettings?: () => void;
}


const Chat: FC<ChatProps> = ({
    collapsed = false,
  setCollapsed,
  onOpenModelSettings,
}) => {
  const localize = useLocalize();
  useSmartAction();

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showEmptyToast, setShowEmptyToast] = useState(false);
  const [showMissingLlmSettings, setShowMissingLlmSettings] =
    useState(false);
  const [toastKey, setToastKey] = useState(0);

  const virtuosoRef =
    useRef<VirtualMessageListHandle>(null);
  const pendingTopUserMessageRef = useRef<{
    conversationId: string;
    messageId: string;
  } | null>(null);
  const pendingBootstrapBottomRef =
    useRef<string | null>(null);
  const pendingSubmissionsRef =
    useRef<Map<
      string,
      {
        conversationId: string;
        objects: Message['objects'];
        runtimeOptions: Message['runtimeOptions'];
      }
    >>(new Map());
  const [chatAtBottom, setChatAtBottom] =
    useState(true);
  const [
    visibleMessageRange,
    setVisibleMessageRange,
  ] = useState<VisibleMessageRange>({
    startIndex: 0,
    endIndex: 0,
  });
  const [bootstrapScrollVersion, setBootstrapScrollVersion] =
    useState(0);
  const llmPreflightRef = useRef(false);

  const isSelectingRef = useRef(false);

  const agentId = useRecoilValue(selectedAgentIdState);
  const conversationId = useRecoilValue(selectedConversationIdState);
  const hydrationKey = conversationId ?? "__no_conv__";
  const [hydration, setHydration] = useRecoilState(
    chatHydrationState(hydrationKey),
  );
  const [bootstrapRefreshVersion, setBootstrapRefreshVersion] = useState(0);

  const setSelectedConversationId = useSetRecoilState(
    selectedConversationIdState,
  );

  const turnState = useRecoilValue(
    chatConversationTurnState(conversationId ?? "__no_conv__"),
  );

  const isTurnActive = ![
    "idle",
    "submitting",
  ].includes(turnState.phase);

  const activeActionPhases = new Set([
    "starting",
    "running",
    "waiting_user",
    "waiting_approval",
    "waiting_external",
    "cancelling",
  ]);

  const showPauseAction =
    Boolean(turnState.activeTraceId)
    || Boolean(turnState.activeRequestId)
    || activeActionPhases.has(turnState.phase);



  const [messages, setMessageList] =
    useRecoilState(messageListState);

  const setMessageMap =
    useSetRecoilState(messageMapState);

  const [messageMap] =
    useRecoilState(messageMapState);

  const displayMessages = useMemo(
    () =>
      conversationId
      && hydration.conversationId === conversationId
      && hydration.hydratedAt != null
      && Object.prototype.hasOwnProperty.call(messageMap, conversationId)
        ? messageMap[conversationId]
        : messages,
    [conversationId, hydration.conversationId, hydration.hydratedAt, messageMap, messages],
  );

  const turnNavigationAnchors =
    useMemo(
      () =>
        buildTurnNavigationAnchors(
          displayMessages,
        ),
      [displayMessages],
    );

  const activeTurnId =
    useMemo(
      () =>
        resolveActiveTurnId(
          turnNavigationAnchors,
          visibleMessageRange
            .startIndex,
        ),
      [
        turnNavigationAnchors,
        visibleMessageRange
          .startIndex,
      ],
    );

  const navigateToTurn =
    useCallback(
      (
        userMessageId: string,
        behavior:
          | "auto"
          | "smooth" = "auto",
      ): boolean =>
        (
          virtuosoRef.current
            ?.scrollToTurn(
              userMessageId,
              behavior,
            )
          ?? false
        ),
      [],
    );

  const handleTurnNavigate =
    useCallback(
      (
        userMessageId: string,
      ) => {
        navigateToTurn(
          userMessageId,
          "smooth",
        );
      },
      [navigateToTurn],
    );

  useEffect(() => {
    const pending =
      pendingTopUserMessageRef.current;

    if (
      !pending
      || pending.conversationId
        !== conversationId
    ) {
      return;
    }

    const positioned =
      virtuosoRef.current
        ?.pinNewTurn(
          pending.messageId,
        )
      ?? false;

    if (!positioned) {
      return;
    }

    pendingTopUserMessageRef.current =
      null;
  }, [
    conversationId,
    displayMessages,
  ]);

  useEffect(() => {
    if (
      !conversationId
      || pendingBootstrapBottomRef.current
        !== conversationId
      || displayMessages.length === 0
    ) {
      return;
    }

    pendingBootstrapBottomRef.current =
      null;
    virtuosoRef.current
      ?.scrollToBottom(
        "auto",
        true,
      );
  }, [
    bootstrapScrollVersion,
    conversationId,
    displayMessages,
  ]);

  useEffect(() => {
    const pending =
      pendingTopUserMessageRef.current;

    if (
      pending
      && pending.conversationId
        !== conversationId
    ) {
      pendingTopUserMessageRef.current =
        null;
    }

    setChatAtBottom(true);
    setVisibleMessageRange({
      startIndex: 0,
      endIndex: 0,
    });
  }, [conversationId]);

  const runtimeTimeline =
    useRecoilValue(
      runtimeEventListState(
        conversationId ?? "__no_conv__",
      ),
    );

  const currentUserId =
    getCurrentUserIdFromToken();

  const hasCompleteDisplayCache = Boolean(
    conversationId
    && hydration.conversationId === conversationId
    && hydration.hydratedAt != null,
  );

  const hasUserMessage = useMemo(
    () =>
      displayMessages.some(
        (message) =>
          message.role === "user",
      ),
    [displayMessages],
  );

  const isConversationEmpty =
    displayMessages.length === 0;

  const isNewConversation = Boolean(
    conversationId
      ?.startsWith("temp-"),
  );

  const {
    visible: actualShowWelcome,
    dismiss: dismissWelcome,
  } = useChatWelcomeVisibility({
    userId: currentUserId,
    conversationId,
    isNewConversation,
    canEvaluateConversation: Boolean(
      conversationId
      && (
        isNewConversation
        || hasCompleteDisplayCache
      ),
    ),
    isConversationEmpty,
    hasUserMessage,
  });

  const showWelcome =
    actualShowWelcome;

  const handleWelcomeAction =
    useCallback(
      (
        action: ChatWelcomeAction,
      ) => {
        setInput((current) =>
          current.trim()
            ? current
            : action.prompt,
        );

        requestAnimationFrame(() => {
          window.dispatchEvent(
            new Event(
              "chat:focus-composer",
            ),
          );
        });
      },
      [],
    );

  const [pendingFiles, setPendingFiles] =
    useState<ChatPendingFile[]>([]);
  const hasPendingFileUpload =
    pendingFiles.some(
      (file) =>
        file.status === "validating"
        || file.status === "uploading"
        || file.status === "processing",
    );
  const composerActionMode = showPauseAction && !input.trim() && pendingFiles.length === 0 ? "pause" : "send";
  const pendingFilesRef =
    useRef<ChatPendingFile[]>([]);

  const runtimeSettingsKey =
    conversationId ?? "__no_conv__";

  const [
    runtimeSettings,
    setRuntimeSettings,
  ] = useRecoilState(
    conversationRuntimeSettingsState(
      runtimeSettingsKey,
    ),
  );

  const selectedWorkspace =
    runtimeSettings.workspace;

  const selectedPermissionMode =
    runtimeSettings.permissionMode;

  const runtimeSettingsMutationRef =
    useRef(new Map<string, number>());

  const runtimeSettingsPendingRef =
    useRef(new Map<string, number>());

  const runtimeSettingsSaveChainRef =
    useRef(new Map<string, Promise<void>>());

  const commitRuntimeSettings =
    useRecoilCallback(
      ({ set }) =>
        (
          cid: string,
          settings: RuntimeConversationSettingsView,
        ) => {
          set(
            conversationRuntimeSettingsState(cid),
            (previous) =>
              settings.version < previous.version
                ? previous
                : {
                    ...settings,
                    conversationId: cid,
                    status: "ready" as const,
                    error: null,
                  },
          );
        },
      [],
    );

  const changeRuntimeSettings =
    useCallback(
      async (
        patch: {
          workspaceId?: string | null;
          permissionMode?: RuntimePermissionMode;
        },
        optimistic: {
          workspace?: RuntimeWorkspaceView | null;
          permissionMode?: RuntimePermissionMode;
        },
      ) => {
        const cid = String(
          conversationId ?? "",
        ).trim();

        if (!cid) {
          return;
        }

        const previous = runtimeSettings;
        const mutationId =
          (runtimeSettingsMutationRef.current.get(cid) ?? 0) + 1;
        runtimeSettingsMutationRef.current.set(cid, mutationId);

        setRuntimeSettings((current) => ({
          ...current,
          ...(Object.prototype.hasOwnProperty.call(
            optimistic,
            "workspace",
          )
            ? {
                workspace:
                  optimistic.workspace ?? null,
                workspaceId:
                  optimistic.workspace?.id ?? null,
              }
            : {}),
          ...(optimistic.permissionMode
            ? {
                permissionMode:
                  optimistic.permissionMode,
              }
            : {}),
          status: cid.startsWith("temp-")
            ? "ready"
            : "saving",
          error: null,
        }));

        if (cid.startsWith("temp-")) {
          return;
        }

        runtimeSettingsPendingRef.current.set(
          cid,
          mutationId,
        );

        const previousSave =
          runtimeSettingsSaveChainRef.current.get(cid)
          ?? Promise.resolve();

        const save = previousSave
          .catch(() => undefined)
          .then(async () => {
            try {
              const saved =
                await updateConversationRuntimeSettings(
                  cid,
                  patch,
                );

              if (
                runtimeSettingsPendingRef.current.get(cid)
                !== mutationId
              ) {
                return;
              }

              commitRuntimeSettings(cid, saved);
            } catch (error) {
              if (
                runtimeSettingsPendingRef.current.get(cid)
                !== mutationId
              ) {
                return;
              }

              setRuntimeSettings({
                ...previous,
                status: "error",
                error:
                  error instanceof Error
                    ? error.message
                    : String(error),
              });
            } finally {
              if (
                runtimeSettingsPendingRef.current.get(cid)
                === mutationId
              ) {
                runtimeSettingsPendingRef.current.delete(cid);
              }
            }
          });

        runtimeSettingsSaveChainRef.current.set(
          cid,
          save,
        );

        await save;

        if (
          runtimeSettingsSaveChainRef.current.get(cid)
          === save
        ) {
          runtimeSettingsSaveChainRef.current.delete(cid);
        }
      },
      [
        commitRuntimeSettings,
        conversationId,
        runtimeSettings,
        setRuntimeSettings,
      ],
    );

  const handleSelectedWorkspaceChange =
    useCallback(
      (workspace: RuntimeWorkspaceView | null) => {
        void changeRuntimeSettings(
          {
            workspaceId: workspace?.id ?? null,
          },
          { workspace },
        );
      },
      [changeRuntimeSettings],
    );

  const handleSelectedPermissionModeChange =
    useCallback(
      (permissionMode: RuntimePermissionMode) => {
        void changeRuntimeSettings(
          { permissionMode },
          { permissionMode },
        );
      },
      [changeRuntimeSettings],
    );

  const activeWorkflow = useActiveWorkflow(
    agentId,
    conversationId,
  );

  const workflowPhases = useMemo(
    () =>
      activeWorkflow.snapshot
        ?.phases
      ?? [],
    [activeWorkflow.snapshot],
  );

  const workflowIsTerminal = Boolean(
    activeWorkflow.snapshot
    && [
      "COMPLETED",
      "FAILED",
      "CANCELLED",
    ].includes(
      activeWorkflow.snapshot.run.status,
    ),
  );

  const hasVisibleWorkflow = Boolean(
    activeWorkflow.snapshot
    && !workflowIsTerminal
    && workflowPhases.length > 0,
  );

  const [
    expandedWorkflowId,
    setExpandedWorkflowId,
  ] = useState<string | null>(null);

  const visibleWorkflowId =
    hasVisibleWorkflow
      ? activeWorkflow.snapshot?.run.id ?? null
      : null;

  const workflowExpanded = Boolean(
    visibleWorkflowId
    && expandedWorkflowId === visibleWorkflowId,
  );

  const toggleWorkflowExpanded = useCallback(() => {
    if (!visibleWorkflowId) {
      return;
    }

    setExpandedWorkflowId(
      (current) =>
        current === visibleWorkflowId
          ? null
          : visibleWorkflowId,
    );
  }, [visibleWorkflowId]);

  useEffect(() => {
    if (!hasVisibleWorkflow) {
      setExpandedWorkflowId(null);
    }
  }, [hasVisibleWorkflow]);

  const chatHydratedForIncremental = Boolean(
    conversationId?.startsWith("temp-")
    || (
      hydration.conversationId === conversationId
      && (
        hydration.status === "ready"
        || hydration.status === "refreshing"
      )
    ),
  );

  const waitingForWorkflowInput =
    activeWorkflow.snapshot?.run.status
      === "WAITING"
    && activeWorkflow.snapshot.run.waitReason
      === "USER_INPUT";

  const [currentTitle, setCurrentTitle] =
    useState<string>("");

  const {
    title: convTitle,
    isDefaultTitle,
    loading: titleLoading,
    getOne,
    list,
    listLoading,
    fetchListByAgent,
    rename,
    setLocalPlaceholder,
  } = useChatTitle(
    agentId,
    conversationId,
    {
      onTitleChange: ({ title }) => {
        if (title) {
          setCurrentTitle(title);
        }
      },
    },
  );

  const { startNewConversation } =
    useNewConversation(agentId, {
      onCreated: (t) => {
        setCurrentTitle(
          t.title || "",
        );
      },
    });

  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  useEffect(() => {
    return () => {
      for (const file of pendingFilesRef.current) {
        if (file.localUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(file.localUrl);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (
      convTitle
      && Boolean(convTitle.trim())
    ) {
      setCurrentTitle(convTitle);
    }
  }, [convTitle]);

  useEffect(() => {
    const refreshConversationList = () => {
      if (agentId) {
        fetchListByAgent({}).catch(
          () => {},
        );
      }
    };

    window.addEventListener(
      "chat:conversation:deleted",
      refreshConversationList as EventListener,
    );

    window.addEventListener(
      "chat:conversation:restored",
      refreshConversationList as EventListener,
    );

    window.addEventListener(
      "chat:conversation:remarked",
      refreshConversationList as EventListener,
    );

    return () => {
      window.removeEventListener(
        "chat:conversation:deleted",
        refreshConversationList as EventListener,
      );

      window.removeEventListener(
        "chat:conversation:restored",
        refreshConversationList as EventListener,
      );

      window.removeEventListener(
        "chat:conversation:remarked",
        refreshConversationList as EventListener,
      );
    };
  }, [
    agentId,
    fetchListByAgent,
  ]);

  const messageMapRef =
    useRef(messageMap);

  useEffect(() => {
    messageMapRef.current =
      messageMap;
  }, [messageMap]);

  const lastLoadedRef =
    useRef<string | null>(null);

  const historyRequestRef =
    useRef(0);

  const updateConversationMessages =
    useRecoilCallback(
      ({ set }) =>
        (
          convId: string,
          updater: (
            previous: Message[],
          ) => Message[],
        ) => {
          if (!convId) {
            return;
          }

          set(
            messageMapState,
            (previous) => {
              const current =
                previous[convId]
                ?? [];
              const next =
                updater(current);

              if (next === current) {
                return previous;
              }

              const nextMap = {
                ...previous,
                [convId]: next,
              };

              messageMapRef.current =
                nextMap;

              return nextMap;
            },
          );

          if (
            convId === conversationId
          ) {
            set(
              messageListState,
              updater,
            );
          }
        },
      [conversationId],
    );


  useEffect(() => {
    const handleAutomationMessageHidden = (
      event: Event,
    ) => {
      const detail =
        (event as CustomEvent)?.detail;
      const record =
        detail
        && typeof detail === 'object'
        && !Array.isArray(detail)
          ? detail as Record<string, unknown>
          : {};
      const cid = String(
        record.conversationId
        ?? '',
      ).trim();
      const messageId = String(
        record.messageId
        ?? '',
      ).trim();

      if (!cid || !messageId) {
        return;
      }

      window.setTimeout(() => {
        updateConversationMessages(
          cid,
          (previous) => {
            const next = previous.filter(
              (message) =>
                message.id !== messageId,
            );

            return next.length === previous.length
              ? previous
              : next;
          },
        );
      }, 0);
    };

    window.addEventListener(
      'chat:automation:message-hidden',
      handleAutomationMessageHidden as EventListener,
    );

    return () => {
      window.removeEventListener(
        'chat:automation:message-hidden',
        handleAutomationMessageHidden as EventListener,
      );
    };
  }, [updateConversationMessages]);


  const handleBranchCreated =
    useCallback(
      async (
        result:
          ConversationBranchResponse,
      ) => {
        const nextConversation =
          result.conversation;

        const nextConversationId =
          String(
            nextConversation.id ?? "",
          ).trim();

        if (!nextConversationId) {
          throw new Error(
            localize("errors.branchMissingConversationId"),
          );
        }

        historyRequestRef.current += 1;
        lastLoadedRef.current = null;

        setMessageMap((previous) => {
          const next = {
            ...previous,
          };

          delete next[
            nextConversationId
          ];

          return next;
        });

        setMessageList([]);
        setSelectedConversationId(
          nextConversationId,
        );

        const titleUpdatedAt =
          nextConversation.titleUpdatedAt
          ?? nextConversation.createdAt;

        setLocalPlaceholder({
          conversationId:
            nextConversationId,
          title:
            nextConversation.title
            || "",
          titleVersion:
            nextConversation.titleVersion
            ?? 1,
          titleUpdatedAt,
        });

        setCurrentTitle(
          nextConversation.title
          || "",
        );

        await fetchListByAgent(
          {},
        ).catch(
          () => undefined,
        );

        window.dispatchEvent(
          new CustomEvent(
            "chat:conversation:created",
            {
              detail: {
                conversationId:
                  nextConversationId,
                agentId:
                  nextConversation.agentId,
                title:
                  nextConversation.title,
                titleVersion:
                  nextConversation.titleVersion,
                titleUpdatedAt,
              },
            },
          ),
        );

        requestAnimationFrame(() => {
          window.dispatchEvent(
            new Event(
              "chat:focus-composer",
            ),
          );
        });
      },
      [
        fetchListByAgent,
        setLocalPlaceholder,
        setMessageList,
        setMessageMap,
        setSelectedConversationId,
      ],
    );

  useEffect(() => {
    const handleRuntimeSettingsUpdated = (
      event: Event,
    ) => {
      const detail =
        (event as CustomEvent)?.detail;
      const record =
        detail
        && typeof detail === "object"
        && !Array.isArray(detail)
          ? detail as Record<string, unknown>
          : {};
      const settingsInput =
        record.settings ?? record;
      const settingsRecord =
        settingsInput
        && typeof settingsInput === "object"
        && !Array.isArray(settingsInput)
          ? settingsInput as Record<string, unknown>
          : {};
      const cid = String(
        record.conversationId
        ?? settingsRecord.conversationId
        ?? "",
      ).trim();

      if (
        !cid
        || runtimeSettingsPendingRef.current.has(cid)
      ) {
        return;
      }

      commitRuntimeSettings(
        cid,
        normalizeConversationRuntimeSettings(
          settingsInput,
          cid,
        ),
      );
    };

    window.addEventListener(
      "chat:runtime-settings-updated",
      handleRuntimeSettingsUpdated as EventListener,
    );

    return () => {
      window.removeEventListener(
        "chat:runtime-settings-updated",
        handleRuntimeSettingsUpdated as EventListener,
      );
    };
  }, [commitRuntimeSettings]);

  const {
    branchFromMessage,
    branchingMessageId,
    error: branchError,
    clearError: clearBranchError,
  } = useConversationBranch({
    conversationId,
    onCreated: handleBranchCreated,
  });

  const handleBranchFromMessage =
    useCallback(
      (messageId: string) => {
        void branchFromMessage(
          messageId,
        );
      },
      [branchFromMessage],
    );

  const ensureRealConversation =
    useCallback(
      async (): Promise<
        string | null
      > => {
        if (
          !agentId
          || !conversationId
        ) {
          return null;
        }

        if (
          !conversationId.startsWith(
            "temp-",
          )
        ) {
          return conversationId;
        }

        try {
          const real =
            await createConversation({
              agentId,
            });

          const realId =
            real.conversationId;

          const provisionalSettings:
            RuntimeConversationSettingsView = {
              conversationId: realId,
              workspaceId:
                runtimeSettings.workspace?.id
                ?? runtimeSettings.workspaceId
                ?? null,
              workspace:
                runtimeSettings.workspace,
              permissionMode:
                runtimeSettings.permissionMode,
              version: Math.max(
                1,
                runtimeSettings.version || 1,
              ),
              updatedAt:
                runtimeSettings.updatedAt,
            };

          try {
            const savedSettings =
              await updateConversationRuntimeSettings(
                realId,
                {
                  workspaceId:
                    provisionalSettings.workspaceId,
                  permissionMode:
                    provisionalSettings.permissionMode,
                },
              );
            commitRuntimeSettings(
              realId,
              savedSettings,
            );
          } catch (error) {
            console.error(
              "[Chat] Failed to persist runtime settings for new conversation",
              error,
            );
            throw error;
          }

          setMessageMap((prev) => {
            const tempMsgs =
              prev[conversationId] ?? [];

            const {
              [conversationId]:
                _removed,
              ...rest
            } = prev as any;
            const nextMap = {
              ...rest,
              [realId]:
                tempMsgs,
            };

            messageMapRef.current =
              nextMap;

            return nextMap;
          });

          setSelectedConversationId(
            realId,
          );

          await new Promise(
            requestAnimationFrame,
          );

          setLocalPlaceholder({
            conversationId: realId,
            title:
              real.title || "",
            titleVersion:
              real.titleVersion ?? 1,
            titleUpdatedAt:
              real.titleUpdatedAt
              ?? new Date().toISOString(),
          });

          setCurrentTitle(
            real.title || "",
          );

          void fetchListByAgent(
            {},
          ).catch(
            () => {},
          );

          window.dispatchEvent(
            new CustomEvent(
              "chat:conversation:created",
              {
                detail: {
                  conversationId:
                    realId,
                  agentId,
                },
              },
            ),
          );

          return realId;
        } catch {
          return null;
        }
      },
      [
        agentId,
        commitRuntimeSettings,
        conversationId,
        fetchListByAgent,
        runtimeSettings.permissionMode,
        runtimeSettings.updatedAt,
        runtimeSettings.version,
        runtimeSettings.workspace,
        runtimeSettings.workspaceId,
        setLocalPlaceholder,
        setMessageMap,
        setSelectedConversationId,
      ],
    );

  const removePendingFile =
    useCallback(
      (clientId: string) => {
        setPendingFiles((prev) => {
          const target = prev.find(
            (file) =>
              file.clientId
              === clientId,
          );

          if (
            target?.localUrl
              ?.startsWith("blob:")
          ) {
            URL.revokeObjectURL(
              target.localUrl,
            );
          }

          return prev.filter(
            (file) =>
              file.clientId
              !== clientId,
          );
        });
      },
      [],
    );

  const handleFilesSelected =
    useCallback(
      async (files: File[]) => {
        if (
          !files.length
          || !agentId
          || hasPendingFileUpload
        ) {
          return;
        }

        const availableSlots =
          Math.max(
            0,
            CHAT_PENDING_FILE_LIMIT
              - pendingFiles.length,
          );

        const acceptedFiles =
          files.slice(
            0,
            availableSlots,
          );

        if (!acceptedFiles.length) {
          return;
        }

        const cid =
          await ensureRealConversation();

        if (!cid) {
          return;
        }

        const startPosition =
          pendingFiles.length;

        const uploads = acceptedFiles.map(
          async (file, index) => {
            const position = startPosition + index;
            const clientId = createUploadClientId(file);
            const localUrl = URL.createObjectURL(file);
            const inferredType = inferFileType(file.name, file.type);
            const image = file.type.startsWith("image/")
              || ["png", "jpg", "jpeg", "webp"].includes(inferredType);

            const fallback: ChatPendingFile = {
              clientId,
              position,
              originalName: file.name,
              displayName: file.name,
              sizeBytes: file.size,
              sizeText: formatFileSize(file.size),
              objectKind: image ? "image" : inferredType,
              extension: file.name.includes(".")
                ? file.name.split(".").pop()?.toLowerCase()
                : undefined,
              mimeType: file.type || "application/octet-stream",
              localUrl,
              status: "validating",
              uploadProgress: 0,
            };

            setPendingFiles((previous) =>
              [...previous, fallback].sort(
                (a, b) => a.position - b.position,
              ),
            );

            try {
              const media = image
                ? await readLocalImageDimensions(file)
                : undefined;
              const preparedFallback: ChatPendingFile = {
                ...fallback,
                media,
                status: "uploading",
              };

              setPendingFiles((previous) =>
                previous.map((item) =>
                  item.clientId === clientId
                    ? preparedFallback
                    : item,
                ),
              );

              const uploaded = await uploadFileAsset(
                file,
                {
                  agentId,
                  conversationId: cid,
                },
                ({ phase, progress }) => {
                  setPendingFiles((previous) =>
                    previous.map((item) =>
                      item.clientId === clientId
                        ? {
                            ...item,
                            status: phase,
                            uploadProgress: progress,
                          }
                        : item,
                    ),
                  );
                },
              );

              const normalized = normalizeUploadedFileCard(
                uploaded,
                preparedFallback,
              );

              setPendingFiles((previous) =>
                previous
                  .map((item) =>
                    item.clientId === clientId
                      ? normalized
                      : item,
                  )
                  .sort((a, b) => a.position - b.position),
              );
            } catch (error) {
              const message = error instanceof Error
                ? error.message
                : localize("chat.uploadFailed");
              const unsupported = isUnsupportedObjectUploadError(error);

              setPendingFiles((previous) =>
                previous.map((item) =>
                  item.clientId === clientId
                    ? {
                        ...item,
                        status: unsupported ? "unsupported" : "failed",
                        error: message,
                      }
                    : item,
                ),
              );
            }
          },
        );

        await Promise.allSettled(
          uploads,
        );
      },
      [
        agentId,
        ensureRealConversation,
        hasPendingFileUpload,
        pendingFiles.length,
      ],
    );

  const routeRuntimeEvents =
    useRecoilCallback(
      ({ set }) =>
        (
          cid: string,
          values: unknown[],
        ) => {
          if (
            !cid
            || values.length === 0
          ) {
            return;
          }

          set(
            runtimeEventListState(cid),
            (previous) => {
              let next = previous;

              for (const raw of values) {
                const event =
                  normalizeRuntimeEvent(
                    raw,
                  );

                if (
                  !event
                  || event.conversationId
                    !== cid
                ) {
                  continue;
                }

                next =
                  upsertRuntimeEvent(
                    next,
                    event,
                  );
              }

              return next;
            },
          );
        },
      [],
    );

  const getRuntimeReplayCursor =
    useRecoilCallback(
      ({ snapshot }) =>
        async (cid: string) => {
          const state =
            await snapshot.getPromise(
              runtimeEventListState(
                cid,
              ),
            );

          return state.lastReplayCursor;
        },
      [],
    );

  const advanceRuntimeReplayCursor =
    useRecoilCallback(
      ({ set }) =>
        (
          cid: string,
          cursor: string | null,
        ) => {
          if (
            !cid
            || !cursor
          ) {
            return;
          }

          set(
            runtimeEventListState(cid),
            (previous) => {
              const current =
                previous.lastReplayCursor;

              let next = cursor;

              if (current) {
                try {
                  next =
                    BigInt(current)
                    >= BigInt(cursor)
                      ? current
                      : cursor;
                } catch {
                  next = cursor;
                }
              }

              return next === current
                ? previous
                : {
                    ...previous,
                    lastReplayCursor:
                      next,
                  };
            },
          );
        },
      [],
    );

  const hydrateRuntimeTimeline =
    useCallback(
      (value: unknown) => {
        const events =
          Array.isArray(value)
            ? value
            : [];

        for (const raw of events) {
          const event =
            normalizeRuntimeEvent(
              raw,
            );

          if (!event) {
            continue;
          }

          routeRuntimeEvents(
            event.conversationId,
            [event],
          );
        }
      },
      [routeRuntimeEvents],
    );

  const handleReply = useCallback(
    (incoming: Message) => {
      const cid = String(
        incoming.conversationId
        ?? '',
      ).trim();

      if (!cid) {
        return;
      }

      const incomingSource = String(
        (incoming as any)?.meta?.source
        ?? '',
      ).trim();
      const isAutomationDelivery =
        incomingSource === 'automation'
        || incomingSource === 'automation_lifecycle';

      if (!isAutomationDelivery) {
        hydrateRuntimeTimeline(
          incoming.runtime
            ?.timeline,
        );
      }

      const pendingCandidate =
        incoming.role === 'user'
          ? pendingSubmissionsRef
              .current
              .get(incoming.id)
          : undefined;
      const pendingSubmission =
        pendingCandidate
        && pendingCandidate.conversationId
          === cid
          ? pendingCandidate
          : undefined;
      const projectedIncoming =
        pendingSubmission
          ? {
              ...incoming,
              objects:
                pendingSubmission.objects,
              runtimeOptions:
                pendingSubmission.runtimeOptions,
            }
          : incoming;

      if (pendingSubmission) {
        pendingSubmissionsRef
          .current
          .delete(incoming.id);

        if (cid === conversationId) {
          pendingTopUserMessageRef.current = {
            conversationId: cid,
            messageId: incoming.id,
          };
        }
      }

      updateConversationMessages(
        cid,
        (previous) =>
          projectMessage(
            previous,
            projectedIncoming,
          ),
      );

      if (
        cid === conversationId
        && loading
        && !isAutomationDelivery
      ) {
        setLoading(false);
      }
    },
    [
      conversationId,
      loading,
      hydrateRuntimeTimeline,
      updateConversationMessages,
    ],
  );


  const handleComplete = useCallback(
    (
      id: string,
      cid?: string,
    ) => {
      const target = String(
        cid
        ?? conversationId
        ?? '',
      ).trim();

      if (!target) {
        return;
      }

      updateConversationMessages(
        target,
        (previous) =>
          previous.map(
            (message) =>
              message.id === id
                ? {
                    ...message,
                    is_complete: true,
                  }
                : message,
          ),
      );

      if (target === conversationId) {
        setLoading(false);
      }
    },
    [
      conversationId,
      updateConversationMessages,
    ],
  );


  const ensureRuntimeAssistantShell =
    useCallback(
      (input: {
        conversationId: string;
        assistantMessageId?: string | null;
        userMessageId?: string | null;
        traceId?: string | null;
        createdAt?: number | null;
      }) => {
        const cid = String(
          input.conversationId
          ?? '',
        ).trim();
        const assistantMessageId = String(
          input.assistantMessageId
          ?? '',
        ).trim();
        const userMessageId = String(
          input.userMessageId
          ?? '',
        ).trim();

        if (
          !cid
          || !assistantMessageId
          || !userMessageId
        ) {
          return;
        }

        updateConversationMessages(
          cid,
          (previous) =>
            ensureAssistantShell(
              previous,
              {
                conversationId: cid,
                assistantMessageId,
                parentMessageId:
                  userMessageId,
                traceId:
                  input.traceId
                  ?? null,
                agentId,
                createdAt:
                  input.createdAt
                  ?? null,
              },
            ),
        );
      },
      [
        agentId,
        updateConversationMessages,
      ],
    );


  useEffect(() => {
    const cid = String(
      conversationId ?? "",
    ).trim();
    const assistantMessageId = String(
      turnState.activeAssistantMessageId
      ?? "",
    ).trim();
    const userMessageId = String(
      turnState.activeUserMessageId
      ?? '',
    ).trim();
    const traceId = String(
      turnState.activeTraceId
      ?? '',
    ).trim();

    if (
      !cid
      || !assistantMessageId
      || !userMessageId
    ) {
      return;
    }

    ensureRuntimeAssistantShell({
      conversationId: cid,
      assistantMessageId,
      userMessageId,
      traceId: traceId || null,
    });
  }, [
    conversationId,
    ensureRuntimeAssistantShell,
    turnState.activeAssistantMessageId,
    turnState.activeUserMessageId,
    turnState.activeTraceId,
  ]);

  const handleRuntimeEvent =
    useCallback(
      (rawEvent: unknown) => {
        const event =
          normalizeRuntimeEvent(
            rawEvent,
          );

        if (!event) {
          return;
        }

        routeRuntimeEvents(
          event.conversationId,
          [event],
        );
      },
      [routeRuntimeEvents],
    );

  const handleChatFailure =
    useCallback(
      (error: unknown) => {
        const payload =
          error
          && typeof error === 'object'
          && !Array.isArray(error)
            ? error as Record<string, unknown>
            : {};
        const clientMessageId =
          String(
            payload.clientMessageId
            ?? payload.userMessageId
            ?? '',
          ).trim();
        const removedPending =
          clientMessageId
          ? pendingSubmissionsRef
              .current
              .delete(clientMessageId)
          : false;

        if (
          removedPending
          && pendingTopUserMessageRef.current
            ?.messageId
          === clientMessageId
        ) {
          pendingTopUserMessageRef.current =
            null;
        }

        if (
          isMissingLlmSettingsError(
            error,
          )
        ) {
          setShowMissingLlmSettings(
            true,
          );
        }
      },
      [],
    );

  const {
    submitTurn,
    stopTurn,
    syncConversation,
    approveRuntimeApproval,
    rejectRuntimeApproval,
    isConnected: socketConnected,
  } = useSocket(
    handleReply,
    handleComplete,
    handleRuntimeEvent,
    handleChatFailure,
    { enabled: chatHydratedForIncremental },
  );

  const composer =
    useChatComposerController({
      turnState,
      submitTurn,
      stopTurn,
      });

  const canSubmitCurrentDraft =
    Boolean(
      agentId
      && conversationId,
    )
    && !composer.submitting
    && !composer.stopping
    && turnState.phase !== 'cancelling'
    && pendingFiles.every(
      (file) => file.status === "ready",
    )
    && (
      input.trim().length > 0
      || pendingFiles.length > 0
    );

  const composerActionDisabled =
    composerActionMode === "pause"
      ? !composer.canStop
      : !canSubmitCurrentDraft;

  const stopStatus = composer.stopping
    ? localize(socketConnected ? 'chat.composer.stopRequesting' : 'chat.composer.stopPendingConnection')
    : composer.stopFailed ? localize('chat.composer.stopFailed')
      : turnState.phase === 'cancelling' ? localize('chat.composer.stopRequesting') : null;

  useEffect(() => {
    if (
      conversationId
      && chatHydratedForIncremental
      && !conversationId.startsWith(
        "temp-",
      )
    ) {
      syncConversation(
        conversationId,
      );
    }
  }, [
    conversationId,
    chatHydratedForIncremental,
    syncConversation,
  ]);

  const socketWasConnectedRef =
    useRef(false);

  useEffect(() => {
    if (!socketConnected) {
      socketWasConnectedRef.current =
        false;

      return;
    }

    if (
      socketWasConnectedRef.current
    ) {
      return;
    }

    socketWasConnectedRef.current =
      true;

    const cid = String(
      conversationId ?? "",
    ).trim();

    if (
      !cid
      || cid.startsWith("temp-")
    ) {
      return;
    }

    void (async () => {
      try {
        const cursor =
          await getRuntimeReplayCursor(
            cid,
          );

        const result =
          await getRuntimeTimeline(
            cid,
            cursor,
          );

        routeRuntimeEvents(
          cid,
          result.events,
        );

        advanceRuntimeReplayCursor(
          cid,
          result.nextCursor,
        );

        syncConversation(cid);
      } catch {
      }
    })();
  }, [
    advanceRuntimeReplayCursor,
    conversationId,
    getRuntimeReplayCursor,
    routeRuntimeEvents,
    socketConnected,
    syncConversation,
  ]);

  const handleRuntimeApprovalDecision =
    useCallback(
      (
        approvalId: string,
        decision:
          RuntimeApprovalDecision,
        taskRunId?: string,
      ) => {
        const normalizedApprovalId =
          String(
            approvalId ?? "",
          ).trim();

        if (!normalizedApprovalId) {
          return;
        }

        if (
          decision === "rejected"
        ) {
          rejectRuntimeApproval({
            approvalId:
              normalizedApprovalId,
            conversationId:
              conversationId
              ?? undefined,
            taskRunId,
            decision:
              "rejected",
          });

          return;
        }

        approveRuntimeApproval({
          approvalId:
            normalizedApprovalId,
          conversationId:
            conversationId
            ?? undefined,
          taskRunId,
          decision,
        });
      },
      [
        approveRuntimeApproval,
        rejectRuntimeApproval,
        conversationId,
      ],
    );

  const sendInFlightRef = useRef(false);
  const handleSend =
    useCallback(async () => {
      if (sendInFlightRef.current) return;
      sendInFlightRef.current = true;
      try {
      if (composer.submitting) {
        return;
      }

      if (
        pendingFiles.some(
          (file) => file.status !== "ready",
        )
      ) {
        return;
      }

      if (
        !input.trim()
        && pendingFiles.length === 0
      ) {
        return;
      }

      if (
        !agentId
        || !conversationId
      ) {
        return;
      }

      if (
        llmPreflightRef.current
      ) {
        return;
      }

      llmPreflightRef.current =
        true;

      try {
        const settings =
          await modelSettingsApi.current();

        if (
          !isUserLlmConfigured(
            settings,
          )
        ) {
          setShowMissingLlmSettings(
            true,
          );

          return;
        }
      } catch (error) {
        console.warn(
          "[Chat] Unable to preflight user LLM settings; deferring to the server guard",
          error,
        );
      } finally {
        llmPreflightRef.current =
          false;
      }

      const cid =
        await ensureRealConversation();

      if (!cid) {
        return;
      }

      const uploadedFiles =
        pendingFiles
          .filter(
            (file) =>
              file.status
                === "ready"
              && file.objectId,
          )
          .sort(
            (a, b) =>
              a.position
              - b.position,
          );

      const userMessageId =
        crypto.randomUUID();

      const text =
        input.trim();

      const runtimeOptions = {
        workspaceId:
          selectedWorkspace?.id
          ?? null,
        permissionMode:
          selectedPermissionMode,
      };

      pendingSubmissionsRef
        .current
        .set(
          userMessageId,
          {
            conversationId: cid,
            objects:
              uploadedFiles.map(
                (file) =>
                  pendingFileToMessageObject(
                    file,
                    {
                      messageId:
                        userMessageId,
                      conversationId:
                        cid,
                    },
                  ),
              ),
            runtimeOptions,
          },
        );

      if (
        !currentTitle.trim()
      ) {
        setCurrentTitle(
          inferOptimisticTitle(
            input
            || uploadedFiles[0]
              ?.displayName
            || "",
          ),
        );
      }

      const frozenInput =
        input;

      const frozenFiles = [
        ...pendingFiles,
      ];

      setInput("");
      setPendingFiles([]);

      const ack =
        await composer.submitDraft({
          clientMessageId:
            userMessageId,
          conversationId: cid,
          agentId,
          content: text,
          objectRefs:
            uploadedFiles.map(
              (file) => ({
                objectId:
                  String(
                    file.objectId,
                  ),
                position:
                  file.position,
              }),
            ),
          runtimeOptions,
        });

      if (!ack.ok) {
        pendingSubmissionsRef
          .current
          .delete(userMessageId);

        if (
          pendingTopUserMessageRef.current
            ?.messageId
          === userMessageId
        ) {
          pendingTopUserMessageRef.current =
            null;
        }

        setInput(frozenInput);
        setPendingFiles(
          frozenFiles,
        );

        if (
          isMissingLlmSettingsError(
            ack,
          )
        ) {
          setShowMissingLlmSettings(
            true,
          );
        }

        return;
      }

      if (ack.status === 'STEERING' || ack.status === 'USER_RESPONSE') {
        // Supplements are projected from Turn inputs, never a future Message row.
        pendingSubmissionsRef.current.delete(userMessageId);
      }

      dismissWelcome();

      for (
        const file
        of frozenFiles
      ) {
        if (
          file.localUrl
            ?.startsWith("blob:")
        ) {
          URL.revokeObjectURL(
            file.localUrl,
          );
        }
      }

      window.dispatchEvent(
        new CustomEvent(
          "agentMessageSent",
          {
            detail: {
              agentId,
            },
          },
        ),
      );
      } finally { sendInFlightRef.current = false; }
    }, [
      composer,
      input,
      pendingFiles,
      agentId,
      conversationId,
      ensureRealConversation,
      currentTitle,
      selectedWorkspace,
      selectedPermissionMode,
      dismissWelcome,
    ]);

  const beginChatHydration = useRecoilCallback(
    ({ set }) =>
      (cid: string, cached: Message[] | null) => {
        set(
          chatHydrationState(cid),
          (previous) => ({
            conversationId: cid,
            status: cached ? "refreshing" as const : "loading" as const,
            hydratedAt: cached ? previous.hydratedAt : null,
            error: null,
          }),
        );
        set(messageListState, cached ?? []);
      },
    [],
  );

  const commitChatBootstrap = useRecoilCallback(
    ({ set, snapshot }) =>
      async (input: {
        cid: string;
        aid: string;
        history: Message[];
        messageBaseline: Message[];
        timeline: ReturnType<typeof emptyRuntimeTimelineState>;
        timelineBaseline: ReturnType<typeof emptyRuntimeTimelineState>;
        workflow: Awaited<ReturnType<typeof getChatBootstrap>>["workflow"];
        workflowBaseline: {
          workflowId: string | null;
          runVersion: number | null;
          updatedAt: number | null;
        };
        turn: ReturnType<typeof emptyChatTurnState>;
        runtimeSettings: RuntimeConversationSettingsView | null;
        hydratedAt: number;
      }) => {
        const currentMap = await snapshot.getPromise(messageMapState);
        const committedHistory = mergeBootstrapMessages(
          {
            history: input.history,
            current:
              currentMap[input.cid]
              ?? [],
            baseline:
              input.messageBaseline,
            activeAssistant: {
              conversationId:
                input.cid,
              assistantMessageId:
                input.turn
                  .activeAssistantMessageId,
              parentMessageId:
                input.turn
                  .activeUserMessageId,
              traceId:
                input.turn
                  .activeTraceId,
              agentId:
                input.aid,
            },
          },
        );
        const nextMessageMap = {
          ...currentMap,
          [input.cid]: committedHistory,
        };

        messageMapRef.current =
          nextMessageMap;

        set(
          messageMapState,
          nextMessageMap,
        );
        set(messageListState, committedHistory);
        set(
          runtimeEventListState(input.cid),
          (previous) => mergeRuntimeTimelineStates(
            input.timeline,
            previous,
            input.timelineBaseline,
          ),
        );
        set(
          activeWorkflowState(`${input.aid}:${input.cid}`),
          (previous) => workflowStateAdvancedSince(
            previous,
            input.workflowBaseline,
          )
            ? previous
            : workflowStateFromSnapshot(
                `${input.aid}:${input.cid}`,
                input.workflow,
                input.hydratedAt,
                previous,
              ),
        );
        set(
          chatConversationTurnState(input.cid),
          (previous) => newerTurnState(previous, input.turn),
        );
        const bootstrapRuntimeSettings =
          input.runtimeSettings;

        if (
          bootstrapRuntimeSettings
          && !runtimeSettingsPendingRef.current.has(input.cid)
        ) {
          set(
            conversationRuntimeSettingsState(input.cid),
            (previous) =>
              bootstrapRuntimeSettings.version < previous.version
                ? previous
                : {
                    ...bootstrapRuntimeSettings,
                    conversationId: input.cid,
                    status: "ready" as const,
                    error: null,
                  },
          );
        }
        set(chatHydrationState(input.cid), {
          conversationId: input.cid,
          status: "ready",
          hydratedAt: input.hydratedAt,
          error: null,
        });
      },
    [],
  );

  useEffect(() => {
    const requestId =
      ++historyRequestRef.current;

    const cid =
      conversationId || "";

    if (!cid) {
      setMessageList([]);
      lastLoadedRef.current = null;
      return;
    }

    if (
      cid.startsWith("temp-")
    ) {
      const aid = String(agentId ?? "").trim();
      commitChatBootstrap({
        cid,
        aid,
        history: [],
        messageBaseline: [],
        timeline: emptyRuntimeTimelineState(),
        timelineBaseline: emptyRuntimeTimelineState(),
        workflow: null,
        workflowBaseline: {
          workflowId: null,
          runVersion: null,
          updatedAt: null,
        },
        turn: {
          ...emptyChatTurnState(cid),
          hydrated: true,
        },
        runtimeSettings: null,
        hydratedAt: Date.now(),
      });
      lastLoadedRef.current = cid;
      return;
    }

    const aid = String(agentId ?? "").trim();
    if (!aid) {
      return;
    }

    lastLoadedRef.current =
      cid;

    const cached =
      hydration.conversationId === cid
      && hydration.hydratedAt != null
      && Object.prototype.hasOwnProperty.call(
        messageMapRef.current,
        cid,
      )
        ? messageMapRef.current[cid]
        : null;
    const workflowBaseline = {
      workflowId: activeWorkflow.snapshot?.run.id ?? activeWorkflow.lastWorkflowId,
      runVersion: activeWorkflow.lastRunVersion,
      updatedAt: activeWorkflow.lastUpdatedAt,
    };

    beginChatHydration(cid, cached);

    void getOne(cid).then((info) => {
      if (
        historyRequestRef.current !== requestId
        || !info?.title
      ) return;
      const isPlaceholder = !info.title.trim();
      if (!isPlaceholder || !currentTitle.trim()) {
        setCurrentTitle(info.title);
      }
      setLocalPlaceholder({
        conversationId: cid,
        title: info.title,
        titleVersion: info.titleVersion,
        titleUpdatedAt: info.titleUpdatedAt,
      });
    }).catch(() => undefined);

    void (async () => {
      try {
        const bootstrap = await getChatBootstrap(aid, cid);

        if (
          historyRequestRef.current
          !== requestId
        ) {
          return;
        }

        const raw = Array.isArray(bootstrap.messages)
          ? bootstrap.messages
          : [];
        const mappedHistory = mapHistoryToMessages({ raw, cid, agentId: aid });
        const messageTimelineEvents = mappedHistory.flatMap((message) =>
          Array.isArray((message as any)?.runtime?.timeline)
            ? (message as any).runtime.timeline
            : [],
        );
        const timeline = reduceRuntimeEvents(
          [
            ...messageTimelineEvents,
            ...(Array.isArray(bootstrap.runtimeTimeline?.events)
              ? bootstrap.runtimeTimeline.events
              : []),
          ],
          cid,
          bootstrap.runtimeTimeline?.nextCursor ?? null,
        );
        const turn = bootstrap.turn
          ? reduceChatTurnState(
              emptyChatTurnState(cid),
              "chat.queue.snapshot",
              bootstrap.turn,
            )
          : {
              ...emptyChatTurnState(cid),
              hydrated: true,
            };
        const history = ensureAssistantShell(
          mappedHistory,
          {
            conversationId: cid,
            assistantMessageId:
              turn.activeAssistantMessageId,
            parentMessageId:
              turn.activeUserMessageId,
            traceId:
              turn.activeTraceId,
            agentId: aid,
          },
        );

        await commitChatBootstrap({
          cid,
          aid,
          history,
          messageBaseline: cached ?? [],
          timeline,
          timelineBaseline: runtimeTimeline,
          workflow: bootstrap.workflow,
          workflowBaseline,
          turn,
          runtimeSettings:
            normalizeConversationRuntimeSettings(
              bootstrap.runtimeSettings,
              cid,
            ),
          hydratedAt: Number(bootstrap.generatedAt) || Date.now(),
        });

        pendingBootstrapBottomRef.current =
          history.length > 0
            ? cid
            : null;
        setBootstrapScrollVersion(
          (value) => value + 1,
        );
      } catch (error) {
        if (
          historyRequestRef.current
          !== requestId
        ) {
          return;
        }
        setHydration((previous) => ({
          ...previous,
          conversationId: cid,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
        if (!cached) lastLoadedRef.current = null;
      }
    })();
  }, [
    agentId,
    beginChatHydration,
    bootstrapRefreshVersion,
    commitChatBootstrap,
    conversationId,
  ]);

  useEffect(() => {
    const onSelChange = () => {
      const sel =
        window.getSelection?.();

      isSelectingRef.current =
        Boolean(
          sel
          && !sel.isCollapsed,
        );
    };

    document.addEventListener(
      "selectionchange",
      onSelChange,
    );

    return () =>
      document.removeEventListener(
        "selectionchange",
        onSelChange,
      );
  }, []);

  useEffect(() => {
    const onPrefill = (e: Event) => {
      try {
        const text =
          (e as CustomEvent)
            ?.detail?.text;

        if (
          typeof text
          === "string"
        ) {
          setInput(text);
        }
      } catch {
                                          
      }
    };

    const onSend = () => {
      handleSend();
    };

    window.addEventListener(
      "chat:prefill",
      onPrefill as EventListener,
    );

    window.addEventListener(
      "chat:send",
      onSend as EventListener,
    );

    return () => {
      window.removeEventListener(
        "chat:prefill",
        onPrefill as EventListener,
      );

      window.removeEventListener(
        "chat:send",
        onSend as EventListener,
      );
    };
  }, [handleSend]);

  const handleDropdownClick =
    useCallback(() => {
      if (!agentId) {
        return;
      }

      fetchListByAgent(
        {},
      ).catch(
        () => {},
      );
    }, [
      agentId,
      fetchListByAgent,
    ]);

  const handleSelectConversation =
    useCallback(
      (cid: string) => {
        setSelectedConversationId(
          cid,
        );
      },
      [setSelectedConversationId],
    );

  const handleNewConversation =
    useCallback(() => {
      const currentLen =
        (
          conversationId
          && messageMapRef.current[
            conversationId
          ]?.length
        )
        ?? (
          conversationId
            ? messages.length
            : 0
        );

      if (
        conversationId
        && currentLen === 0
        && isDefaultTitle
      ) {
        setToastKey(
          Date.now(),
        );

        setShowEmptyToast(
          true,
        );

        return;
      }

      startNewConversation().catch(
        () => {},
      );
    }, [
      conversationId,
      messages.length,
      isDefaultTitle,
      startNewConversation,
    ]);

  useEffect(() => {
    const onNewConversation = () => {
      handleNewConversation();
    };

    window.addEventListener(
      "chat:new-conversation",
      onNewConversation as EventListener,
    );

    return () =>
      window.removeEventListener(
        "chat:new-conversation",
        onNewConversation as EventListener,
      );
  }, [handleNewConversation]);

  const handleRenameTitle =
    useCallback(
      async (
        newTitle: string,
      ) => {
        if (
          !conversationId
          || conversationId
            .startsWith("temp-")
        ) {
          return;
        }

        try {
          await rename(newTitle);
        } catch (error) {
          throw error;
        }
      },
      [
        conversationId,
        rename,
      ],
    );

  const showHistoryRestore = Boolean(
    conversationId
    && !conversationId.startsWith("temp-")
    && !hasCompleteDisplayCache,
  );

  useEffect(() => {
    const isFileDrag = (event: DragEvent) =>
      Array.from(
        event.dataTransfer?.types ?? [],
      ).includes("Files");

    const isPortalTarget = (event: DragEvent) => {
      const portal =
        document.getElementById("shell-portal");
      const target = event.target;

      return Boolean(
        portal
        && target instanceof Node
        && portal.contains(target),
      );
    };

    const handleWindowDragOver = (event: DragEvent) => {
      if (
        !isFileDrag(event)
        || event.defaultPrevented
      ) {
        return;
      }

      event.preventDefault();

      if (
        isPortalTarget(event)
        || !agentId
        || !conversationId
        || hasPendingFileUpload
        || pendingFiles.length >= CHAT_PENDING_FILE_LIMIT
      ) {
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "none";
        }
        return;
      }

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };

    const handleWindowDrop = (event: DragEvent) => {
      if (
        !isFileDrag(event)
        || event.defaultPrevented
      ) {
        return;
      }

      event.preventDefault();

      if (
        isPortalTarget(event)
        || !agentId
        || !conversationId
        || hasPendingFileUpload
        || pendingFiles.length >= CHAT_PENDING_FILE_LIMIT
      ) {
        return;
      }

      const files = Array.from(
        event.dataTransfer?.files ?? [],
      ).filter(
        (file): file is File =>
          file instanceof File
          && file.size > 0,
      );

      if (!files.length) {
        return;
      }

      void handleFilesSelected(files);
    };

    window.addEventListener(
      "dragover",
      handleWindowDragOver,
    );
    window.addEventListener(
      "drop",
      handleWindowDrop,
    );

    return () => {
      window.removeEventListener(
        "dragover",
        handleWindowDragOver,
      );
      window.removeEventListener(
        "drop",
        handleWindowDrop,
      );
    };
  }, [
    agentId,
    conversationId,
    handleFilesSelected,
    hasPendingFileUpload,
    pendingFiles.length,
  ]);

  return (
    <>
      <LiveObjectPreviewSync
        conversationId={conversationId}
        messages={displayMessages}
        hydrationReady={hasCompleteDisplayCache}
        activeAssistantMessageId={
          turnState.activeAssistantMessageId
        }
      />

      <div
        className={cn(
          "w-full h-full flex select-none flex-col overflow-hidden",
          "bg-surface-chat ",
        )}
      >
      <div className="relative z-20 w-full shrink-0">
        <ChatHead

          collapsed={collapsed}
          setCollapsed={setCollapsed}
          currentTitle={currentTitle}
          dropdownChats={
            (
              list?.filter(
                (item) =>
                  item.id
                  !== conversationId,
              )
              || []
            ).map(
              (item) => ({
                id: item.id,
                title:
                  item.title,
              }),
            )
          }
          dropdownLoading={
            listLoading
          }
          onDropdownClick={
            handleDropdownClick
          }
          onSelectConversation={
            handleSelectConversation
          }
          onNewConversation={
            handleNewConversation
          }
          titleLoading={
            isDefaultTitle
            && titleLoading
            && !conversationId
              ?.startsWith("temp-")
          }
          onRenameTitle={
            handleRenameTitle
          }
        />
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1">
            {showHistoryRestore ? (
              <ChatHistoryRestoreState

                error={hydration.status === "error" ? hydration.error : null}
                onRetry={() => setBootstrapRefreshVersion((value) => value + 1)}
              />
            ) : (
              <>
                <VirtualMessageList
                  ref={virtuosoRef}
                  className="relative mx-auto h-full w-[85%] px-0"
                  messages={displayMessages}

                  currentUserId={currentUserId}
                  runtimeDisplayByAssistantMessageId={
                    runtimeTimeline.displayByAssistantMessageId
                  }
                  branchingMessageId={
                    branchingMessageId
                  }
                  isTurnActive={
                    isTurnActive
                  }
                  activeAssistantMessageId={
                    turnState.activeAssistantMessageId
                  }
                  onBranchFromMessage={
                    handleBranchFromMessage
                  }
                  onApprovalDecision={
                    handleRuntimeApprovalDecision
                  }
                  onAtBottomChange={
                    setChatAtBottom
                  }
                  onVisibleRangeChange={
                    setVisibleMessageRange
                  }
                />

                {showWelcome && (
                  <div
                    className="
                      pointer-events-none
                      absolute
                      left-1/2
                      top-[14%]
                      z-20
                      w-[85%]
                      -translate-x-1/2
                    "
                  >
                    <div className="pointer-events-auto">
                      <ChatWelcome

                        onSelectAction={
                          handleWelcomeAction
                        }
                      />
                    </div>
                  </div>
                )}

                <TurnMinimap
                  anchors={
                    turnNavigationAnchors
                  }
                  activeTurnId={
                    activeTurnId
                  }

                  onNavigate={
                    handleTurnNavigate
                  }
                  className="absolute top-[16px] bottom-[16px] right-[-8px] z-[60] "
                />
              </>
            )}
          </div>

          <div className="relative z-10 flex w-full shrink-0 justify-center bg-transparent">
            <div className="w-[85%] relative">
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full translate-y-[20px] pointer-events-none z-30">
                <div className="pointer-events-auto translate-y-[-30px] ">
                  <JumpToBottomButton
                    visible={
                      displayMessages.length > 0
                      && !chatAtBottom
                    }
                    onClick={() => {
                      virtuosoRef.current
                        ?.scrollToBottom(
                          "smooth",
                        );
                    }}
                  />
                </div>
              </div>

              <div className="relative">


                {activeWorkflow.snapshot
                  && hasVisibleWorkflow && (
                    <div className="relative z-10  translate-y-[20px]">
                      <WorkflowLine
                        snapshot={
                          activeWorkflow.snapshot
                        }

                        expanded={
                          workflowExpanded
                        }
                      />
                    </div>
                  )}

                <div className="relative z-20 ">
                  {stopStatus && <div role="status" aria-live="polite" className="px-3 py-1 text-xs text-black/55 dark:text-white/55">{stopStatus}</div>}
                  <ChatInput
                    value={input}
                    onChange={(event) =>
                      setInput(
                        event.target.value,
                      )
                    }
                    onSubmit={() => {
                      void handleSend();
                    }}
                    onStop={() => {
                      void composer
                        .stopCurrentTurn();
                    }}

                    executionPhase={
                      turnState.phase
                    }
                    canSubmit={
                      canSubmitCurrentDraft
                    }
                    canStop={
                      composer.canStop
                    }
                    actionMode={
                      composerActionMode
                    }
                    actionDisabled={
                      composerActionDisabled
                    }
                    actionBusy={
                      composer.stopping || turnState.phase
                      === "cancelling"
                    }
                    placeholder={
                      waitingForWorkflowInput
                        ? localize("chat.workflow.replyToContinue")
                        : undefined
                    }
                    pendingFiles={
                      pendingFiles
                    }
                    onFilesSelected={
                      handleFilesSelected
                    }
                    onRemovePendingFile={
                      removePendingFile
                    }
                    uploadDisabled={
                      !agentId
                      || !conversationId
                    }
                    taskMiniActive={
                      workflowExpanded
                    }
                    workflowActive={
                      hasVisibleWorkflow
                    }
                    onToggleTaskMini={
                      toggleWorkflowExpanded
                    }
                  />
                </div>

                <div className="relative z-10 -translate-y-[25px]">
                  <RuntimeControlPanel

                    selectedWorkspace={
                      selectedWorkspace
                    }
                    onSelectedWorkspaceChange={
                      handleSelectedWorkspaceChange
                    }
                    selectedPermissionMode={
                      selectedPermissionMode
                    }
                    onSelectedPermissionModeChange={
                      handleSelectedPermissionModeChange
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {showEmptyToast && (
        <ToastCard
          key={toastKey}
          text={localize("chat.latestConversation")}

          duration={2000}
          onClose={() =>
            setShowEmptyToast(false)
          }
        />
      )}

      {branchError && (
        <ToastCard
          key={`branch-${branchError}`}
          text={branchError}

          duration={3500}
          onClose={
            clearBranchError
          }
        />
      )}

      <ConfirmModal
        isOpen={
          showMissingLlmSettings
        }
        onClose={() =>
          setShowMissingLlmSettings(
            false,
          )
        }
        onConfirm={() => {
          setShowMissingLlmSettings(
            false,
          );

          onOpenModelSettings?.();
        }}

        title={localize('chat.missingModel.title')}
        description={localize('chat.missingModel.description')}
        confirmText={localize('chat.missingModel.openSettings')}
        cancelText={localize('chat.missingModel.later')}
        danger={false}
      />
      </div>
    </>
  );
};

export default Chat;

function ChatHistoryRestoreState({
    error,
  onRetry,
}: {

  error: string | null;
  onRetry: () => void;
}) {
  const localize = useLocalize();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className={cn(
        "rounded-2xl px-5 py-3 text-xs",
        "bg-surface-item text-[#000000]/55  dark:text-[#ffffff]/65",
      )}>
        <span>{error ? localize('chat.restore.failed') : localize('chat.restore.loading')}</span>
        {error && (
          <button
            type="button"
            className="ml-3 underline underline-offset-2"
            onClick={onRetry}
          >
            {localize('common.actions.retry')}
          </button>
        )}
      </div>
    </div>
  );
}

function workflowStateAdvancedSince(
  state: ActiveWorkflowLoadState,
  baseline: {
    workflowId: string | null;
    runVersion: number | null;
    updatedAt: number | null;
  },
): boolean {
  if (
    (state.snapshot?.run.id ?? state.lastWorkflowId)
    && (state.snapshot?.run.id ?? state.lastWorkflowId) !== baseline.workflowId
  ) {
    return compareNullableNumber(state.lastUpdatedAt, baseline.updatedAt) > 0;
  }
  return compareNullableNumber(state.lastRunVersion, baseline.runVersion) > 0
    || (
      state.lastRunVersion === baseline.runVersion
      && compareNullableNumber(state.lastUpdatedAt, baseline.updatedAt) > 0
    );
}


async function readLocalImageDimensions(
  file: File,
): Promise<ChatPendingFile['media']> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      return {
        width: bitmap.width,
        height: bitmap.height,
        format: file.type.replace(/^image\//, "") || undefined,
      };
    } finally {
      bitmap.close();
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      format: file.type.replace(/^image\//, "") || undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function newerTurnState(
  current: ChatConversationTurnState,
  incoming: ChatConversationTurnState,
): ChatConversationTurnState {
  const left = current.lastEventSequence;
  const right = incoming.lastEventSequence;
  if (!left) return incoming;
  if (!right) return current;
  try {
    return BigInt(left) > BigInt(right) ? current : incoming;
  } catch {
    return left.localeCompare(right) > 0 ? current : incoming;
  }
}

function compareNullableNumber(
  left: number | null,
  right: number | null,
): number {
  return (left ?? -1) - (right ?? -1);
}

const MISSING_LLM_SETTINGS_CODES = [
  "LLM_API_KEY_REQUIRED",
  "USER_LLM_SETTINGS_REQUIRED",
  "NO_API_KEY",
] as const;

function isMissingLlmSettingsError(
  value: unknown,
): boolean {
  const record =
    value
    && typeof value === "object"
    && !Array.isArray(value)
      ? value as Record<
          string,
          unknown
        >
      : {};

  const candidates = [
    value,
    record.code,
    record.message,
    record.error,
    record.reasonCode,
    ...(
      Array.isArray(
        record.reasonCodes,
      )
        ? record.reasonCodes
        : []
    ),
  ];

  return candidates.some(
    (candidate) => {
      const text = String(
        candidate ?? "",
      ).toUpperCase();

      return MISSING_LLM_SETTINGS_CODES.some(
        (code) =>
          text.includes(code),
      );
    },
  );
}

function isUserLlmConfigured(
  settings: UserLlmSettings,
): boolean {
  return Boolean(
    settings.primary.providerKey?.trim()
    && settings.primary.modelKey?.trim()
    && settings.primary.credential.configured,
  );
}
