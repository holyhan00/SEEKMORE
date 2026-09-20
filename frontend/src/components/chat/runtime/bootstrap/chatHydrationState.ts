import { atomFamily } from 'recoil';

export type ChatHydrationStatus = 'idle' | 'loading' | 'ready' | 'refreshing' | 'error';

export interface ChatHydrationState {
  conversationId: string | null;
  status: ChatHydrationStatus;
  hydratedAt: number | null;
  error: string | null;
}

export const emptyChatHydrationState = (): ChatHydrationState => ({
  conversationId: null,
  status: 'idle',
  hydratedAt: null,
  error: null,
});

export const chatHydrationState = atomFamily<ChatHydrationState, string>({
  key: 'chatHydrationState',
  default: emptyChatHydrationState(),
});
