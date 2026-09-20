import React from 'react';
import ChatPanel from '../components/chat/chatpanel/ChatPanel';
import MyAgentNavigationPanel from '../components/myagent/MyAgentNavigationPanel';
import type { MyAgentSection } from '../components/myagent/myagent.types';

type ViewType = 'chat' | 'myagent' | 'explore' | 'library';

interface SidebarProps {
  collapsed: boolean;
  currentView: ViewType;
  myAgentSection: MyAgentSection;
  onMyAgentSectionChange: (section: MyAgentSection) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  currentView,
  myAgentSection,
  onMyAgentSectionChange,
}) => {
  if (collapsed) return null;

  return (
    <div
      className="h-full w-full overflow-hidden bg-surface-base"
    >
      {currentView === 'chat' && (
        <div className="flex h-full w-full justify-center">
          <ChatPanel compactHeader />
        </div>
      )}

      {currentView === 'myagent' && (
        <MyAgentNavigationPanel
          selected={myAgentSection}
          onChange={onMyAgentSectionChange}
        />
      )}
    </div>
  );
};

export default Sidebar;
