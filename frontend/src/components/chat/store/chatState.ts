                                                 
import { atom, atomFamily } from 'recoil';
import { Message } from '../../../utils/types'; 
import { emptyChatTurnState, type ChatConversationTurnState } from './chat-turn-state.reducer';

export const conversationIdState = atom<string | null>({
  key: 'conversationIdState',
  default: null,
});

export const selectedConversationIdState = atom<string | null>({
  key: 'selectedConversationIdState',
  default: null,
});

export const messageMapState = atom<Record<string, Message[]>>({
  key: 'messageMapState',
  default: {},
});

export const messageListState = atom<Message[]>({
  key: 'messageListState',
  default: [],
});



export const selectedAgentIdState = atom<string | null>({
  key: 'selectedAgentIdState',
  default: null,
});


export const streamingCountState = atomFamily<number, string>({
  key: 'streamingCountState',
  default: 0,
});

export const chatConversationTurnState = atomFamily<ChatConversationTurnState, string>({
  key: 'chatConversationTurnState',
  default: (conversationId) => emptyChatTurnState(conversationId),
});
