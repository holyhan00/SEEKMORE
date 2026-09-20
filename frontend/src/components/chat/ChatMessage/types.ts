import type { ChatObjectCard } from '../../../utils/types';

                                                    

export type Role = 'user' | 'agent' | 'system';
export type MemberType = 'USER' | 'AGENT';

export type SideNudge = {
  text: string;
  ctaText?: string;
  prefill?: string;
  cooldownKey?: string;
  intent?: string;
           
  actionType?: string;
  actionPayload?: any;
};

export type ACGIntentGraph = {
  id?: string;
  [k: string]: any;
};

   
                                                       
                                                            
                         
                                                         
   
export type ACGCard = {
  group?: any;
  graph?: ACGIntentGraph;

                                                   
  planPreview?: {
    previewId: string;
    title: string;
    summaryMarkdown: string;

    agents: Array<{
      agentId: string | null;
      name: string;
      capability: string;
    }>;

    roleAssignments: Record<
      string,
      {
        role: string;
        agent: { id: string | null; name: string | null };
      }
    >;

    graphPreview: {
      nodes: Array<{
        id: string;
        label: string;
        role: string | null;
        agentId: string | null;
      }>;
      edges: Array<{ from: string; to: string }>;
    };

    recommendedAgents: Array<{ id: string; name: string }>;

    createdAt: number;
  };

                      
  [k: string]: any;
};

export type ContentParsingResult = {
  pureText: string;
  cards: ACGCard[];
  lastCard: ACGCard | null;
  nudges: SideNudge[];
  firstNudge: SideNudge | null;
  resultPayload: any | null;                          
};

   
                
                                        
                                                          
   
export type SenderRef = {
  type: MemberType | 'SYSTEM';
                         
  id?: string;
                            
  userId?: string;
  agentId?: string;
                          
  displayNameSnapshot?: string;
                                    
  avatarVersionSnapshot?: number | Date;
};

   
              
                            
   
export type SenderSnapshots = {
  users: Record<
    string,
    {
      id: string;
      name: string | null;
      avatarKey: string | null;
      avatarUpdatedAt: Date | null;
    }
  >;
  agents: Record<
    string,
    {
      id: string;
      name: string | null;
      avatarKey: string | null;
      avatarUpdatedAt: Date | null;
    }
  >;
};

export type MemberProfile = {
  id: string;                                 
  type: MemberType;
  displayName?: string | null;
  avatarKey?: string | null;
  avatarUpdatedAt?: string | Date | null;
};

export type MembersIndex = {
  byUserId?: Record<string, MemberProfile>;
  byAgentId?: Record<string, MemberProfile>;
};

   
                                                                    
                                     
   
export type RuntimeCitation = {
  index: number;           
  title: string;
  url: string;
  snippet?: string;
};

export interface ChatMessageDTO {
  id: string;
  conversationId?: string;
  parentMessageId?: string | null;
  rootMessageId?: string | null;
  branchId?: string | null;
  branchable?: boolean;
  branchSnapshotBoundary?: boolean;
  role: 'user' | 'agent' | 'system';
  content: string;
  isMe?: boolean;
  isSystem?: boolean;
  payload?: any;
  senderType: MemberType | 'SYSTEM';
  senderUserId?: string;
  senderAgentId?: string;
  displayNameSnapshot?: string;
  avatarVersionSnapshot?: number | Date;
  createdAt: string | number | Date;
  citations?: RuntimeCitation[] | null;
  objects?: ChatObjectCard[];
  runtime?: any;
  meta?: any | null;
}
