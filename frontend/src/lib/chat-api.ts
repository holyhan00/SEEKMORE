                               
import { api } from './http';
import type { RuntimeDeliveryProjection } from '../components/chat/runtime/events/runtime-events.types';

                                             
export type TitleInfo = {
  conversationId: string;
  title: string;
  titleVersion: number;
  titleUpdatedAt: string;
  agentId?: string;
  createdAt?: string;
};

export type TitleListItem = {
  id: string;
  title: string;
  createdAt: string;
  lastMessageAt: string | null;
  messageCount: number;
  titleVersion: number;
  titleUpdatedAt: string;
};


export type ConversationSearchItem = {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
  lastMessageAt: string | null;
};

export type ConversationSearchResp = {
  items: ConversationSearchItem[];
};

export type TitleListResp = {
  items: TitleListItem[];
  nextCursor: string | null;
};

                         
export const initConversation = async (agentId: string) => {
  const { data } = await api.get(`/chat/${agentId}/conversation/init`);
  return data?.data?.conversationId as string;
};

export type NewConversationResp = {
  conversationId: string;
  title: string;
  agentId: string;
  createdAt: string;
  titleVersion: number;
  titleUpdatedAt: string;
};

export type ChatRuntimeResponseFields = {
  deliverySnapshot?: RuntimeDeliveryProjection;
  runtimeTurnId?: string;
  topicId?: string;
  traceId?: string;
};

export const createConversation = async (payload: { agentId: string }): Promise<NewConversationResp> => {
  const { data } = await api.post(`/chat/conversation/create`, payload);
  const raw = data?.data ?? data;
  return {
    conversationId: raw.conversationId ?? raw.id,
    title: String(raw.title ?? ''),
    agentId: raw.agentId,
    createdAt: raw.createdAt,
    titleVersion: raw.titleVersion ?? 1,
    titleUpdatedAt: raw.titleUpdatedAt ?? raw.createdAt,
  } as NewConversationResp;
};

   
                    
                                                    
                                                           
   
export const createChatTitle = async (_payload: {
  agentId: string;
  firstMessage: string;
  conversationId?: string;
}) => {
                                             
  const convId = _payload?.conversationId;
  if (!convId) throw new Error('conversationId is required in new API. Use ensureTitleFromDB().');
  return ensureTitleFromDB(convId);
};

                                          
export const ensureTitleFromDB = async (conversationId: string) => {
  const { data } = await api.post<TitleInfo>(`/chat/title/generate`, { conversationId });
  return data;
};

                                             
export const generateTitleBySeed = async (payload: {
  conversationId: string;
  seed: string;
  strategy?: 'FIRST_MESSAGE' | 'RULE';
}) => {
  const { data } = await api.post<TitleInfo>(`/chat/title/generate-by-seed`, payload);
  return data;
};

export const renameChatTitle = async (
  conversationId: string,
  payload: { title: string; titleVersion?: number }
) => {
  const { data } = await api.patch<TitleInfo>(`/chat/title/${conversationId}`, payload);
  return data;
};

export const listChatTitles = async (
  agentId: string,
  opts?: { cursor?: string | null; limit?: number }
) => {
  const params: any = { agentId, limit: opts?.limit ?? 20 };
  if (opts?.cursor) params.cursor = opts.cursor;
  const { data } = await api.get<TitleListResp>(`/chat/title/list`, { params });
  return data;
};


export const searchChatTitles = async (
  query: string,
  opts?: { limit?: number },
): Promise<ConversationSearchResp> => {
  const { data } = await api.get<ConversationSearchResp>(
    '/chat/title/search',
    {
      params: {
        q: query,
        limit: opts?.limit ?? 8,
      },
    },
  );

  return data;
};

export const getChatTitle = async (conversationId: string) => {
  const { data } = await api.get(`/chat/title/${conversationId}`);
  return {
    conversationId: data.id,
    title: data.title,
    titleVersion: data.titleVersion,
    titleUpdatedAt: data.titleUpdatedAt,
    agentId: data.agentId,
    createdAt: data.createdAt,
  } as TitleInfo;
};
