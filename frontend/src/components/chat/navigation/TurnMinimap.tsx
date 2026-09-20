// frontend/src/components/chat/navigation/TurnMinimap.tsx
import { useAppearance } from '../../../theme/useAppearance';
import { useLocalize } from '../../../localization/useLocalize';
                                                          

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  FocusEvent,
} from "react";
import {
  Virtuoso,
  type VirtuosoHandle,
} from "react-virtuoso";

import { cn } from "../../../lib/utils";
import { useFormatter } from "../../../localization/useFormatter";
import type {
  TurnNavigationAnchor,
} from "./turn-navigation";

interface TurnMinimapProps {
  anchors:
    TurnNavigationAnchor[];
  activeTurnId:
    string | null;

  onNavigate: (
    userMessageId: string,
  ) => void;
  className?: string;
}

const PANEL_WIDTH_PX =
  224;
const PANEL_RAIL_GAP_PX =
  8;

const RAIL_WIDTH_PX =
  34;
const MIN_RAIL_HEIGHT_PX =
  22;
const MAX_RAIL_HEIGHT_PX =
  210;
const MARKER_GAP_PX =
  17;
const RAIL_VERTICAL_PADDING_PX =
  2;

const ACTIVE_MARKER_WIDTH_PX =
  17;
const HOVERED_MARKER_WIDTH_PX =
  14;
const DEFAULT_MARKER_WIDTH_PX =
  11;
const MARKER_HEIGHT_PX =
  1;

const TURN_ROW_HEIGHT_PX =
  34;
const PANEL_VERTICAL_PADDING_PX =
  17;
const MIN_PANEL_HEIGHT_PX =
  101;
const MAX_PANEL_HEIGHT_PX =
  381;

function getRailHeight(
  total: number,
): number {
  if (total <= 1) {
    return MIN_RAIL_HEIGHT_PX;
  }

  const contentHeight =
    (
      total - 1
    )
    * MARKER_GAP_PX
    + (
      RAIL_VERTICAL_PADDING_PX
      * 2
    );

  return Math.min(
    MAX_RAIL_HEIGHT_PX,
    Math.max(
      MIN_RAIL_HEIGHT_PX,
      contentHeight,
    ),
  );
}

function getMarkerTop(
  index: number,
  total: number,
  railHeight: number,
): number {
  if (total <= 1) {
    return (
      railHeight
      / 2
    );
  }

  const usableHeight =
    railHeight
    - (
      RAIL_VERTICAL_PADDING_PX
      * 2
    );

  return (
    RAIL_VERTICAL_PADDING_PX
    + (
      index
      / (total - 1)
    )
    * usableHeight
  );
}

