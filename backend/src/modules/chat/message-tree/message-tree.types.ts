import type { Prisma } from '@prisma/client';

export interface ResolveUserMessageContextInput {
  userId: string;
  conversationId: string;
  requestedParentMessageId?: string | null;
  clientMessageId?: string | null;
  traceId: string;
  workspaceId?: string | null;
}

export interface UserMessageCreateContext {
  parentMessageId: string | null;
  rootMessageId: string | null;
  branchId: string;
  taskBoundaryReset: boolean;
  contextBoundary: boolean;
  workspaceId: string | null;
  previousWorkspaceId: string | null;
  workspaceChanged: boolean;
  workspaceResumed: boolean;
}

export interface CreateUserMessageInput {
  conversationId: string;
  userId: string;
  agentId: string;
  content: string;
  traceId: string;
  clientMessageId?: string | null;
}

export interface CreateAssistantShellInput {
  conversationId: string;
  agentId: string;
  parentMessageId: string;
  traceId: string;
  model?: string | null;
  endpoint?: string | null;
}

export interface MessageTreeNodeView {
  id: string;
  conversationId: string;
  parentMessageId: string | null;
  rootMessageId: string | null;
  branchId: string | null;
  role: string;
  content: string;
  citations?: unknown[] | null;
  meta?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface MessageBranch {
  conversationId: string;
  leafMessageId: string | null;
  messages: MessageTreeNodeView[];
}

export type MessageTreeTransaction = Prisma.TransactionClient;
