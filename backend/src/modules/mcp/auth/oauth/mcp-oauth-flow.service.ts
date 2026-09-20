                                                               
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../../prisma/prisma.service';
import type { JsonObject } from '../../domain/json.types';
import type { McpPrincipal, McpRuntimeConfig } from '../../domain/mcp-runtime.types';
import { McpRuntimeError } from '../../domain/mcp-runtime.errors';
import {
  MCP_AUDIT_SINK,
  MCP_AUTH_SESSION_REPOSITORY,
  MCP_OAUTH_STATE_REPOSITORY,
  MCP_RUNTIME_CONFIG,
} from '../../mcp-runtime.tokens';
import type { McpAuditSink } from '../../observability/mcp-audit.sink';
import { McpRemoteUrlGuardService } from '../../runtime/mcp-remote-url-guard.service';
import type {
  McpAuthSessionRepository,
  McpStoredOAuthSession,
} from '../mcp-auth-session.repository';
import {
  unionScopes,
  type McpOAuthChallenge,
} from './mcp-oauth-challenge';
import { McpOAuthDiscoveryService } from './mcp-oauth-discovery.service';
import type { McpOAuthStateRepository } from './mcp-oauth-state.repository';

function base64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

interface OAuthInstallationRecord {
  id: string;
  userId: string;
  serverId: string;
  configurationState: string;
  server: {
    id: string;
    endpoint: string | null;
    authKind: string;
    authConfig: unknown;
    allowedDomains: string[];
    deniedDomains: string[];
    transport?: string;
  };
}

interface OAuthTokenContext {
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  authorizationServer: string;
  resource: string;
  scope?: string;
}

@Injectable()
export class McpOAuthFlowService {
  private readonly db: any;
  private readonly refreshFlights = new Map<
    string,
    Promise<McpStoredOAuthSession>
  >();

  constructor(
    prisma: PrismaService,
    @Inject(MCP_RUNTIME_CONFIG)
    private readonly config: McpRuntimeConfig,
    @Inject(MCP_OAUTH_STATE_REPOSITORY)
    private readonly states: McpOAuthStateRepository,
    @Inject(MCP_AUTH_SESSION_REPOSITORY)
    private readonly sessions: McpAuthSessionRepository,
    @Inject(MCP_AUDIT_SINK)
    private readonly audit: McpAuditSink,
    private readonly discovery: McpOAuthDiscoveryService,
    private readonly urls: McpRemoteUrlGuardService,
  ) {
    this.db = prisma as any;
  }

