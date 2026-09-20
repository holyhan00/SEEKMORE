import type { McpOAuthState, McpPrincipal } from '../../domain/mcp-runtime.types';

export interface McpOAuthStateRepository {
  create(input: {
    serverId: string;
    principal: McpPrincipal;
    state: string;
    codeVerifier?: string;
    clientSecret?: string;
    redirectUri: string;
    expiresAt: Date;
    metadata?: Record<string, unknown>;
  }): Promise<McpOAuthState>;
  findByState(state: string): Promise<McpOAuthState | null>;
  consume(state: string): Promise<McpOAuthState | null>;
}
