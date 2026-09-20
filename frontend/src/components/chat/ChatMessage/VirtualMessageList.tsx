                                                                  

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Virtuoso,
  type VirtuosoHandle,
} from "react-virtuoso";

import type { Message } from "../../../utils/types";
import type { RuntimeApprovalDecision } from "../runtime/approval/runtimeApprovalClient";
import type { RuntimeDisplayProjection } from "../runtime/display/runtime-display.types";
import { isUserTurnMessage } from "../navigation/turn-navigation";
import MessageRow from "./MessageRow";

type ScrollBehavior =
  | "auto"
  | "smooth";

export interface VisibleMessageRange {
  startIndex: number;
  endIndex: number;
}

export interface VirtualMessageListHandle {
  scrollToTurn(
    userMessageId: string,
    behavior?: ScrollBehavior,
  ): boolean;
  pinNewTurn(
    userMessageId: string,
  ): boolean;
  scrollToBottom(
    behavior?: ScrollBehavior,
    resetTurnClearance?: boolean,
  ): void;
}

type PendingScroll =
  | {
      type: "turn";
      userMessageId: string;
      behavior: ScrollBehavior;
      offset: number;
    }
  | {
      type: "bottom";
      behavior: ScrollBehavior;
    };

interface VirtualMessageListProps {
  messages: Message[];

  currentUserId: string | null | undefined;
  runtimeDisplayByAssistantMessageId: Record<string, RuntimeDisplayProjection>;
  branchingMessageId: string | null;
  isTurnActive: boolean;
  activeAssistantMessageId: string | null;
  onBranchFromMessage: (messageId: string) => void;
  onApprovalDecision: (
    approvalId: string,
    decision: RuntimeApprovalDecision,
    taskRunId?: string,
  ) => void;
  onAtBottomChange?: (atBottom: boolean) => void;
  onVisibleRangeChange?: (
    range: VisibleMessageRange,
  ) => void;
  className?: string;
}

const TURN_NAVIGATION_TOP_GAP_PX =
  10;
const NEW_TURN_TOP_GAP_PX =
  20;
const MESSAGE_ITEM_BOTTOM_GAP_PX =
  24;
const FOOTER_BASE_HEIGHT_PX =
  24;
const REAL_BOTTOM_THRESHOLD_PX =
  48;

function VirtualMessageListHeader() {
  return (
    <div
      aria-hidden="true"
      className="h-4"
    />
  );
}

function VirtualMessageListFooter() {
  return (
    <div
      aria-hidden="true"
      style={{
        height:
          `calc(var(--bottom-clearance-height, 0px) + ${FOOTER_BASE_HEIGHT_PX}px)`,
      }}
    />
  );
}

const VIRTUAL_MESSAGE_COMPONENTS = {
  Header: VirtualMessageListHeader,
  Footer: VirtualMessageListFooter,
};

function normalizeRole(
  value: unknown,
): string {
  return String(
    value ?? "",
  )
    .trim()
    .toLowerCase();
}

const VirtualMessageList = forwardRef<
  VirtualMessageListHandle,
  VirtualMessageListProps
