import type { JsonObject } from '../domain/json.types';
import type { McpPrincipal } from '../domain/mcp-runtime.types';

export interface McpStoredOAuthSession {
  id: string;
  serverId: string;
  userId: string;
  agentId?: string;
  status: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: Date;
  metadata: JsonObject;
}

export interface McpAuthSessionRepository {
  upsertOAuthSession(input: {
    serverId: string;
    principal: McpPrincipal;
    accessToken: string;
    refreshToken?: string;
    clientId?: string;
    clientSecret?: string;
    tokenType?: string;
    scope?: string;
    expiresAt?: Date;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }>;

  findOAuthSession(input: {
    serverId: string;
    userId: string;
    agentId?: string;
  }): Promise<McpStoredOAuthSession | null>;

  setOAuthSessionStatus(input: {
    serverId: string;
    userId: string;
    agentId?: string;
    status: 'active' | 'expired' | 'revoked';
  }): Promise<void>;

  updateOAuthSessionMetadata(input: {
    serverId: string;
    userId: string;
    agentId?: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;

  deleteOAuthSession(input: {
    serverId: string;
    userId: string;
    agentId?: string;
  }): Promise<void>;
}
