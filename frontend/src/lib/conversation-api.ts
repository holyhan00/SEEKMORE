                                       
import { api } from './api';

                  
export type SoftDeleteResp = {
  ok: boolean;
  deletedAt: string | null;
  purgeAfter: string | null;
};

                       
                                                      
export async function deleteConversation(conversationId: string): Promise<SoftDeleteResp> {
  const { data } = await api.delete(`/chat/conversation/${conversationId}`);
                                               
  return data;
}

                                 
export function emitConversationDeleted(payload: { conversationId: string; agentId?: string | null }) {
  window.dispatchEvent(new CustomEvent('chat:conversation:deleted', { detail: payload }));
}

export function emitConversationRemarked(payload: {
  conversationId: string;
  title: string;
  agentId?: string | null;
}) {
  window.dispatchEvent(new CustomEvent('chat:conversation:remarked', { detail: payload }));
}