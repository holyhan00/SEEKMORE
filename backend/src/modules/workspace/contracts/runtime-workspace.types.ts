                                                           

export type RuntimeWorkspaceTrustLevel = 'none' | 'local_dev' | 'trusted' | 'restricted';

export interface RuntimeWorkspaceContext {
  workspaceId: string;
  rootPath: string;
  displayName: string;
  trustLevel: RuntimeWorkspaceTrustLevel;
  writable: boolean;
}

export interface RuntimeWorkspaceResolveInput {
  traceId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  workspaceId?: string | null;
}
