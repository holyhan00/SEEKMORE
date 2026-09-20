import { api } from './http';

export type ConversationBranchResponse = {
  conversation: {
    id: string;
    title: string;
    agentId: string;
    createdAt: string;
    titleVersion: number;
    titleUpdatedAt: string | null;
    messageCount: number;
  };
  branch: {
    parentConversationId: string;
    branchFromMessageId: string;
    requestId: string;
    idempotent: boolean;
  };
};

export async function createConversationBranch(input: {
  conversationId: string;
  fromMessageId: string;
  requestId: string;
}): Promise<ConversationBranchResponse> {
  const response = await api.post<ConversationBranchResponse | { data: ConversationBranchResponse }>(
    `/chat/conversation/${encodeURIComponent(input.conversationId)}/branches`,
    {
      fromMessageId: input.fromMessageId,
      requestId: input.requestId,
    },
  );
  const payload = response.data as ConversationBranchResponse | { data: ConversationBranchResponse };
  return 'data' in payload ? payload.data : payload;
}
