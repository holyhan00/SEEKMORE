// frontend/src/pages/Home.tsx

import {
  useEffect,
  useState,
} from 'react';
import {
  useRecoilValue,
} from 'recoil';

import ConfirmHost from '../common/modals/ConfirmHost';
import Chat from '../components/chat/Chat';
import ChatObjectPreviewPanel from '../components/chat/object-preview/ChatObjectPreviewPanel';
import {
  ObjectPreviewProvider,
} from '../components/chat/object-preview/ObjectPreviewProvider';
import {
  selectedConversationIdState,
} from '../components/chat/store/chatState';
import MyAgentPanel from './MyAgentPanel';
import Explore from './Explore';
import LeftSidebar from './LeftSidebar';
import Sidebar from './Panel';

import SettingsModal from '../components/settings/SettingModal';
import type {
  SettingMenuKey,
} from '../components/settings/SettingMenu';
import type {
  MyAgentSection,
} from '../components/myagent/myagent.types';
import type {
  McpManagementRequest,
} from '../components/myagent/mcp/mcp.types';

const LEFT_W = 68;
const PANEL_W = 200;
const PANEL_AUTO_COLLAPSE_WIDTH = 900;

type ViewType =
  | 'chat'
  | 'myagent'
  | 'explore';

const Home = () => {
  const conversationId =
    useRecoilValue(
      selectedConversationIdState,
    );

  const [
    collapsed,
    setCollapsed,
  ] = useState(false);

  const [
    compactLayout,
    setCompactLayout,
  ] = useState(
    () =>
      window.innerWidth
      < PANEL_AUTO_COLLAPSE_WIDTH,
  );

  const [
    view,
    setView,
  ] = useState<ViewType>(
    'chat',
  );

  const [
    myAgentSection,
    setMyAgentSection,
  ] = useState<MyAgentSection>(
    'cognitive',
  );

  const [
    isSettingsOpen,
    setIsSettingsOpen,
  ] = useState(false);

  const [
    mcpManagementRequest,
    setMcpManagementRequest,
  ] =
    useState<McpManagementRequest | null>(
      null,
    );

  const [
    settingsInitialKey,
    setSettingsInitialKey,
  ] = useState<SettingMenuKey>(
    'general',
  );

  const effectiveCollapsed =
    collapsed
    || compactLayout;

  useEffect(() => {
    const handleResize = () => {
      setCompactLayout(
        window.innerWidth
        < PANEL_AUTO_COLLAPSE_WIDTH,
      );
    };

    handleResize();

    window.addEventListener(
      'resize',
      handleResize,
    );

    return () =>
      window.removeEventListener(
        'resize',
        handleResize,
      );
  }, []);

  useEffect(() => {
    if (
      view === 'myagent'
    ) {
      setCollapsed(false);
    }
  }, [
    view,
  ]);

  useEffect(() => {
    const handler = (
      event: Event,
    ) => {
      const customEvent =
        event as CustomEvent<ViewType>;

      setView(
        customEvent.detail,
      );
    };

    window.addEventListener(
      'changeView',
      handler,
    );

    return () =>
      window.removeEventListener(
        'changeView',
        handler,
      );
  }, []);

  useEffect(() => {
    const handler = (
      event: Event,
    ) => {
      const customEvent =
        event as CustomEvent<{
          installationId?: string;
          action?:
            | 'configure'
            | 'setup';
        }>;

      const installationId =
        String(
          customEvent.detail
            ?.installationId
            ?? '',
        ).trim();

      if (
        !installationId
      ) {
        return;
      }

      setMcpManagementRequest({
        installationId,
        action:
          customEvent.detail
            ?.action
            === 'setup'
            ? 'setup'
            : 'configure',
        requestId:
          Date.now(),
      });

      setMyAgentSection(
        'mcp',
      );

      setCollapsed(
        false,
      );

      setView(
        'myagent',
      );
    };

    window.addEventListener(
      'mcp:manage',
      handler,
    );

    return () =>
      window.removeEventListener(
        'mcp:manage',
        handler,
      );
  }, []);

  return (
    <div className="w-full h-full overflow-hidden bg-transparent">
      <ConfirmHost />

      {isSettingsOpen && (
        <SettingsModal
          isOpen={
            isSettingsOpen
          }
          onClose={() =>
            setIsSettingsOpen(
              false,
            )
          }
          initialActiveKey={
            settingsInitialKey
          }
        />
      )}

      <div className="flex h-full w-full bg-transparent">
        <div
          className="flex-none h-full bg-transparent"
          style={{
            width:
              LEFT_W,
          }}
        >
          <LeftSidebar
            currentView={
              view
            }
            setView={
              setView
            }
            onOpenSettings={() => {
              setSettingsInitialKey(
                'general',
              );

              setIsSettingsOpen(
                true,
              );
            }}
            isSettingsOpen={
              isSettingsOpen
            }
          />
        </div>

        {view !==
          'explore' && (
          <div
            className="flex-none h-full overflow-hidden bg-transparent transition-[width] duration-200 ease-in-out"
            style={{
              width:
                effectiveCollapsed
                  ? 0
                  : PANEL_W,
              willChange:
                'width',
            }}
          >
            <div
              className="h-full"
              style={{
                width:
                  PANEL_W,
                minWidth:
                  PANEL_W,
              }}
            >
              <Sidebar
                collapsed={
                  effectiveCollapsed
                }
                currentView={
                  view
                }
                myAgentSection={
                  myAgentSection
                }
                onMyAgentSectionChange={
                  setMyAgentSection
                }
              />
            </div>
          </div>
        )}

        <div className="min-w-0 flex-1 h-full flex bg-surface-chat">
          <ObjectPreviewProvider
            conversationId={
              conversationId
            }
          >
            <div className="basis-0 flex-1 min-w-0 h-full overflow-hidden relative flex">
              <div className="basis-0 flex-1 min-w-0 h-full overflow-hidden relative flex flex-col">
                {view !==
                  'chat' && (
                  <div
                    data-desktop-drag-region
                    className="flex-none h-11.25 sticky top-0 z-20 bg-[#f7f7f7] dark:bg-surface-chat"
                  />
                )}

                <div className="min-h-0 flex-1 overflow-hidden">
                  {view ===
                  'myagent' ? (
                    <MyAgentPanel
                      section={
                        myAgentSection
                      }
                      mcpManagementRequest={
                        mcpManagementRequest
                      }
                    />
                  ) : view ===
                    'explore' ? (
                    <Explore />
                  ) : (
                    <Chat
                      collapsed={
                        effectiveCollapsed
                      }
                      setCollapsed={
                        setCollapsed
                      }
                      onOpenModelSettings={() => {
                        setSettingsInitialKey(
                          'model',
                        );

                        setIsSettingsOpen(
                          true,
                        );
                      }}
                    />
                  )}
                </div>
              </div>

              {view ===
                'chat' && (
                <ChatObjectPreviewPanel />
              )}
            </div>
          </ObjectPreviewProvider>
        </div>
      </div>
    </div>
  );
};

export default Home;