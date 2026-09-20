export interface SeekmorePrismaModelDelegate {
  findUnique(args: unknown): Promise<unknown>;
  findFirst(args: unknown): Promise<unknown>;
  findMany(args?: unknown): Promise<unknown[]>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  upsert(args: unknown): Promise<unknown>;
  delete(args: unknown): Promise<unknown>;
}

export interface SeekmorePrismaClientLike {
  mcpServerConfig: SeekmorePrismaModelDelegate;
  mcpAuthSession: SeekmorePrismaModelDelegate;
  mcpOAuthState: SeekmorePrismaModelDelegate;
  mcpConnectionState: SeekmorePrismaModelDelegate;
  mcpToolSnapshot: SeekmorePrismaModelDelegate;
  mcpToolInvocation: SeekmorePrismaModelDelegate;
  mcpAuditLog: SeekmorePrismaModelDelegate;
}