>(
  (
    {
      messages,
            currentUserId,
      runtimeDisplayByAssistantMessageId,
      branchingMessageId,
      isTurnActive,
      activeAssistantMessageId,
      onBranchFromMessage,
      onApprovalDecision,
      onAtBottomChange,
      onVisibleRangeChange,
      className,
    },
    ref,
  ) => {
    const virtuosoRef =
      useRef<VirtuosoHandle>(null);
    const scrollerElementRef =
      useRef<HTMLElement | null>(
        null,
      );
    const bottomClearanceHeightRef =
      useRef(0);
    const pinnedTurnScrollTopRef =
      useRef<number | null>(null);
    const pendingPinStabilizationRef =
      useRef(false);

    const [
      bottomClearanceHeight,
      setBottomClearanceHeight,
    ] = useState(0);
    const [
      pendingScroll,
      setPendingScroll,
    ] = useState<
      PendingScroll | null
    >(null);

    const branching = Boolean(
      branchingMessageId,
    );

    const updateBottomClearanceHeight =
      useCallback(
        (height: number): boolean => {
          const nextHeight =
            Math.max(0, height);

          if (
            Math.abs(
              bottomClearanceHeightRef.current
              - nextHeight,
            ) < 0.5
          ) {
            return false;
          }

          bottomClearanceHeightRef.current =
            nextHeight;
          setBottomClearanceHeight(
            nextHeight,
          );
          return true;
        },
        [],
      );

    const syncPinnedTurnClearance =
      useCallback((): boolean => {
        const scroller =
          scrollerElementRef.current;
        const pinnedScrollTop =
          pinnedTurnScrollTopRef.current;

        if (
          !scroller
          || pinnedScrollTop == null
        ) {
          return false;
        }

        const naturalScrollHeight =
          scroller.scrollHeight
          - bottomClearanceHeightRef.current;
        const nextClearance =
          Math.max(
            0,
            pinnedScrollTop
            + scroller.clientHeight
            - naturalScrollHeight,
          );

        return updateBottomClearanceHeight(
          nextClearance,
        );
      }, [
        updateBottomClearanceHeight,
      ]);

    const handleScrollerScroll =
      useCallback(() => {
        if (
          !pendingPinStabilizationRef.current
        ) {
          return;
        }

        const scroller =
          scrollerElementRef.current;

        if (!scroller) {
          return;
        }

        pendingPinStabilizationRef.current =
          false;
        pinnedTurnScrollTopRef.current =
          scroller.scrollTop;
        syncPinnedTurnClearance();
      }, [
        syncPinnedTurnClearance,
      ]);

    const handleAtBottomStateChange =
      useCallback(
        (atBottom: boolean) => {
          if (
            pendingPinStabilizationRef.current
          ) {
            return;
          }

          if (onAtBottomChange) {
            onAtBottomChange(atBottom);
          }
        },
        [onAtBottomChange],
      );

    const handleScrollerRef =
      useCallback(
        (
          element:
            | HTMLElement
            | Window
            | null,
        ) => {
          const previous =
            scrollerElementRef.current;

          if (previous) {
            previous.removeEventListener(
              "scroll",
              handleScrollerScroll,
            );
          }

          if (
            typeof HTMLElement
              === "undefined"
            || !(
              element
              instanceof HTMLElement
            )
          ) {
            scrollerElementRef.current =
              null;
            return;
          }

          scrollerElementRef.current =
            element;
          element.addEventListener(
            "scroll",
            handleScrollerScroll,
            { passive: true },
          );
        },
        [handleScrollerScroll],
      );

    const handleTotalListHeightChanged =
      useCallback(() => {
        if (
          pendingPinStabilizationRef.current
        ) {
          return;
        }

        syncPinnedTurnClearance();
      }, [
        syncPinnedTurnClearance,
      ]);

    useLayoutEffect(() => {
      if (messages.length > 0) {
        return;
      }

      pendingPinStabilizationRef.current =
        false;
      pinnedTurnScrollTopRef.current =
        null;
      updateBottomClearanceHeight(0);
    }, [
      messages.length,
      updateBottomClearanceHeight,
    ]);

    const findTurnIndex =
      useCallback(
        (
          userMessageId: string,
        ): number => {
          const normalizedId =
            String(
              userMessageId ?? "",
            ).trim();

          if (!normalizedId) {
            return -1;
          }

          return messages.findIndex(
            (message) =>
              isUserTurnMessage(
                message,
              )
              && String(
                message.id ?? "",
              ).trim()
                === normalizedId,
          );
        },
        [messages],
      );

    const scheduleTurnScroll =
      useCallback(
        (
          userMessageId: string,
          behavior:
            ScrollBehavior,
          ensureTurnClearance: boolean,
        ): boolean => {
          if (
            !virtuosoRef.current
            || findTurnIndex(
              userMessageId,
            ) < 0
          ) {
            return false;
          }

          const scroller =
            scrollerElementRef.current;

          if (!scroller) {
            return false;
          }

          if (ensureTurnClearance) {
            pinnedTurnScrollTopRef.current =
              null;
            pendingPinStabilizationRef.current =
              true;
            updateBottomClearanceHeight(
              scroller.clientHeight,
            );
          }

          setPendingScroll({
            type: "turn",
            userMessageId,
            behavior,
            offset:
              ensureTurnClearance
                ? -(
                    NEW_TURN_TOP_GAP_PX
                    - TURN_NAVIGATION_TOP_GAP_PX
                  )
                : 0,
          });

          return true;
        },
        [
          findTurnIndex,
          updateBottomClearanceHeight,
        ],
      );

    useLayoutEffect(() => {
      if (
        !pendingScroll
        || !virtuosoRef.current
      ) {
        return;
      }

      if (
        pendingScroll.type
        === "bottom"
      ) {
        if (messages.length > 0) {
          virtuosoRef.current
            .scrollToIndex({
              index:
                messages.length - 1,
              align: "end",
              behavior:
                pendingScroll.behavior,
            });
        }

        setPendingScroll(null);
        return;
      }

      const targetIndex =
        findTurnIndex(
          pendingScroll
            .userMessageId,
        );

      if (targetIndex >= 0) {
        virtuosoRef.current
          .scrollToIndex({
            index: targetIndex,
            align: "start",
            offset:
              pendingScroll.offset,
            behavior:
              pendingScroll.behavior,
          });
      }

      setPendingScroll(null);
    }, [
      bottomClearanceHeight,
      findTurnIndex,
      messages.length,
      pendingScroll,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToTurn(
          userMessageId: string,
          behavior:
            ScrollBehavior = "auto",
        ): boolean {
          return scheduleTurnScroll(
            userMessageId,
            behavior,
            false,
          );
        },
        pinNewTurn(
          userMessageId: string,
        ): boolean {
          return scheduleTurnScroll(
            userMessageId,
            "auto",
            true,
          );
        },
        scrollToBottom(
          behavior:
            ScrollBehavior = "auto",
          resetTurnClearance = false,
        ) {
          if (
            messages.length === 0
            || !virtuosoRef.current
          ) {
            return;
          }

          if (resetTurnClearance) {
            pendingPinStabilizationRef.current =
              false;
            pinnedTurnScrollTopRef.current =
              null;
            updateBottomClearanceHeight(0);
          }

          setPendingScroll({
            type: "bottom",
            behavior,
          });
        },
      }),
      [
        messages.length,
        scheduleTurnScroll,
        updateBottomClearanceHeight,
      ],
    );

    const itemContent = useCallback(
      (index: number) => {
        const message =
          messages[index];

        if (!message) {
          return null;
        }

        const rawRole =
          normalizeRole(
            message.role,
          );

        const normalizedRole:
          | "user"
          | "agent"
          | "system" =
          rawRole === "user"
            ? "user"
            : rawRole
              === "system"
              ? "system"
              : "agent";

        const activeId = String(
          activeAssistantMessageId
          ?? "",
        ).trim();

        const messageAssistantIds = [
          (message as any)?.id,
          (message as any)
            ?.assistantMessageId,
          (message as any)?.meta
            ?.assistantMessageId,
          (message as any)?.meta
            ?.backendAssistantMessageId,
        ]
          .map((value) =>
            String(
              value ?? "",
            ).trim(),
          )
          .filter(Boolean);

        const runtimeDisplay =
          messageAssistantIds
            .map(
              (id) =>
                runtimeDisplayByAssistantMessageId[
                  id
                ],
            )
            .find(Boolean)
          ?? null;

        const automationTurnActive =
          normalizedRole === "agent"
          && (message as any)?.meta?.source === "automation"
          && (message as any)?.is_complete !== true;

        const turnActive =
          automationTurnActive
          || (
            normalizedRole === "agent"
            && isTurnActive
            && Boolean(activeId)
            && messageAssistantIds
              .includes(activeId)
          );

        return (
          <div
            style={{
              paddingTop:
                TURN_NAVIGATION_TOP_GAP_PX,
              paddingBottom:
                MESSAGE_ITEM_BOTTOM_GAP_PX,
            }}
          >
            <MessageRow
              message={message}

              currentUserId={
                currentUserId
              }
              runtimeDisplay={
                runtimeDisplay
              }
              onBranchFromMessage={
                normalizedRole
                  === "agent"
                  ? onBranchFromMessage
                  : undefined
              }
              branching={branching}
              turnActive={turnActive}
              onApprovalDecision={
                onApprovalDecision
              }
            />
          </div>
        );
      },
      [
        activeAssistantMessageId,
        branching,
        currentUserId,
        isTurnActive,
        messages,
        onApprovalDecision,
        onBranchFromMessage,
        runtimeDisplayByAssistantMessageId,
      ],
    );

    const computeItemKey =
      useCallback(
        (index: number) =>
          String(
            (messages[index] as any)
              ?.id
            ?? index,
          ),
        [messages],
      );

    const virtuosoStyle =
      useMemo(
        () =>
          ({
            "--bottom-clearance-height":
              `${bottomClearanceHeight}px`,
          }) as React.CSSProperties,
        [
          bottomClearanceHeight,
        ],
      );

    return (
      <Virtuoso
        ref={virtuosoRef}
        scrollerRef={
          handleScrollerRef
        }
        style={virtuosoStyle}
        totalCount={
          messages.length
        }
        itemContent={
          itemContent
        }
        computeItemKey={
          computeItemKey
        }
        components={
          VIRTUAL_MESSAGE_COMPONENTS
        }
        followOutput={false}
        increaseViewportBy={{
          top: 700,
          bottom: 900,
        }}
        atBottomThreshold={
          REAL_BOTTOM_THRESHOLD_PX
        }
        atBottomStateChange={
          handleAtBottomStateChange
        }
        totalListHeightChanged={
          handleTotalListHeightChanged
        }
        rangeChanged={
          onVisibleRangeChange
        }
        className={`scroll-container ${
          className ?? ""
        }`}
      />
    );
  },
);

VirtualMessageList.displayName =
  "VirtualMessageList";

export default VirtualMessageList;
