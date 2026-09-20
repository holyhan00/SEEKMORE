// frontend/src/components/chat/ChatInput.tsx
import { useLocalize } from '../../localization/useLocalize';
import React, {
  useState,
  useRef,
  useEffect,
} from "react";
import ActionIcons from "./ActionIcons";
import ObjectCardIn from "./object-card/ObjectCardIn";
import McpDropdown from "./mcp/McpDropdown";
import {
  useMcpServers,
} from "./mcp/useMcpServers";
import {
  CHAT_PENDING_FILE_LIMIT,
  type ChatPendingFile,
} from "./file-upload.types";
import ComposerActionButton from "./composer/ComposerActionButton";
import type { ChatTurnPhase } from "./hooks/socket/chat-turn-contracts";
import { cn } from "../../lib/utils";

interface ChatInputProps {
  value: string;
  onChange: (
    event:
      React.ChangeEvent<HTMLTextAreaElement>,
  ) => void;
  onSubmit: () => void;
  onStop: () => void;

  executionPhase: ChatTurnPhase;
  canSubmit: boolean;
  canStop: boolean;
  actionMode: "send" | "pause";
  actionDisabled: boolean;
  actionBusy?: boolean;
  placeholder?: string;
  pendingFiles?: ChatPendingFile[];
  onFilesSelected?: (
    files: File[],
  ) => void;
  onRemovePendingFile?: (
    clientId: string,
  ) => void;
  uploadDisabled?: boolean;

  taskMiniActive?: boolean;
  workflowActive?: boolean;

  onToggleTaskMini?: () => void;
}

const CHAT_INPUT_FONT_SIZE = 12;
const CHAT_INPUT_LINE_HEIGHT = 20;
const CHAT_INPUT_MAX_LINES = 12;
const CHAT_INPUT_MAX_HEIGHT =
  CHAT_INPUT_LINE_HEIGHT
  * CHAT_INPUT_MAX_LINES;

