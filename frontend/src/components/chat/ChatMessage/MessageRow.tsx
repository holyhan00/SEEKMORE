                                                                


import React, { useMemo } from "react";
import ChatMessage from "./ChatMessage";
import type { Message } from "../../../utils/types";
import type { ChatMessageDTO } from "./types";
import type { RuntimeDisplayProjection } from "../runtime/display/runtime-display.types";
import type { RuntimeApprovalDecision } from "../runtime/approval/runtimeApprovalClient";
import { useLocalize } from "../../../localization/useLocalize";

interface MessageRowProps {
  message: Message;

  currentUserId: string | null | undefined;
  runtimeDisplay: RuntimeDisplayProjection | null;
  onBranchFromMessage: ((messageId: string) => void) | undefined;
  branching: boolean;
  turnActive: boolean;
  onApprovalDecision: (
    approvalId: string,
    decision: RuntimeApprovalDecision,
    taskRunId?: string,
  ) => void;
}

const MessageRow: React.FC<MessageRowProps> = React.memo(
  ({
    message,
        currentUserId,
    runtimeDisplay,
    onBranchFromMessage,
    branching,
    turnActive,
    onApprovalDecision,
  }) => {
    const t = useLocalize();
    const m = message as any;

    const normRole: "user" | "agent" | "system" = useMemo(
      () =>
        String(m?.role ?? "").trim().toLowerCase() === "user"
          ? "user"
          : String(m?.role ?? "").trim().toLowerCase() === "system"
            ? "system"
            : "agent",
      [m?.role],
    );


    const localizedContent = useMemo(() => {
      const meta = m?.meta && typeof m.meta === 'object' ? m.meta as Record<string, unknown> : {};
      const nestedMetadata = meta.metadata && typeof meta.metadata === 'object' && !Array.isArray(meta.metadata)
        ? meta.metadata as Record<string, unknown>
        : {};
      const presentationRaw = meta.presentation ?? nestedMetadata.presentation;
      const presentation = presentationRaw && typeof presentationRaw === 'object' && !Array.isArray(presentationRaw)
        ? presentationRaw as Record<string, unknown>
        : null;
      const key = typeof presentation?.key === 'string' ? presentation.key.trim() : '';
      if (!key) return String(m.content ?? '');
      const rawParams = presentation?.params && typeof presentation.params === 'object' && !Array.isArray(presentation.params)
        ? presentation.params as Record<string, unknown>
        : {};
      return t(key, {
        ...rawParams,
        defaultValue: String(m.content ?? ''),
      });
    }, [m.content, m.meta, t]);

    const dto: ChatMessageDTO = useMemo(
      () => ({
        id: String(m.id),
        conversationId: m?.conversationId ?? undefined,
        parentMessageId: m?.parentMessageId ?? null,
        rootMessageId: m?.rootMessageId ?? null,
        branchId: m?.branchId ?? null,
        branchable: m?.branchable ?? normRole === "agent",
        role: normRole,
        content: localizedContent,
        isMe: m?.isMe === true,
        isSystem: normRole === "system",
        payload: m?.payload,
        senderType:
          m?.senderType ??
          (m?.senderUserId
            ? "USER"
            : normRole === "system"
              ? "SYSTEM"
              : "AGENT"),
        senderUserId: m?.senderUserId,
        senderAgentId: m?.senderAgentId,
        displayNameSnapshot: m?.displayNameSnapshot,
        avatarVersionSnapshot: m?.avatarVersionSnapshot,
        createdAt: m?.timestamp ?? Date.now(),
        citations: m?.citations ?? null,
        objects: Array.isArray(m?.objects) ? m.objects : [],
        runtime: m?.runtime ?? null,
        branchSnapshotBoundary:
          m?.branchSnapshotBoundary === true ||
          m?.meta?.branchSnapshotBoundary === true,
        meta: m?.meta ?? null,
      }),
      [
        m.id,
        m.conversationId,
        m.parentMessageId,
        m.rootMessageId,
        m.branchId,
        m.branchable,
        normRole,
        localizedContent,
        m.isMe,
        m.payload,
        m.senderType,
        m.senderUserId,
        m.senderAgentId,
        m.displayNameSnapshot,
        m.avatarVersionSnapshot,
        m.timestamp,
        m.citations,
        m.objects,
        m.runtime,
        m.branchSnapshotBoundary,
        m.meta?.branchSnapshotBoundary,
        m.meta,
      ],
    );

    const loading = normRole !== "user" && !m.is_complete;

    return (
      <ChatMessage
        key={dto.id}
        messageId={dto.id}
        msg={dto}

        loading={loading}
        currentUserId={currentUserId}
        runtimeDisplay={runtimeDisplay}
        onApprovalDecision={onApprovalDecision}
        onBranchFromMessage={onBranchFromMessage}
        branching={branching}
        turnActive={turnActive}
      />
    );
  },
  (prevProps, nextProps) => {
    const pm = prevProps.message as any;
    const nm = nextProps.message as any;

    if (pm.id !== nm.id) return false;
    if (pm.conversationId !== nm.conversationId) return false;
    if (pm.role !== nm.role) return false;
    if (pm.parentMessageId !== nm.parentMessageId) return false;
    if (pm.rootMessageId !== nm.rootMessageId) return false;
    if (pm.branchId !== nm.branchId) return false;
    if (pm.branchable !== nm.branchable) return false;
    if (pm.content !== nm.content) return false;
    if (pm.is_complete !== nm.is_complete) return false;
    if (pm.runtime !== nm.runtime) return false;
    if (pm.meta !== nm.meta) return false;
    if (pm.isMe !== nm.isMe) return false;
    if (pm.citations !== nm.citations) return false;
    if (pm.objects !== nm.objects) return false;
    if (pm.branchSnapshotBoundary !== nm.branchSnapshotBoundary) return false;

    if (prevProps.currentUserId !== nextProps.currentUserId) return false;
    if (prevProps.runtimeDisplay !== nextProps.runtimeDisplay) return false;
    if (prevProps.branching !== nextProps.branching) return false;
    if (prevProps.turnActive !== nextProps.turnActive) return false;
    if (prevProps.onBranchFromMessage !== nextProps.onBranchFromMessage)
      return false;

    return true;
  },
);

MessageRow.displayName = "MessageRow";

export default MessageRow;