  async initiate(
    installationId: string,
    principal: McpPrincipal,
    redirectUri: string,
    requestedScopes: string[] = [],
  ): Promise<{
    authorizationUrl: string;
    state: string;
    installationId: string;
  }> {
    const installation = await this.mustGetInstallation(
      installationId,
      principal.userId,
    );
    const existing = await this.sessions.findOAuthSession({
      serverId: installation.serverId,
      userId: principal.userId,
      agentId: principal.agentId,
    });
    const pendingScopes = this.metadataStringArray(
      existing?.metadata ?? {},
      'pendingScopes',
    );
    const stepUpScope = unionScopes(
      existing?.scope,
      pendingScopes,
      requestedScopes,
    );
    const existingAuthorizationServer = existing
      ? this.metadataString(existing.metadata, 'authorizationServer')
      : null;

    const resolved = await this.discovery.resolve(
      installation.server,
      redirectUri,
      existing
        ? {
            clientId: existing.clientId,
            clientSecret: existing.clientSecret,
            tokenEndpointAuthMethod:
              this.metadataString(
                existing.metadata,
                'tokenEndpointAuthMethod',
              ) ?? undefined,
            authorizationServer: existingAuthorizationServer ?? undefined,
          }
        : undefined,
      stepUpScope.length > 0 ? stepUpScope.join(' ') : undefined,
    );

    const state = randomUUID();
    const codeVerifier = base64Url(randomBytes(32));
    const challenge = base64Url(
      createHash('sha256').update(codeVerifier).digest(),
    );
    const expiresAt = new Date(
      Date.now() + this.config.maxOAuthStateSeconds * 1_000,
    );
    const metadata: JsonObject = {
      installationId,
      clientId: resolved.clientId,
      tokenEndpointAuthMethod: resolved.tokenEndpointAuthMethod,
      tokenEndpoint: resolved.tokenEndpoint,
      authorizationServer: resolved.authorizationServer,
      authorizationResponseIssParameterSupported:
        resolved.authorizationResponseIssParameterSupported,
      resource: resolved.resource,
      ...(resolved.revocationEndpoint
        ? { revocationEndpoint: resolved.revocationEndpoint }
        : {}),
      ...(resolved.scope ? { scope: resolved.scope } : {}),
    };

    await this.states.create({
      serverId: installation.serverId,
      principal,
      state,
      codeVerifier,
      clientSecret: resolved.clientSecret,
      redirectUri,
      expiresAt,
      metadata,
    });

    const url = new URL(resolved.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', resolved.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('resource', resolved.resource);
    if (resolved.scope) url.searchParams.set('scope', resolved.scope);

    await this.writeAudit('mcp.oauth.authorization_started', {
      userId: principal.userId,
      serverId: installation.serverId,
      metadata: {
        installationId,
        authorizationServer: resolved.authorizationServer,
        scope: resolved.scope ?? null,
      },
    });

    return {
      authorizationUrl: url.toString(),
      state,
      installationId,
    };
  }

  async callback(input: {
    code?: string;
    state?: string;
    iss?: string;
    error?: string;
    errorDescription?: string;
  }): Promise<{
    sessionId: string;
    installationId: string;
    serverId: string;
    userId: string;
  }> {
    const stateValue = String(input.state ?? '').trim();
    if (!stateValue) {
      throw new McpRuntimeError(
        'MCP_OAUTH_STATE_REQUIRED',
        'OAuth callback state is required.',
      );
    }
    const stateRow = await this.states.consume(stateValue);
    if (!stateRow) {
      throw new McpRuntimeError(
        'MCP_OAUTH_STATE_NOT_FOUND',
        'OAuth state not found or already consumed.',
      );
    }
    if (stateRow.expiresAt.getTime() < Date.now()) {
      throw new McpRuntimeError(
        'MCP_OAUTH_STATE_EXPIRED',
        'OAuth state expired.',
      );
    }

    this.validateAuthorizationResponseIssuer(stateRow.metadata, input.iss);

    if (input.error) {
      throw new McpRuntimeError(
        'MCP_OAUTH_AUTHORIZATION_DENIED',
        input.errorDescription || input.error,
      );
    }
    const code = String(input.code ?? '').trim();
    if (!code) {
      throw new McpRuntimeError(
        'MCP_OAUTH_CODE_REQUIRED',
        'OAuth callback code is required.',
      );
    }

    const installationId = this.metadataString(
      stateRow.metadata,
      'installationId',
    );
    if (!installationId) {
      throw new McpRuntimeError(
        'MCP_OAUTH_STATE_INVALID',
        'OAuth state does not contain an installation ID.',
      );
    }
    const installation = await this.mustGetInstallation(
      installationId,
      stateRow.userId,
    );
    if (installation.serverId !== stateRow.serverId) {
      throw new McpRuntimeError(
        'MCP_OAUTH_STATE_MISMATCH',
        'OAuth state server mismatch.',
      );
    }

    const context = this.tokenContextFromState(stateRow);
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', stateRow.redirectUri);
    body.set('client_id', context.clientId);
    body.set('resource', context.resource);
    if (stateRow.codeVerifier) body.set('code_verifier', stateRow.codeVerifier);
    if (context.scope) body.set('scope', context.scope);
    const headers = this.tokenRequestHeaders(context, body);

    const token = await this.requestToken(
      installation.server,
      context.tokenEndpoint,
      body,
      headers,
    );
    const session = await this.storeToken({
      installation,
      principal: {
        tenantId: stateRow.tenantId,
        userId: stateRow.userId,
        agentId: stateRow.agentId,
        roleIds: [],
      },
      token,
      context,
    });

    await this.db.mcpInstallation.updateMany({
      where: {
        userId: stateRow.userId,
        serverId: stateRow.serverId,
        status: 'installed',
        removedAt: null,
      },
      data: {
        enabled: true,
        configurationState: 'ready',
      },
    });
    await this.db.mcpConnectionState.updateMany({
      where: { installationId },
      data: {
        authSessionId: session.id,
        failureCode: null,
        failureMessage: null,
      },
    });
    await this.writeAudit('mcp.oauth.authorization_succeeded', {
      userId: stateRow.userId,
      serverId: stateRow.serverId,
      metadata: {
        installationId,
        scope: context.scope ?? null,
      },
    });

    return {
      sessionId: session.id,
      installationId,
      serverId: stateRow.serverId,
      userId: stateRow.userId,
    };
  }

  async authorizationHeaders(
    installation: OAuthInstallationRecord,
  ): Promise<Record<string, string>> {
    if (installation.server.authKind !== 'oauth2') return {};
    let session = await this.sessions.findOAuthSession({
      serverId: installation.serverId,
      userId: installation.userId,
    });
    if (!session || session.status !== 'active' || !session.accessToken) {
      await this.markAuthorizationRequired(installation);
      throw new McpRuntimeError(
        'MCP_OAUTH_AUTHORIZATION_REQUIRED',
        'Authorize this MCP service before connecting.',
      );
    }

    if (this.expiresSoon(session.expiresAt)) {
      session = await this.refreshSingleflight(installation, session);
    }
    if (!session.accessToken) {
      await this.markAuthorizationRequired(installation);
      throw new McpRuntimeError(
        'MCP_OAUTH_AUTHORIZATION_REQUIRED',
        'OAuth access token is unavailable.',
      );
    }
    if (!this.isBearer(session.tokenType)) {
      await this.markAuthorizationRequired(installation);
      throw new McpRuntimeError(
        'MCP_OAUTH_TOKEN_TYPE_UNSUPPORTED',
        'MCP OAuth access tokens must use the Bearer token type.',
      );
    }
    return { Authorization: `Bearer ${session.accessToken}` };
  }

  async recoverFromRemoteAuthorizationError(
    installation: OAuthInstallationRecord,
    error: unknown,
  ): Promise<boolean> {
    if (installation.server.authKind !== 'oauth2') return false;
    const challenge = this.challengeFromError(error);
    if (!challenge) return false;

    if (
      challenge.error === 'insufficient_scope' ||
      (challenge.status === 403 && challenge.scopes.length > 0)
    ) {
      await this.requireStepUp(installation, challenge, error);
    }

    if (challenge.status === 401) {
      const session = await this.sessions.findOAuthSession({
        serverId: installation.serverId,
        userId: installation.userId,
      });
      if (session?.refreshToken && session.status === 'active') {
        await this.refreshSingleflight(installation, session, true);
        return true;
      }
      if (session) {
        await this.sessions.setOAuthSessionStatus({
          serverId: installation.serverId,
          userId: installation.userId,
          status: 'expired',
        });
      }
      await this.markAuthorizationRequired(installation);
      throw new McpRuntimeError(
        'MCP_OAUTH_AUTHORIZATION_REQUIRED',
        challenge.errorDescription ||
          'The OAuth access token is invalid or expired. Authorize again.',
        error,
        { authChallenge: challenge as unknown as Record<string, unknown> },
      );
    }

    return false;
  }

  async status(userId: string, installationId: string): Promise<{
    status: 'authorization_required' | 'authorized' | 'expired' | 'revoked';
    expiresAt: string | null;
    requiredScopes: string[];
  }> {
    const installation = await this.mustGetInstallation(installationId, userId);
    const session = await this.sessions.findOAuthSession({
      serverId: installation.serverId,
      userId,
    });
    const requiredScopes = this.metadataStringArray(
      session?.metadata ?? {},
      'pendingScopes',
    );
    if (!session || installation.configurationState === 'needs_authorization') {
      return {
        status: 'authorization_required',
        expiresAt: session?.expiresAt?.toISOString() ?? null,
        requiredScopes,
      };
    }
    if (session.status === 'revoked') {
      return { status: 'revoked', expiresAt: null, requiredScopes: [] };
    }
    if (
      session.status === 'expired' ||
      (this.expiresSoon(session.expiresAt) && !session.refreshToken)
    ) {
      return {
        status: 'expired',
        expiresAt: session.expiresAt?.toISOString() ?? null,
        requiredScopes,
      };
    }
    return {
      status: 'authorized',
      expiresAt: session.expiresAt?.toISOString() ?? null,
      requiredScopes: [],
    };
  }

  async revoke(userId: string, installationId: string): Promise<void> {
    const installation = await this.mustGetInstallation(installationId, userId);
    const session = await this.sessions.findOAuthSession({
      serverId: installation.serverId,
      userId,
    });
    if (session) {
      const revocationEndpoint = this.metadataString(
        session.metadata,
        'revocationEndpoint',
      );
      if (revocationEndpoint) {
        const context = this.tokenContextFromSession(session);
        if (session.refreshToken) {
          await this.revokeToken(
            installation.server,
            revocationEndpoint,
            context,
            session.refreshToken,
            'refresh_token',
          );
        }
        if (session.accessToken) {
          await this.revokeToken(
            installation.server,
            revocationEndpoint,
            context,
            session.accessToken,
            'access_token',
          );
        }
      }
    }
    await this.sessions.deleteOAuthSession({
      serverId: installation.serverId,
      userId,
    });
    await this.markAuthorizationRequired(installation);
    await this.writeAudit('mcp.oauth.authorization_revoked', {
      userId,
      serverId: installation.serverId,
      metadata: { installationId },
    });
  }

  private refreshSingleflight(
    installation: OAuthInstallationRecord,
    session: McpStoredOAuthSession,
    force = false,
  ): Promise<McpStoredOAuthSession> {
    if (!force && !this.expiresSoon(session.expiresAt)) {
      return Promise.resolve(session);
    }
    const key = `${installation.serverId}:${installation.userId}`;
    const active = this.refreshFlights.get(key);
    if (active) return active;

    const task = this.performRefresh(installation, session).finally(() => {
      if (this.refreshFlights.get(key) === task) {
        this.refreshFlights.delete(key);
      }
    });
    this.refreshFlights.set(key, task);
    return task;
  }

  private async performRefresh(
    installation: OAuthInstallationRecord,
    session: McpStoredOAuthSession,
  ): Promise<McpStoredOAuthSession> {
    if (!session.refreshToken) {
      await this.sessions.setOAuthSessionStatus({
        serverId: installation.serverId,
        userId: installation.userId,
        status: 'expired',
      });
      await this.markAuthorizationRequired(installation);
      throw new McpRuntimeError(
        'MCP_OAUTH_SESSION_EXPIRED',
        'OAuth session expired and cannot be refreshed.',
      );
    }
    const context = this.tokenContextFromSession(session);
    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', session.refreshToken);
    body.set('client_id', context.clientId);
    body.set('resource', context.resource);
    if (context.scope) body.set('scope', context.scope);
    const headers = this.tokenRequestHeaders(context, body);

    try {
      const token = await this.requestToken(
        installation.server,
        context.tokenEndpoint,
        body,
        headers,
      );
      await this.storeToken({
        installation,
        principal: { userId: installation.userId, roleIds: [] },
        token: {
          ...token,
          refresh_token:
            typeof token.refresh_token === 'string'
              ? token.refresh_token
              : session.refreshToken,
        },
        context,
      });
      const refreshed = await this.sessions.findOAuthSession({
        serverId: installation.serverId,
        userId: installation.userId,
      });
      if (!refreshed) {
        throw new McpRuntimeError(
          'MCP_OAUTH_REFRESH_SESSION_MISSING',
          'Refreshed OAuth session could not be reloaded.',
        );
      }
      return refreshed;
    } catch (error) {
      if (this.isPermanentRefreshFailure(error)) {
        await this.sessions.setOAuthSessionStatus({
          serverId: installation.serverId,
          userId: installation.userId,
          status: 'expired',
        });
        await this.markAuthorizationRequired(installation);
      }
      throw error;
    }
  }

  private async requireStepUp(
    installation: OAuthInstallationRecord,
    challenge: McpOAuthChallenge,
    cause: unknown,
  ): Promise<never> {
    const session = await this.sessions.findOAuthSession({
      serverId: installation.serverId,
      userId: installation.userId,
    });
    const requiredScopes = unionScopes(session?.scope, challenge.scopes);
    if (requiredScopes.length === 0) {
      throw new McpRuntimeError(
        'MCP_OAUTH_INSUFFICIENT_SCOPE',
        challenge.errorDescription ||
          'The MCP server rejected the current OAuth scopes.',
        cause,
        { authChallenge: challenge as unknown as Record<string, unknown> },
      );
    }

    if (session) {
      await this.sessions.updateOAuthSessionMetadata({
        serverId: installation.serverId,
        userId: installation.userId,
        metadata: {
          ...session.metadata,
          pendingScopes: requiredScopes,
          lastScopeChallengeAt: new Date().toISOString(),
          lastScopeChallengeError: challenge.error ?? 'insufficient_scope',
        },
      });
    }
    await this.markAuthorizationRequired(installation);
    await this.writeAudit('mcp.oauth.step_up_required', {
      userId: installation.userId,
      serverId: installation.serverId,
      metadata: {
        installationId: installation.id,
        requiredScopes,
      },
    });
    throw new McpRuntimeError(
      'MCP_OAUTH_STEP_UP_REQUIRED',
      `Additional OAuth authorization is required: ${requiredScopes.join(' ')}.`,
      cause,
      {
        requiredScopes,
        authChallenge: challenge as unknown as Record<string, unknown>,
      },
    );
  }

  private async storeToken(input: {
    installation: OAuthInstallationRecord;
    principal: McpPrincipal;
    token: Record<string, unknown>;
    context: OAuthTokenContext;
  }): Promise<{ id: string }> {
    const accessToken = this.optionalString(input.token.access_token);
    if (!accessToken) {
      throw new McpRuntimeError(
        'MCP_OAUTH_TOKEN_INVALID',
        'OAuth token response does not contain access_token.',
      );
    }
    const tokenType = this.optionalString(input.token.token_type);
    if (!tokenType || !this.isBearer(tokenType)) {
      throw new McpRuntimeError(
        'MCP_OAUTH_TOKEN_TYPE_UNSUPPORTED',
        `Unsupported OAuth token type: ${tokenType}. MCP requires Bearer tokens.`,
      );
    }
    const expiresIn = this.numberValue(input.token.expires_in);
    return this.sessions.upsertOAuthSession({
      serverId: input.installation.serverId,
      principal: input.principal,
      accessToken,
      refreshToken: this.optionalString(input.token.refresh_token),
      clientId: input.context.clientId,
      clientSecret: input.context.clientSecret,
      tokenType: 'Bearer',
      scope: this.optionalString(input.token.scope) ?? input.context.scope,
      expiresAt: expiresIn
        ? new Date(Date.now() + expiresIn * 1_000)
        : undefined,
      metadata: {
        provider: 'oauth2',
        tokenEndpoint: input.context.tokenEndpoint,
        tokenEndpointAuthMethod: input.context.tokenEndpointAuthMethod,
        authorizationServer: input.context.authorizationServer,
        resource: input.context.resource,
        ...(input.context.revocationEndpoint
          ? { revocationEndpoint: input.context.revocationEndpoint }
          : {}),
      },
    });
  }

  private async requestToken(
    server: OAuthInstallationRecord['server'],
    endpoint: string,
    body: URLSearchParams,
    headers: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const response = await this.requestForm(server, endpoint, body, headers);
    const text = await response.text();
    let token: Record<string, unknown> = {};
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          token = parsed as Record<string, unknown>;
        }
      } catch {
        if (response.ok) {
          throw new McpRuntimeError(
            'MCP_OAUTH_TOKEN_RESPONSE_INVALID',
            'OAuth token endpoint returned a non-JSON response.',
          );
        }
      }
    }
    if (!response.ok) {
      const oauthError = this.optionalString(token.error);
      throw new McpRuntimeError(
        'MCP_OAUTH_TOKEN_EXCHANGE_FAILED',
        this.optionalString(token.error_description) ??
          oauthError ??
          `OAuth token request failed with status ${response.status}.`,
        undefined,
        {
          status: response.status,
          oauthError: oauthError ?? null,
        },
      );
    }
    return token;
  }

  private async requestForm(
    server: OAuthInstallationRecord['server'],
    endpoint: string,
    body: URLSearchParams,
    headers: Record<string, string>,
  ): Promise<Response> {
    const config = this.record(server.authConfig);
    const allowedDomains = [...new Set([
      ...(server.allowedDomains ?? []),
      ...this.stringArray(config.oauthAllowedDomains),
    ])];
    const fetcher = this.urls.createValidatedFetch(
      allowedDomains,
      server.deniedDomains ?? [],
      1024 * 1024,
    );
    return fetcher(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        ...headers,
      },
      body,
    });
  }

  private tokenRequestHeaders(
    context: OAuthTokenContext,
    body: URLSearchParams,
  ): Record<string, string> {
    switch (context.tokenEndpointAuthMethod) {
      case 'none':
        return {};
      case 'client_secret_basic':
        if (!context.clientSecret) {
          throw new McpRuntimeError(
            'MCP_OAUTH_CLIENT_SECRET_REQUIRED',
            'OAuth client_secret_basic requires a client secret.',
          );
        }
        body.delete('client_id');
        return {
          Authorization: `Basic ${Buffer.from(
            `${this.formEncodeCredential(context.clientId)}:${this.formEncodeCredential(context.clientSecret)}`,
            'utf8',
          ).toString('base64')}`,
        };
      case 'client_secret_post':
        if (!context.clientSecret) {
          throw new McpRuntimeError(
            'MCP_OAUTH_CLIENT_SECRET_REQUIRED',
            'OAuth client_secret_post requires a client secret.',
          );
        }
        body.set('client_secret', context.clientSecret);
        return {};
      default:
        throw new McpRuntimeError(
          'MCP_OAUTH_TOKEN_AUTH_METHOD_UNSUPPORTED',
          `Unsupported OAuth token endpoint authentication method: ${context.tokenEndpointAuthMethod}.`,
        );
    }
  }

  private async revokeToken(
    server: OAuthInstallationRecord['server'],
    endpoint: string,
    context: OAuthTokenContext,
    token: string,
    tokenTypeHint: 'refresh_token' | 'access_token',
  ): Promise<void> {
    const body = new URLSearchParams();
    body.set('token', token);
    body.set('token_type_hint', tokenTypeHint);
    body.set('client_id', context.clientId);
    const headers = this.tokenRequestHeaders(context, body);
    const response = await this.requestForm(server, endpoint, body, headers);
    await response.body?.cancel().catch(() => undefined);
  }

  private validateAuthorizationResponseIssuer(
    metadata: JsonObject,
    responseIssuer: string | undefined,
  ): void {
    const expectedIssuer = this.metadataString(metadata, 'authorizationServer');
    if (!expectedIssuer) {
      throw new McpRuntimeError(
        'MCP_OAUTH_STATE_INVALID',
        'OAuth state does not contain the validated authorization server issuer.',
      );
    }
    const issuerRequired =
      metadata.authorizationResponseIssParameterSupported === true;
    const receivedIssuer = this.optionalString(responseIssuer);
    if (receivedIssuer && receivedIssuer !== expectedIssuer) {
      throw new McpRuntimeError(
        'MCP_OAUTH_ISSUER_MISMATCH',
        'OAuth authorization response issuer does not match the expected issuer.',
      );
    }
    if (issuerRequired && !receivedIssuer) {
      throw new McpRuntimeError(
        'MCP_OAUTH_ISSUER_REQUIRED',
        'OAuth authorization response omitted the required iss parameter.',
      );
    }
  }

  private tokenContextFromState(state: {
    metadata: JsonObject;
    clientSecret?: string;
  }): OAuthTokenContext {
    const clientId = this.metadataString(state.metadata, 'clientId');
    const tokenEndpoint = this.metadataString(state.metadata, 'tokenEndpoint');
    const authorizationServer = this.metadataString(
      state.metadata,
      'authorizationServer',
    );
    const resource = this.metadataString(state.metadata, 'resource');
    if (!clientId || !tokenEndpoint || !authorizationServer || !resource) {
      throw new McpRuntimeError(
        'MCP_OAUTH_STATE_INVALID',
        'OAuth state is missing token context.',
      );
    }
    return {
      clientId,
      clientSecret: state.clientSecret,
      tokenEndpointAuthMethod:
        this.metadataString(state.metadata, 'tokenEndpointAuthMethod') ?? 'none',
      tokenEndpoint,
      revocationEndpoint:
        this.metadataString(state.metadata, 'revocationEndpoint') ?? undefined,
      authorizationServer,
      resource,
      scope: this.metadataString(state.metadata, 'scope') ?? undefined,
    };
  }

  private tokenContextFromSession(
    session: McpStoredOAuthSession,
  ): OAuthTokenContext {
    const tokenEndpoint = this.metadataString(session.metadata, 'tokenEndpoint');
    const authorizationServer = this.metadataString(
      session.metadata,
      'authorizationServer',
    );
    const resource = this.metadataString(session.metadata, 'resource');
    if (!session.clientId || !tokenEndpoint || !authorizationServer || !resource) {
      throw new McpRuntimeError(
        'MCP_OAUTH_SESSION_INVALID',
        'Stored OAuth session is missing refresh context.',
      );
    }
    return {
      clientId: session.clientId,
      clientSecret: session.clientSecret,
      tokenEndpointAuthMethod:
        this.metadataString(session.metadata, 'tokenEndpointAuthMethod') ??
        (session.clientSecret ? 'client_secret_basic' : 'none'),
      tokenEndpoint,
      revocationEndpoint:
        this.metadataString(session.metadata, 'revocationEndpoint') ?? undefined,
      authorizationServer,
      resource,
      scope: session.scope,
    };
  }

  private async mustGetInstallation(
    installationId: string,
    userId: string,
  ): Promise<OAuthInstallationRecord> {
    const installation = await this.db.mcpInstallation.findFirst({
      where: {
        id: installationId,
        userId,
        status: 'installed',
        removedAt: null,
      },
      include: { server: true },
    });
    if (!installation) {
      throw new NotFoundException('MCP_INSTALLATION_NOT_FOUND');
    }
    if (
      installation.server.transport !== 'streamable_http' ||
      installation.server.authKind !== 'oauth2'
    ) {
      throw new McpRuntimeError(
        'MCP_OAUTH_NOT_CONFIGURED',
        'This installation does not use remote OAuth.',
      );
    }
    return installation as OAuthInstallationRecord;
  }

  private async markAuthorizationRequired(
    installation: OAuthInstallationRecord,
  ): Promise<void> {
    await this.db.$transaction([
      this.db.mcpInstallation.update({
        where: { id: installation.id },
        data: { configurationState: 'needs_authorization' },
      }),
      this.db.mcpToolSnapshot.updateMany({
        where: { installationId: installation.id },
        data: { status: 'unavailable' },
      }),
      this.db.mcpConnectionState.updateMany({
        where: { installationId: installation.id },
        data: {
          status: 'disconnected',
          failureCode: 'MCP_OAUTH_AUTHORIZATION_REQUIRED',
          failureMessage: 'OAuth authorization is required.',
          lastDisconnectedAt: new Date(),
        },
      }),
    ]);
  }

  private challengeFromError(error: unknown): McpOAuthChallenge | null {
    if (!error || typeof error !== 'object') return null;
    const detail = 'detail' in error
      ? (error as { detail?: unknown }).detail
      : undefined;
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
      return null;
    }
    const challenge = (detail as Record<string, unknown>).authChallenge;
    if (!challenge || typeof challenge !== 'object' || Array.isArray(challenge)) {
      return null;
    }
    const row = challenge as Record<string, unknown>;
    const status = Number(row.status);
    if (!Number.isFinite(status)) return null;
    return {
      status,
      scheme: 'Bearer',
      error: this.optionalString(row.error),
      errorDescription: this.optionalString(row.errorDescription),
      resourceMetadata: this.optionalString(row.resourceMetadata),
      scopes: this.stringArray(row.scopes),
      raw: String(row.raw ?? ''),
    };
  }

  private isPermanentRefreshFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('detail' in error)) return false;
    const detail = (error as { detail?: unknown }).detail;
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return false;
    const oauthError = String(
      (detail as Record<string, unknown>).oauthError ?? '',
    );
    return ['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(
      oauthError,
    );
  }


  private formEncodeCredential(value: string): string {
    const encoded = new URLSearchParams({ value }).toString();
    return encoded.slice('value='.length);
  }

  private expiresSoon(expiresAt?: Date): boolean {
    return Boolean(expiresAt && expiresAt.getTime() <= Date.now() + 60_000);
  }

  private isBearer(value: unknown): boolean {
    return typeof value === 'string' && value.trim().toLowerCase() === 'bearer';
  }

  private metadataString(metadata: JsonObject, key: string): string | null {
    const value = metadata[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private metadataStringArray(metadata: JsonObject, key: string): string[] {
    return this.stringArray(metadata[key]);
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : undefined;
  }

  private numberValue(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.map(String).map((item) => item.trim()).filter(Boolean)
      : typeof value === 'string'
        ? value.split(/\s+/).map((item) => item.trim()).filter(Boolean)
        : [];
  }

  private writeAudit(
    eventType: string,
    input: {
      userId: string;
      serverId: string;
      metadata?: JsonObject;
    },
  ): Promise<void> {
    return this.audit.write({
      eventType,
      userId: input.userId,
      serverId: input.serverId,
      severity: 'info',
      metadata: input.metadata ?? {},
      occurredAt: new Date(),
    });
  }
}
