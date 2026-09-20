                                                             

import { localizeText } from '../../../localization/localization';
import type {
  Message,
} from "../../../utils/types";

export interface TurnNavigationAnchor {
  id: string;
  userMessageId: string;
  messageIndex: number;
  preview: string;
  createdAt: number | null;
  attachmentNames: string[];
}

function normalizeIdentityValue(
  value: unknown,
): string {
  return String(
    value ?? "",
  )
    .trim()
    .toLowerCase();
}

function normalizePreviewText(
  value: unknown,
): string {
  return String(
    value ?? "",
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function isUserTurnMessage(
  message: Message,
): boolean {
  const role =
    normalizeIdentityValue(
      message.role,
    );
  const senderType =
    normalizeIdentityValue(
      message.senderType,
    );

  return (
    role === "user"
    || senderType === "user"
    || message.isMe === true
  );
}

function getAttachmentNames(
  message: Message,
): string[] {
  if (
    !Array.isArray(
      message.objects,
    )
  ) {
    return [];
  }

  return message.objects
    .map((object) =>
      String(
        object?.displayName
        ?? object?.originalName
        ?? "",
      ).trim(),
    )
    .filter(Boolean);
}

function createTurnPreview(
  message: Message,
  attachmentNames: string[],
): string {
  const content =
    normalizePreviewText(
      message.content,
    );

  if (content) {
    return content;
  }

  if (
    attachmentNames.length > 0
  ) {
    return attachmentNames.join(
      "、",
    );
  }

  return localizeText('chat.turn.blankMessage');
}

export function buildTurnNavigationAnchors(
  messages: Message[],
): TurnNavigationAnchor[] {
  const anchors:
    TurnNavigationAnchor[] = [];

  messages.forEach(
    (
      message,
      messageIndex,
    ) => {
      if (
        !isUserTurnMessage(
          message,
        )
      ) {
        return;
      }

      const userMessageId =
        String(
          message.id ?? "",
        ).trim();

      if (!userMessageId) {
        return;
      }

      const attachmentNames =
        getAttachmentNames(
          message,
        );

      anchors.push({
        id: userMessageId,
        userMessageId,
        messageIndex,
        preview:
          createTurnPreview(
            message,
            attachmentNames,
          ),
        createdAt:
          Number.isFinite(
            message.timestamp,
          )
            ? message.timestamp
            : null,
        attachmentNames,
      });
    },
  );

  return anchors;
}

export function resolveActiveTurnId(
  anchors:
    TurnNavigationAnchor[],
  visibleStartIndex: number,
): string | null {
  if (
    anchors.length === 0
  ) {
    return null;
  }

  let active =
    anchors[0];

  for (
    const anchor
    of anchors
  ) {
    if (
      anchor.messageIndex
      > visibleStartIndex
    ) {
      break;
    }

    active = anchor;
  }

  return active.id;
}
