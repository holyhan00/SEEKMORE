import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { JsonObject } from '../domain/json.types';
import type { McpPrincipal } from '../domain/mcp-runtime.types';
import { McpSecretCipherService } from '../application/mcp-secret-cipher.service';
import type {
  McpAuthSessionRepository,
  McpStoredOAuthSession,
} from './mcp-auth-session.repository';

@Injectable()
export class PrismaMcpAuthSessionRepository
  implements McpAuthSessionRepository
{
  private readonly db: any;

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    private readonly cipher: McpSecretCipherService,
  ) {
    this.db = prisma as any;
  }

  async upsertOAuthSession(input: {
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
  }): Promise<{ id: string }> {
    const encrypted = this.cipher.encrypt({
      accessToken: input.accessToken,
      ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
    });
    const tenantId = input.principal.tenantId ?? '';
    const agentId = input.principal.agentId ?? '';
    const row = await this.db.mcpAuthSession.upsert({
      where: {
        serverId_tenantId_userId_agentId: {
          serverId: input.serverId,
          tenantId,
          userId: input.principal.userId,
          agentId,
        },
      },
      create: {
        serverId: input.serverId,
        tenantId,
        userId: input.principal.userId,
        agentId,
        status: 'active',
        authKind: 'oauth2',
        accessToken: null,
        refreshToken: null,
        ...encrypted,
        tokenType: input.tokenType,
        scope: input.scope,
        expiresAt: input.expiresAt,
        metadata: input.metadata ?? {},
      },
      update: {
        status: 'active',
        accessToken: null,
        refreshToken: null,
        ...encrypted,
        tokenType: input.tokenType,
        scope: input.scope,
        expiresAt: input.expiresAt,
        metadata: input.metadata ?? {},
      },
    });

    return { id: String(row.id) };
  }

  async findOAuthSession(input: {
    serverId: string;
    userId: string;
    agentId?: string;
  }): Promise<McpStoredOAuthSession | null> {
    const row = await this.db.mcpAuthSession.findUnique({
      where: {
        serverId_tenantId_userId_agentId: {
          serverId: input.serverId,
          tenantId: '',
          userId: input.userId,
          agentId: input.agentId ?? '',
        },
      },
    });
    if (!row) return null;

    const secrets = row.encryptedPayload
      ? this.cipher.decrypt({
          encryptedPayload: row.encryptedPayload,
          encryptionIv: row.encryptionIv,
          authTag: row.authTag,
        })
      : {};

    return {
      id: String(row.id),
      serverId: String(row.serverId),
      userId: String(row.userId),
      agentId: row.agentId ? String(row.agentId) : undefined,
      status: String(row.status),
      accessToken:
        secrets.accessToken ??
        (typeof row.accessToken === 'string' ? row.accessToken : undefined),
      refreshToken:
        secrets.refreshToken ??
        (typeof row.refreshToken === 'string' ? row.refreshToken : undefined),
      clientId: secrets.clientId,
      clientSecret: secrets.clientSecret,
      tokenType:
        typeof row.tokenType === 'string' ? row.tokenType : undefined,
      scope: typeof row.scope === 'string' ? row.scope : undefined,
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt : undefined,
      metadata: (row.metadata ?? {}) as JsonObject,
    };
  }

  async setOAuthSessionStatus(input: {
    serverId: string;
    userId: string;
    agentId?: string;
    status: 'active' | 'expired' | 'revoked';
  }): Promise<void> {
    await this.db.mcpAuthSession.updateMany({
      where: {
        serverId: input.serverId,
        tenantId: '',
        userId: input.userId,
        agentId: input.agentId ?? '',
      },
      data: { status: input.status },
    });
  }

  async updateOAuthSessionMetadata(input: {
    serverId: string;
    userId: string;
    agentId?: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.db.mcpAuthSession.updateMany({
      where: {
        serverId: input.serverId,
        tenantId: '',
        userId: input.userId,
        agentId: input.agentId ?? '',
      },
      data: { metadata: input.metadata },
    });
  }

  async deleteOAuthSession(input: {
    serverId: string;
    userId: string;
    agentId?: string;
  }): Promise<void> {
    await this.db.mcpAuthSession.deleteMany({
      where: {
        serverId: input.serverId,
        tenantId: '',
        userId: input.userId,
        agentId: input.agentId ?? '',
      },
    });
  }
}
