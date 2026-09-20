import CognitiveAgentPanel from '../components/myagent/cognitive/CognitiveAgentPanel';
import EmbodiedAgentPanel from '../components/myagent/embodied/EmbodiedAgentPanel';
import type { MyAgentSection } from '../components/myagent/myagent.types';
import ToolPluginLibraryPage from '../components/myagent/tools/ToolPluginLibraryPage';
import SkillLibraryPage from '../components/myagent/skill/SkillLibraryPage';
import McpPanel from '../components/myagent/mcp/McpPanel';
import type { McpManagementRequest } from '../components/myagent/mcp/mcp.types';
import ConversationRecyclePanel from '../components/recycle/ConversationRecyclePanel';

interface MyAgentPanelProps {

  section: MyAgentSection;
  mcpManagementRequest?: McpManagementRequest | null;
}

export default function MyAgentPanel({
    section,
  mcpManagementRequest = null,
}: MyAgentPanelProps) {
  switch (section) {
    case 'cognitive':
      return <CognitiveAgentPanel  />;

    case 'embodied':
      return <EmbodiedAgentPanel  />;

    case 'skill':
      return <SkillLibraryPage  />;

    case 'mcp':
      return (
        <McpPanel

          managementRequest={mcpManagementRequest}
        />
      );

    case 'plugins':
      return <ToolPluginLibraryPage  />;

    case 'recycle':
      return <ConversationRecyclePanel  />;

    default:
      return null;
  }
}
