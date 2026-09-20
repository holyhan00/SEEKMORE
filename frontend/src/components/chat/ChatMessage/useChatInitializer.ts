                                                                 
import { localizeText } from '../../../localization/localization';
import { useSetRecoilState } from 'recoil';
import { api } from '../../../lib/api';
import { 
  selectedAgentIdState, 
  selectedConversationIdState,
} from '../store/chatState';

interface Agent {
  id: string;
  name: string;
  avatarUrl?: string;
  lastMessage?: string;
}

export const useChatInitializer = () => {
  const setAgentId = useSetRecoilState(selectedAgentIdState);
  const setSelectedConversationId = useSetRecoilState(selectedConversationIdState);

     
                
                           
                                                      
                                   
                               
     
  const initChatWithAgent = async (agent: Agent): Promise<string | null> => {
    try {
      const res = await api.get(`/chat/${agent.id}/conversation/init`);
      const conversationId: string | undefined = res.data?.data?.conversationId;
      if (!conversationId) throw new Error(localizeText('chat.init.missingConversationId'));

                  
      setAgentId(agent.id);
      setSelectedConversationId(conversationId);

                     
      return conversationId;
    } catch (err) {
      console.error('[ChatInitializer] Failed to initialize conversation', err);
      return null;
    }
  };

  return initChatWithAgent;
};
