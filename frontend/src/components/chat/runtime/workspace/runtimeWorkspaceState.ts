import { atomFamily } from 'recoil';
import {
  emptyRuntimeConversationSettings,
  type RuntimeConversationSettingsState,
} from './runtime-workspace.types';

export const conversationRuntimeSettingsState = atomFamily<
  RuntimeConversationSettingsState,
  string
>({
  key: 'conversationRuntimeSettingsState',
  default: (conversationId) => emptyRuntimeConversationSettings(conversationId),
});
