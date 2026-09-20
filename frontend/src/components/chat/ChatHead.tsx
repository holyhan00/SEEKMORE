// frontend/src/components/chat/ChatHead.tsx
import { resolveAssetUrl } from '../../utils/asset-url';
import { useAppearance } from '../../theme/useAppearance';

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
} from 'react';
import ChatListButton from './chatlist/ChatListButton';
import NewConversationButton from './NewConversationButton';
import TimeMiniPanel from './time/TimeMiniPanel';
import { useTimeReminder } from './time/useTimeReminder';
import { cn } from '../../lib/utils';
import { useLocalize } from '../../localization/useLocalize';

interface ChatHeadProps {
  currentTitle: string;

  collapsed?: boolean;
  setCollapsed?: (
    collapsed: boolean,
  ) => void;
  dropdownChats?: {
    id: string;
    title: string;
  }[];
  dropdownLoading?: boolean;
  onDropdownClick?: () => void;
  onSelectConversation?: (
    id: string,
  ) => void;
  onNewConversation?: () => void;
  titleLoading?: boolean;
  onRenameTitle?: (
    newTitle: string,
  ) => Promise<void> | void;
}

const HEADER_H = 45;
const TOGGLE_BOX = 28;
const TOGGLE_ICON = 18;
const RIGHT_ICON = 18;
const TIME_PANEL_WIDTH = 320;

const ChatHead: React.FC<
  ChatHeadProps
