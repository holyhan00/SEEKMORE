import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import type { JsonObject } from '../../domain/json.types';
import type { McpOAuthState, McpPrincipal } from '../../domain/mcp-runtime.types';
import { McpSecretCipherService } from '../../application/mcp-secret-cipher.service';
import type { McpOAuthStateRepository } from './mcp-oauth-state.repository';

@Injectable()
export class PrismaMcpOAuthStateRepository implements McpOAuthStateRepository {
  private readonly db: any;

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    private readonly cipher: McpSecretCipherService,
  ) {
    this.db = prisma as any;
  }

  async create(input: {
    serverId: string;
    principal: McpPrincipal;
    state: string;
    codeVerifier?: string;
    clientSecret?: string;
    redirectUri: string;
    expiresAt: Date;
    metadata?: Record<string, unknown>;
  }): Promise<McpOAuthState> {
    await this.db.mcpOAuthState.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const secrets: Record<string, string> = {};
    if (input.codeVerifier) secrets.codeVerifier = input.codeVerifier;
    if (input.clientSecret) secrets.clientSecret = input.clientSecret;
    const encrypted = Object.keys(secrets).length > 0
      ? this.cipher.encrypt(secrets)
      : null;
    const row = await this.db.mcpOAuthState.create({
      data: {
        serverId: input.serverId,
        tenantId: input.principal.tenantId,
        userId: input.principal.userId,
        agentId: input.principal.agentId,
        state: input.state,
        codeVerifier: null,
        encryptedCodeVerifier: encrypted?.encryptedPayload,
        codeVerifierIv: encrypted?.encryptionIv,
        codeVerifierAuthTag: encrypted?.authTag,
        keyVersion: encrypted?.keyVersion ?? 1,
        redirectUri: input.redirectUri,
        expiresAt: input.expiresAt,
        metadata: input.metadata ?? {},
      },
    });
    return this.toOAuthState(row as Record<string, unknown>);
  }

  async findByState(state: string): Promise<McpOAuthState | null> {
    const row = await this.db.mcpOAuthState.findUnique({ where: { state } });
    return row ? this.toOAuthState(row as Record<string, unknown>) : null;
  }

  async consume(state: string): Promise<McpOAuthState | null> {
    const rows = await this.db.$queryRaw`
      DELETE FROM "McpOAuthState"
      WHERE "state" = ${state}
      RETURNING
        "id",
        "serverId",
        "tenantId",
        "userId",
        "agentId",
        "state",
        "codeVerifier",
        "encrypted_code_verifier" AS "encryptedCodeVerifier",
        "code_verifier_iv" AS "codeVerifierIv",
        "code_verifier_auth_tag" AS "codeVerifierAuthTag",
        "key_version" AS "keyVersion",
        "redirectUri",
        "expiresAt",
        "metadata",
        "createdAt"
    ` as Record<string, unknown>[];
    const row = rows[0];
    return row ? this.toOAuthState(row) : null;
  }

  private toOAuthState(row: Record<string, unknown>): McpOAuthState {
    const secrets = row.encryptedCodeVerifier
      ? this.cipher.decrypt({
          encryptedPayload: row.encryptedCodeVerifier as Buffer,
          encryptionIv: row.codeVerifierIv as Buffer | null | undefined,
          authTag: row.codeVerifierAuthTag as Buffer | null | undefined,
        })
      : {};
    return {
      id: String(row.id),
      serverId: String(row.serverId),
      tenantId: row.tenantId ? String(row.tenantId) : undefined,
      userId: String(row.userId),
      agentId: row.agentId ? String(row.agentId) : undefined,
      state: String(row.state),
      codeVerifier:
        secrets.codeVerifier ??
        (row.codeVerifier ? String(row.codeVerifier) : undefined),
      clientSecret: secrets.clientSecret,
      redirectUri: String(row.redirectUri),
      expiresAt: row.expiresAt as Date,
      metadata: (row.metadata ?? {}) as JsonObject,
      createdAt: row.createdAt as Date,
    };
  }
}
