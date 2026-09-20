export type ConversationBranchResult = {
  conversation: {
    id: string;
    title: string;
    agentId: string;
    createdAt: Date;
    titleVersion: number;
    titleUpdatedAt: Date | null;
    messageCount: number;
  };
  branch: {
    parentConversationId: string;
    branchFromMessageId: string;
    requestId: string;
    idempotent: boolean;
  };
};
