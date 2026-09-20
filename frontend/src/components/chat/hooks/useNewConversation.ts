                                                
import { useCallback, useState } from 'react';
import { useSetRecoilState } from 'recoil';
import { messageListState, messageMapState, selectedConversationIdState } from '../store/chatState';

type UseNewConversationOpts = {
  onCreated?: (info: {
    conversationId: string;
    title: string;
    agentId: string;
    createdAt: string;
    titleVersion: number;
    titleUpdatedAt: string;
  }) => void;
};

   
                                   
                                                        
   
export function useNewConversation(agentId?: string | null, opts: UseNewConversationOpts = {}) {
  const setSelectedConversationId = useSetRecoilState(selectedConversationIdState);
  const setMessageList = useSetRecoilState(messageListState);
  const setMessageMap = useSetRecoilState(messageMapState);
  const [creating, setCreating] = useState(false);

  const startNewConversation = useCallback(async () => {
    if (!agentId) return;

    setCreating(true);
    try {
                        
      const tempId = `temp-${Date.now()}`;

                        
      setSelectedConversationId(tempId);

                                     
      setMessageList([]);
      setMessageMap(prev => ({ ...prev, [tempId]: [] }));

                           
      opts.onCreated?.({
        conversationId: tempId,
        title: '',
        agentId,
        createdAt: new Date().toISOString(),
        titleVersion: 1,
        titleUpdatedAt: new Date().toISOString(),
      });

      return {
        conversationId: tempId,
        title: '',
        agentId,
        createdAt: new Date().toISOString(),
        titleVersion: 1,
        titleUpdatedAt: new Date().toISOString(),
        isTemp: true as const,
      };
    } finally {
      setCreating(false);
    }
  }, [agentId, opts, setSelectedConversationId, setMessageList, setMessageMap]);

  return { startNewConversation, creating };
}