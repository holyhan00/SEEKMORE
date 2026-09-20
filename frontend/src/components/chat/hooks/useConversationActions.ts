                                                    
import { localizeText } from '../../../localization/localization';
import { useCallback, useMemo, useState } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import {
  selectedAgentIdState,
  selectedConversationIdState,
} from '../store/chatState';
import { deleteConversation, emitConversationDeleted, emitConversationRemarked } from '../../../lib/conversation-api';
import { renameChatTitle } from '../../../lib/chat-api';

   
                             
                                                                     
                                             
                                
   
type UseConversationActionsOptions = {
                                                           
  getTitleVersion?: (conversationId: string) => number | undefined;
                                  
  clearSelectionOnDelete?: boolean;
                        
  onDeleted?: (conversationId: string) => void;
  onRemarked?: (conversationId: string, title: string) => void;
};

export function useConversationActions(opts: UseConversationActionsOptions = {}) {
  const {
    getTitleVersion,
    clearSelectionOnDelete = true,
    onDeleted,
    onRemarked,
  } = opts;

  const agentId = useRecoilValue(selectedAgentIdState);
  const [currentConversationId, setSelectedConversationId] = useRecoilState(selectedConversationIdState);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [remarkingId, setRemarkingId] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  const isBusy = useMemo(() => !!deletingId || !!remarkingId, [deletingId, remarkingId]);

                     
  const remark = useCallback(
    async (conversationId: string, title: string) => {
      if (!conversationId) return;
      const trimmed = (title || '').trim();
      if (!trimmed) return;

      setError('');
      setRemarkingId(conversationId);
      try {
        const tv = getTitleVersion?.(conversationId);
                                
        await renameChatTitle(conversationId, { title: trimmed, ...(typeof tv === 'number' ? { titleVersion: tv } : {}) });
                                                    
        emitConversationRemarked({ conversationId, title: trimmed, agentId });
        onRemarked?.(conversationId, trimmed);
      } catch (e: any) {
        setError(e?.message || localizeText('chat.conversation.remarkFailed'));
        throw e;
      } finally {
        setRemarkingId(null);
      }
    },
    [agentId, getTitleVersion, onRemarked]
  );

              
  const remove = useCallback(
    async (conversationId: string) => {
      if (!conversationId) return;

      setError('');
      setDeletingId(conversationId);
      try {
        await deleteConversation(conversationId);
                                             
        if (clearSelectionOnDelete && currentConversationId === conversationId) {
          setSelectedConversationId(null);
        }
        emitConversationDeleted({ conversationId, agentId });
        onDeleted?.(conversationId);
      } catch (e: any) {
        setError(e?.message || localizeText('chat.conversation.deleteFailed'));
        throw e;
      } finally {
        setDeletingId(null);
      }
    },
    [agentId, clearSelectionOnDelete, currentConversationId, setSelectedConversationId, onDeleted]
  );

  return {
              
    remark,                                                            
    remove,                                                  

            
    deletingId,
    remarkingId,
    isBusy,
    error,
  };
}