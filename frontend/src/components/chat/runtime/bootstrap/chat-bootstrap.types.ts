import type { Message } from '../../../../utils/types';
import type { ChatTurnQueueSnapshot } from '../../hooks/socket/chat-turn-contracts';
import type { ActiveWorkflowSnapshot } from '../workflow/workflow.types';
import type { RuntimeConversationSettingsView } from '../workspace/runtime-workspace.types';

export interface ChatBootstrapResponse {
  conversationId: string;
  messages: unknown[];
  runtimeTimeline: {
    events: unknown[];
    nextCursor: string | null;
  };
  workflow: ActiveWorkflowSnapshot | null;
  turn: ChatTurnQueueSnapshot | null;
  runtimeSettings: RuntimeConversationSettingsView;
  generatedAt: number;
}

export interface PreparedChatBootstrap {
  conversationId: string;
  messages: Message[];
  workflow: ActiveWorkflowSnapshot | null;
  turn: ChatTurnQueueSnapshot | null;
  runtimeSettings: RuntimeConversationSettingsView;
  generatedAt: number;
}