const ChatInput = ({
  value,
  onChange,
  onSubmit,
  onStop,
    executionPhase,
  canSubmit,
  actionMode,
  actionDisabled,
  actionBusy,
  placeholder,
  pendingFiles = [],
  onFilesSelected,
  onRemovePendingFile,
  uploadDisabled,
  taskMiniActive = false,
  workflowActive = false,
  onToggleTaskMini,
}: ChatInputProps) => {
  const localize = useLocalize();
  const [
    mcpDropdownOpen,
    setMcpDropdownOpen,
  ] = useState(false);

  const [
    draggingFiles,
    setDraggingFiles,
  ] = useState(false);

  const {
    servers: mcpServers,
    globallyEnabled: mcpGloballyEnabled,
    loading: mcpLoading,
    busyKey: mcpBusyKey,
    error: mcpError,
    setGloballyEnabled: setMcpGloballyEnabled,
    setServerEnabled: setMcpServerEnabled,
  } = useMcpServers();

  const mcpActive =
    mcpGloballyEnabled;

  const taskIconActive =
    taskMiniActive;

  const textAreaRef =
    useRef<HTMLTextAreaElement>(
      null,
    );

  const fileInputRef =
    useRef<HTMLInputElement>(
      null,
    );

  const mcpDropdownRef =
    useRef<HTMLDivElement>(
      null,
    );

  const dragDepthRef =
    useRef(0);

  const hasPendingFiles =
    pendingFiles.length > 0;

  const hasUploadingFiles =
    pendingFiles.some(
      (file) =>
        file.status === "validating"
        || file.status === "uploading"
        || file.status === "processing",
    );

  const pendingFileLimitReached =
    pendingFiles.length
    >= CHAT_PENDING_FILE_LIMIT;

  const availableFileSlots =
    Math.max(
      0,
      CHAT_PENDING_FILE_LIMIT
        - pendingFiles.length,
    );

  const uploadBlocked =
    Boolean(
      uploadDisabled
      || hasUploadingFiles
      || pendingFileLimitReached,
    );

  const adjustTextareaHeight = () => {
    if (
      textAreaRef.current
    ) {
      textAreaRef.current.style.height =
        "auto";

      const newHeight =
        Math.min(
          textAreaRef.current
            .scrollHeight,
          CHAT_INPUT_MAX_HEIGHT,
        );

      textAreaRef.current.style.height =
        `${newHeight}px`;
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [value]);

  useEffect(() => {
    const focusComposer = () => {
      requestAnimationFrame(() => {
        const textarea =
          textAreaRef.current;

        if (!textarea) {
          return;
        }

        textarea.focus();

        const end =
          textarea.value.length;

        textarea.setSelectionRange(
          end,
          end,
        );
      });
    };

    window.addEventListener(
      "chat:focus-composer",
      focusComposer,
    );

    return () =>
      window.removeEventListener(
        "chat:focus-composer",
        focusComposer,
      );
  }, []);

  useEffect(() => {
    if (!mcpDropdownOpen) {
      return;
    }

    const handlePointerDown = (
      event: MouseEvent,
    ) => {
      const target =
        event.target as Node | null;

      if (!target) {
        return;
      }

      if (
        mcpDropdownRef.current
          ?.contains(target)
      ) {
        return;
      }

      setMcpDropdownOpen(false);
    };

    document.addEventListener(
      "mousedown",
      handlePointerDown,
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        handlePointerDown,
      );
  }, [mcpDropdownOpen]);

  const pickFiles = () => {
    if (uploadBlocked) {
      return;
    }

    fileInputRef.current?.click();
  };

  const emitFiles = (
    files:
      FileList
      | File[]
      | null
      | undefined,
  ) => {
    if (uploadBlocked) {
      return;
    }

    const selected =
      Array.from(files ?? [])
        .filter(
          (file) =>
            file instanceof File
            && file.size > 0,
        )
        .slice(
          0,
          availableFileSlots,
        );

    if (!selected.length) {
      return;
    }

    onFilesSelected?.(selected);
  };

  const isFileDrag = (
    event:
      React.DragEvent,
  ) =>
    Array.from(
      event.dataTransfer
        ?.types ?? [],
    ).includes("Files");

  const resetDragState = () => {
    dragDepthRef.current = 0;
    setDraggingFiles(false);
  };

  const handleIconsClick = (
    icon: "task" | "mcp",
  ) => {
    if (icon === "task") {
      onToggleTaskMini?.();

      return;
    }

    if (icon === "mcp") {
      setMcpDropdownOpen(
        (value) => !value,
      );
    }
  };

  const handlePaste = (
    event:
      React.ClipboardEvent<
        HTMLTextAreaElement
      >,
  ) => {
    if (uploadBlocked) {
      return;
    }

    const clipboardFiles =
      Array.from(
        event.clipboardData
          ?.files ?? [],
      ).filter(
        (file): file is File =>
          file instanceof File
          && file.size > 0,
      );

    if (!clipboardFiles.length) {
      return;
    }

    event.preventDefault();
    emitFiles(clipboardFiles);
  };

  const handleSend = () => {
    if (
      !canSubmit
      || hasUploadingFiles
    ) {
      return;
    }

    if (
      !value.trim()
      && !hasPendingFiles
    ) {
      return;
    }

    onSubmit();

    setTimeout(() => {
      textAreaRef.current?.focus();
      adjustTextareaHeight();
    }, 0);
  };

  return (
    <div
      className={cn(
        "relative w-full select-none rounded-[20px] p-[10px] transition-all duration-200",
        "bg-surface-chat-raised ",
        draggingFiles
        && "ring-2 ring-[#3388ff] ring-offset-2 ring-offset-transparent",
      )}
      style={{
        transform: "none",
        boxShadow:
          "0 0 30px rgba(0, 0, 0, 0.05)",
        minHeight: "60px",
      }}
      aria-busy={
        executionPhase
          === "cancelling"
        || hasUploadingFiles
          ? true
          : undefined
      }
      onDragEnter={(event) => {
        if (
          !isFileDrag(event)
          || uploadBlocked
        ) {
          return;
        }

        event.preventDefault();
        dragDepthRef.current += 1;
        setDraggingFiles(true);
      }}
      onDragOver={(event) => {
        if (
          !isFileDrag(event)
          || uploadBlocked
        ) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect =
          "copy";
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event)) {
          return;
        }

        event.preventDefault();

        dragDepthRef.current =
          Math.max(
            0,
            dragDepthRef.current - 1,
          );

        if (
          dragDepthRef.current
          === 0
        ) {
          setDraggingFiles(false);
        }
      }}
      onDrop={(event) => {
        if (
          !isFileDrag(event)
          || uploadBlocked
        ) {
          return;
        }

        event.preventDefault();

        emitFiles(
          event.dataTransfer.files,
        );

        resetDragState();
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        disabled={uploadBlocked}
        className="hidden"
        onChange={(event) => {
          emitFiles(
            event.target.files,
          );

          event.currentTarget.value =
            "";
        }}
      />

      {draggingFiles && (
        <div
          className={`
            pointer-events-none
            absolute
            inset-2
            z-20
            flex
            items-center
            justify-center
            rounded-[22px]
            border
            border-dashed
            ${
              "border-[#2563eb] bg-[#eef5ff]/90 text-[#2563eb] dark:border-[#3388ff] dark:bg-[#132035]/80 dark:text-[#9dccff]"
            }
          `}
        >
          <div className="text-sm font-semibold">
            {localize('chat.input.dropFiles')}
          </div>
        </div>
      )}

      <div className="flex h-full flex-col">
        {pendingFiles.length > 0 && (
          <div
            className={[
              "mb-3 flex w-full min-w-0 flex-nowrap items-start gap-[10px] overflow-hidden",
              "overflow-x-auto overflow-y-hidden overscroll-x-contain",
              "px-1 pb-1 pr-2 [scrollbar-width:thin]",
            ].join(" ")}
          >
            {pendingFiles.map((file) => (
              <div
                key={file.clientId}
                className="shrink-0"
              >
                <ObjectCardIn
                  mode="composer"
                  file={file}

                  onRemove={() =>
                    onRemovePendingFile?.(file.clientId)
                  }
                />
              </div>
            ))}
          </div>
        )}

        <div
          className="flex-1"
          style={{
          }}
        >
          <textarea
            ref={textAreaRef}
            className={cn(
              "w-full select-text resize-none border-0 bg-transparent outline-none",
              "text-theme-input ",
            )}
            placeholder={
              hasPendingFiles
                ? localize('chat.input.addMore')
                : placeholder
                  ?? localize('chat.input.sendAnything')
            }
            value={value}
            onChange={onChange}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (
                (
                  !canSubmit
                  || hasUploadingFiles
                )
                && event.key
                  === "Enter"
                && !event.shiftKey
              ) {
                event.preventDefault();

                return;
              }

              if (
                event.key
                  === "Enter"
                && !event.shiftKey
              ) {
                event.preventDefault();
                handleSend();
              }
            }}
            style={{
              fontSize: `${CHAT_INPUT_FONT_SIZE}px`,
              lineHeight: `${CHAT_INPUT_LINE_HEIGHT}px`,
              minHeight: "30px",
              overflowY: "auto",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              boxSizing: "border-box",
              userSelect: "text",
            }}
          />
        </div>

        <style>
          {`textarea::-webkit-scrollbar{display:none;}`}
        </style>

        <div
          className="flex items-center justify-between"
          style={{
            minHeight: "30px",
          }}
        >
          <div className="absolute left-[10px] bottom-[10px] flex items-center">
            <div
              ref={mcpDropdownRef}
              className="relative"
            >
              <ActionIcons

                showTask={
                  workflowActive
                }
                activeIcons={{
                  task:
                    taskIconActive,
                  mcp:
                    mcpActive,
                }}
                onIconClick={
                  handleIconsClick
                }
                onAddAttachment={
                  pickFiles
                }
              />

              {mcpDropdownOpen && (
                <McpDropdown

                  servers={
                    mcpServers
                  }
                  loading={
                    mcpLoading
                  }
                  globallyEnabled={
                    mcpGloballyEnabled
                  }
                  busyKey={
                    mcpBusyKey
                  }
                  error={
                    mcpError
                  }
                  onGlobalEnabledChange={(enabled) => {
                    void setMcpGloballyEnabled(enabled);
                  }}
                  onServerEnabledChange={(installationId, enabled) => {
                    void setMcpServerEnabled(installationId, enabled);
                  }}
                />
              )}
            </div>
          </div>

          <div className="absolute right-[10px] bottom-[10px]">
            <ComposerActionButton
              mode={actionMode}
              disabled={
                actionDisabled
              }
              busy={actionBusy}
              onClick={
                actionMode
                  === "pause"
                  ? onStop
                  : handleSend
              }

            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;