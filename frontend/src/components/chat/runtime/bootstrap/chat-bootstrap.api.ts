import { api } from '../../../../lib/api';
import type { ChatBootstrapResponse } from './chat-bootstrap.types';

export async function getChatBootstrap(
  agentId: string,
  conversationId: string,
): Promise<ChatBootstrapResponse> {
  const response = await api.get(
    `/chat/${encodeURIComponent(conversationId)}/bootstrap`,
    { params: { agentId } },
  );
  return response.data?.data as ChatBootstrapResponse;
}