export default function TurnMinimap({
  anchors,
  activeTurnId,
    onNavigate,
  className,
}: TurnMinimapProps) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const formatter = useFormatter();
  const formatTurnTime = (value: number | null): string => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return formatter.formatDateTime(date, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const listRef =
    useRef<VirtuosoHandle>(
      null,
    );
  const rootRef =
    useRef<HTMLDivElement>(
      null,
    );

  const [
    expanded,
    setExpanded,
  ] = useState(false);
  const [
    hoveredTurnId,
    setHoveredTurnId,
  ] = useState<
    string | null
  >(null);
  const [
    railHoveredTurnId,
    setRailHoveredTurnId,
  ] = useState<
    string | null
  >(null);

  const highlightedTurnId =
    hoveredTurnId
    ?? activeTurnId;

  const listTargetIndex =
    useMemo(
      () => {
        const targetId =
          railHoveredTurnId
          ?? activeTurnId;

        return anchors.findIndex(
          (anchor) =>
            anchor.id
            === targetId,
        );
      },
      [
        activeTurnId,
        anchors,
        railHoveredTurnId,
      ],
    );

  const railHeight =
    useMemo(
      () =>
        getRailHeight(
          anchors.length,
        ),
      [anchors.length],
    );

  const panelHeight =
    Math.min(
      MAX_PANEL_HEIGHT_PX,
      Math.max(
        MIN_PANEL_HEIGHT_PX,
        anchors.length
        * TURN_ROW_HEIGHT_PX
        + PANEL_VERTICAL_PADDING_PX,
      ),
    );

  useEffect(() => {
    if (
      !expanded
      || listTargetIndex < 0
    ) {
      return;
    }

    listRef.current
      ?.scrollToIndex({
        index:
          listTargetIndex,
        align: "center",
        behavior: "auto",
      });
  }, [
    expanded,
    listTargetIndex,
  ]);

  const handleNavigate =
    useCallback(
      (
        anchor:
          TurnNavigationAnchor,
      ) => {
        onNavigate(
          anchor.userMessageId,
        );
        setHoveredTurnId(
          anchor.id,
        );
        setRailHoveredTurnId(
          null,
        );
        setExpanded(false);
      },
      [onNavigate],
    );

  const handleBlurCapture =
    useCallback(
      (
        event:
          FocusEvent<
            HTMLDivElement
          >,
      ) => {
        const nextTarget =
          event.relatedTarget;

        if (
          nextTarget
          && rootRef.current
            ?.contains(
              nextTarget as Node,
            )
        ) {
          return;
        }

        setExpanded(false);
        setHoveredTurnId(
          null,
        );
        setRailHoveredTurnId(
          null,
        );
      },
      [],
    );

  if (
    anchors.length === 0
  ) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "pointer-events-auto overflow-visible",
        className,
      )}
      style={{
        width:
          RAIL_WIDTH_PX,
      }}
      onPointerEnter={() =>
        setExpanded(true)
      }
      onPointerLeave={() => {
        setExpanded(false);
        setHoveredTurnId(
          null,
        );
        setRailHoveredTurnId(
          null,
        );
      }}
      onFocusCapture={() =>
        setExpanded(true)
      }
      onBlurCapture={
        handleBlurCapture
      }
    >
      {expanded && (
        <>
          <div
            aria-hidden="true"
            style={{
              position:
                "absolute",
              top:
                0,
              bottom:
                0,
              right:
                RAIL_WIDTH_PX,
              width:
                PANEL_RAIL_GAP_PX,
            }}
          />

          <div
            className={cn(
              "overflow-hidden rounded-[12px] shadow-2xl backdrop-blur-xl",
              "border-[#e0e0e0] bg-[#f1f1f1] text-theme-input dark:border-[#ffffff]/10 dark:bg-[#303030]/[0.98] ",
            )}
            style={{
              position:
                "absolute",
              right:
                RAIL_WIDTH_PX
                + PANEL_RAIL_GAP_PX,
              top:
                "50%",
              width:
                PANEL_WIDTH_PX,
              height:
                panelHeight,
              maxHeight:
                "100%",
              transform:
                "translateY(-50%)",
            }}
          >
            <style>{`
              [data-virtuoso-scroller] {
                scrollbar-width: none;
              }
              [data-virtuoso-scroller]::-webkit-scrollbar {
                display: none;
              }
            `}</style>
            <Virtuoso
              ref={listRef}
              data={anchors}
              computeItemKey={(
                _index,
                anchor,
              ) =>
                anchor.id
              }
              itemContent={(
                index,
                anchor,
              ) => {
                const active =
                  anchor.id
                  === activeTurnId;
                const hovered =
                  anchor.id
                  === hoveredTurnId;
                const time =
                  formatTurnTime(
                    anchor.createdAt,
                  );

                return (
                  <div className="px-[6px] py-[3px]">
                    <button
                      type="button"
                      className={cn(
                        "flex h-[28px] w-full min-w-0 items-center rounded-[7px] font-normal  text-left transition-colors",
                        active
                          ? (
                              "bg-surface-item "
                            )
                          : hovered
                            ? (
                                "bg-[#e5e5e5] dark:bg-[#191919]"
                              )
                            : "bg-transparent",
                      )}
                      title={
                        time
                          ? `${anchor.preview}\n${time}`
                          : anchor.preview
                      }
                      aria-label={
                        localize('turn.jumpTo', { index: index + 1, preview: anchor.preview })
                      }
                      onPointerEnter={() =>
                        setHoveredTurnId(
                          anchor.id,
                        )
                      }
                      onFocus={() =>
                        setHoveredTurnId(
                          anchor.id,
                        )
                      }
                      onClick={() =>
                        handleNavigate(
                          anchor,
                        )
                      }
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px] leading-[16px]">
                        {anchor.preview}
                      </span>
                    </button>
                  </div>
                );
              }}
              className="h-full"
            />
          </div>
        </>
      )}

      <div
        style={{
          position:
            "absolute",
          top:
            "50%",
          right:
            0,
          width:
            RAIL_WIDTH_PX,
          height:
            railHeight,
          transform:
            "translateY(-50%)",
        }}
        aria-label={localize('turn.minimap.ariaLabel')}
      >
        {anchors.map(
          (
            anchor,
            index,
          ) => {
            const active =
              anchor.id
              === activeTurnId;
            const hovered =
              anchor.id
              === highlightedTurnId;

            const markerWidth =
              active
                ? ACTIVE_MARKER_WIDTH_PX
                : hovered
                  ? HOVERED_MARKER_WIDTH_PX
                  : DEFAULT_MARKER_WIDTH_PX;

            const markerColor =
              isDarkTheme
                ? (
                    active
                      ? "#ffffff"
                      : hovered
                        ? "rgba(255,255,255,0.70)"
                        : "rgba(255,255,255,0.38)"
                  )
                : (
                    active
                      ? "#252525"
                      : hovered
                        ? "#7a7a7a"
                        : "#b3b3b3"
                  );

            const markerTop =
              getMarkerTop(
                index,
                anchors.length,
                railHeight,
              )
              - (
                MARKER_HEIGHT_PX
                / 2
              );

            return (
              <button
                key={anchor.id}
                type="button"
                style={{
                  all:
                    "unset",
                  position:
                    "absolute",
                  top:
                    markerTop,
                  right:
                    0,
                  display:
                    "block",
                  boxSizing:
                    "border-box",
                  left:
                    "auto",
                  width:
                    ACTIVE_MARKER_WIDTH_PX,
                  minWidth:
                    ACTIVE_MARKER_WIDTH_PX,
                  maxWidth:
                    ACTIVE_MARKER_WIDTH_PX,
                  height:
                    MARKER_HEIGHT_PX,
                  minHeight:
                    MARKER_HEIGHT_PX,
                  maxHeight:
                    MARKER_HEIGHT_PX,
                  borderRadius:
                    0,
                  backgroundColor:
                    markerColor,
                  backgroundImage:
                    "none",
                  boxShadow:
                    "none",
                  lineHeight:
                    0,
                  cursor:
                    "pointer",
                  appearance:
                    "none",
                  WebkitAppearance:
                    "none",
                  transform:
                    `scaleX(${
                      markerWidth
                      / ACTIVE_MARKER_WIDTH_PX
                    })`,
                  transformOrigin:
                    "right center",
                  transition:
                    "transform 150ms ease, background-color 150ms ease",
                }}
                aria-label={
                  localize('turn.jumpTo', { index: index + 1, preview: anchor.preview })
                }
                title={
                  anchor.preview
                }
                onPointerEnter={() => {
                  setExpanded(true);
                  setHoveredTurnId(
                    anchor.id,
                  );
                  setRailHoveredTurnId(
                    anchor.id,
                  );
                }}
                onFocus={() => {
                  setExpanded(true);
                  setHoveredTurnId(
                    anchor.id,
                  );
                  setRailHoveredTurnId(
                    anchor.id,
                  );
                }}
                onClick={() =>
                  handleNavigate(
                    anchor,
                  )
                }
              />
            );
          },
        )}
      </div>
    </div>
  );
}