> = ({
  currentTitle,
  collapsed = false,
  setCollapsed,
  dropdownChats = [],
  dropdownLoading = false,
  onDropdownClick,
  onSelectConversation,
  onNewConversation,
  titleLoading = false,
  onRenameTitle,
}) => {
  const {
    resolvedTheme,
  } = useAppearance();

  const isDarkTheme =
    resolvedTheme === 'dark';

  const localize =
    useLocalize();

  const displayTitle =
    currentTitle.trim()
    || localize(
      'chat.newConversation',
    );

  const localizedDropdownChats =
    dropdownChats.map(
      (chat) => ({
        ...chat,
        title:
          chat.title.trim()
          || localize(
            'chat.newConversation',
          ),
      }),
    );

  const headerRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const timeButtonRef =
    useRef<HTMLButtonElement | null>(
      null,
    );

  const {
    activeCount,
    ringing,
    panelOpenRequested,
    consumePanelOpenRequest,
  } = useTimeReminder();

  const [
    timePanel,
    setTimePanel,
  ] = useState({
    visible: false,
    x: 0,
    y: 0,
  });

  const handleToggleSidebar =
    () => {
      setCollapsed?.(
        !collapsed,
      );
    };

  const calcTimePanelPosition =
    useCallback(() => {
      const header =
        headerRef.current;

      const icon =
        timeButtonRef.current;

      if (!header) {
        return {
          x: 0,
          y: 0,
        };
      }

      const headerRect =
        header.getBoundingClientRect();

      const iconRect =
        icon
          ?.getBoundingClientRect()
        || headerRect;

      const y =
        Math.round(
          headerRect.bottom
          + 6,
        );

      let x =
        Math.round(
          iconRect.right
          - TIME_PANEL_WIDTH,
        );

      x = Math.max(
        8,
        Math.min(
          x,
          window.innerWidth
          - TIME_PANEL_WIDTH
          - 8,
        ),
      );

      return {
        x,
        y,
      };
    }, []);

  const handleTimeButtonClick =
    () => {
      const {
        x,
        y,
      } =
        calcTimePanelPosition();

      setTimePanel(
        (state) => ({
          visible:
            !state.visible,
          x,
          y,
        }),
      );
    };

  useEffect(() => {
    if (
      !panelOpenRequested
    ) {
      return;
    }

    const {
      x,
      y,
    } =
      calcTimePanelPosition();

    setTimePanel({
      visible: true,
      x,
      y,
    });

    consumePanelOpenRequest();
  }, [
    panelOpenRequested,
    consumePanelOpenRequest,
    calcTimePanelPosition,
  ]);

  useEffect(() => {
    if (
      !timePanel.visible
    ) {
      return;
    }

    const reposition =
      () => {
        const {
          x,
          y,
        } =
          calcTimePanelPosition();

        setTimePanel(
          (state) => ({
            ...state,
            x,
            y,
          }),
        );
      };

    window.addEventListener(
      'resize',
      reposition,
    );

    window.addEventListener(
      'scroll',
      reposition,
      true,
    );

    return () => {
      window.removeEventListener(
        'resize',
        reposition,
      );

      window.removeEventListener(
        'scroll',
        reposition,
        true,
      );
    };
  }, [
    timePanel.visible,
    calcTimePanelPosition,
  ]);

  return (
    <div
      ref={headerRef}
      data-desktop-drag-region
      className={cn(
        'relative w-full',
        'bg-surface-base',
      )}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,

        height:
          HEADER_H,
        minHeight:
          HEADER_H,
        maxHeight:
          HEADER_H,

        paddingTop: 4,

        boxShadow:
          '0 0 8px rgba(0, 0, 0, 0.03)',

        flexShrink: 0,
      }}
    >
      <div
        className="
          mx-auto
          flex
          h-full
          w-[95%]
          items-center
          justify-between
        "
      >
        <div
          data-desktop-no-drag
          className="
            flex
            flex-none
            items-center
            gap-[15px]
          "
        >
          <button
            type="button"
            className="
              flex
              cursor-pointer
              items-center
              justify-center
              border-0
              bg-transparent
              p-0
            "
            onClick={
              handleToggleSidebar
            }
            aria-label={
              localize(
                'chat.toggleSidebar',
              )
            }
            style={{
              width:
                TOGGLE_BOX,

              height:
                TOGGLE_BOX,

              flex:
                '0 0 auto',

              userSelect:
                'none',
            }}
          >
            <img
              src={
                isDarkTheme
                  ? resolveAssetUrl(
                      '/icons/white/hide1.svg',
                    )
                  : resolveAssetUrl(
                      '/icons/hide.svg',
                    )
              }
              alt=""
              aria-hidden="true"
              style={{
                width:
                  TOGGLE_ICON,

                height:
                  TOGGLE_ICON,

                transform:
                  collapsed
                    ? 'rotate(0deg)'
                    : 'rotate(180deg)',

                transition:
                  'transform 0.3s ease',

                userSelect:
                  'none',

                pointerEvents:
                  'none',
              }}
            />
          </button>

          <ChatListButton
            title={
              displayTitle
            }
            disabled={
              false
            }
            renameOnly={
              false
            }
            onDropdownClick={() => {
              onDropdownClick?.();
            }}
            onSelect={(id) => {
              onSelectConversation?.(
                id,
              );
            }}
            chats={
              localizedDropdownChats
            }
            loading={
              dropdownLoading
            }
            titleLoading={
              titleLoading
            }
            onRename={
              onRenameTitle
            }
          />

          <NewConversationButton
            onClick={() => {
              onNewConversation?.();
            }}
          />
        </div>

        <div
          data-desktop-no-drag
          className="
            flex
            flex-none
            items-center
          "
        >
          <button
            ref={
              timeButtonRef
            }
            type="button"
            title={
              localize(
                'time.title',
              )
            }
            aria-label={
              localize(
                'chat.openTimeRecords',
              )
            }
            className={cn(
              'relative flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 transition hover:opacity-80 active:opacity-60',
              timePanel.visible
                && 'opacity-60',
            )}
            style={{
              width:
                RIGHT_ICON,

              height:
                RIGHT_ICON,

              userSelect:
                'none',

              flex:
                '0 0 auto',
            }}
            onClick={
              handleTimeButtonClick
            }
          >
            <img
              src={
                ringing
                  ? resolveAssetUrl(
                      '/icons/time-red.svg',
                    )
                  : resolveAssetUrl(
                      '/icons/time.svg',
                    )
              }
              alt=""
              aria-hidden="true"
              style={{
                width:
                  RIGHT_ICON,

                height:
                  RIGHT_ICON,

                display:
                  'block',

                pointerEvents:
                  'none',

                filter:
                  !ringing
                  && isDarkTheme
                    ? 'invert(1)'
                    : 'none',
              }}
            />

            {activeCount >
              0 && (
              <span className="absolute h-[14px] min-w-[14px] rounded-full bg-red-500 px-[3px] text-center text-[8px] font-medium leading-[14px] text-[#ffffff]">
                {activeCount >
                99
                  ? '99+'
                  : activeCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <TimeMiniPanel
        visible={
          timePanel.visible
        }
        x={
          timePanel.x
        }
        y={
          timePanel.y
        }
        triggerRef={
          timeButtonRef
        }
        onClose={() =>
          setTimePanel(
            (state) => ({
              ...state,
              visible:
                false,
            }),
          )
        }
      />
    </div>
  );
};

export default ChatHead;