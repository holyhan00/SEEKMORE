import { BadRequestException, Injectable } from '@nestjs/common';
import { McpRuntimeError } from '../../domain/mcp-runtime.errors';
import { McpRemoteUrlGuardService } from '../../runtime/mcp-remote-url-guard.service';
import {
  normalizeScopes,
  parseMcpOAuthChallenge,
  unionScopes,
  type McpOAuthChallenge,
} from './mcp-oauth-challenge';

export interface McpOAuthServerRecord {
  id: string;
  endpoint: string | null;
  authKind: string;
  authConfig: unknown;
  allowedDomains: string[];
  deniedDomains: string[];
}

export interface McpOAuthClientRegistration {
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod: string;
  authorizationServer?: string;
}

export interface McpOAuthResolvedConfiguration
  extends McpOAuthClientRegistration {
  resource: string;
  authorizationServer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  revocationEndpoint?: string;
  scope?: string;
  authorizationResponseIssParameterSupported: boolean;
}

interface ProtectedResourceDiscovery {
  metadata: Record<string, unknown>;
  challenge: McpOAuthChallenge | null;
}

@Injectable()
export class McpOAuthDiscoveryService {
  constructor(private readonly urls: McpRemoteUrlGuardService) {}

  async resolve(
    server: McpOAuthServerRecord,
    redirectUri: string,
    existing?: Partial<McpOAuthClientRegistration>,
    requestedScope?: string,
  ): Promise<McpOAuthResolvedConfiguration> {
    if (server.authKind !== 'oauth2') {
      throw new McpRuntimeError(
        'MCP_OAUTH_NOT_CONFIGURED',
        'MCP server is not configured for OAuth 2.1.',
      );
    }

    const endpoint = String(server.endpoint ?? '').trim();
    if (!endpoint) {
      throw new McpRuntimeError(
        'MCP_OAUTH_ENDPOINT_REQUIRED',
        'A remote MCP endpoint is required for OAuth discovery.',
      );
    }

    const config = this.record(server.authConfig);
    const oauthDomains = this.stringArray(config.oauthAllowedDomains);
    const allowedDomains = [...new Set([
      ...(server.allowedDomains ?? []),
      ...oauthDomains,
    ])];
    const deniedDomains = server.deniedDomains ?? [];
    const endpointUrl = await this.urls.assertAllowed(
      endpoint,
      server.allowedDomains ?? [],
      deniedDomains,
    );
    endpointUrl.hash = '';

    const configuredResource = this.optionalString(config.resource);
    const resourceUrl = await this.urls.assertAllowed(
      configuredResource ?? endpoint,
      allowedDomains,
      deniedDomains,
    );
    resourceUrl.hash = '';

    const protectedResource = await this.protectedResourceMetadata(
      endpointUrl,
      resourceUrl,
      this.optionalString(config.resourceMetadataUrl),
      allowedDomains,
      deniedDomains,
    );
    if (
      protectedResource.metadata.dpop_bound_access_tokens_required === true
    ) {
      throw new McpRuntimeError(
        'MCP_OAUTH_DPOP_REQUIRED_UNSUPPORTED',
        'This MCP server requires DPoP-bound access tokens, which this runtime does not support.',
      );
    }
    const bearerMethods = this.stringArray(
      protectedResource.metadata.bearer_methods_supported,
    );
    if (bearerMethods.length > 0 && !bearerMethods.includes('header')) {
      throw new McpRuntimeError(
        'MCP_OAUTH_BEARER_HEADER_UNSUPPORTED',
        'The MCP protected resource does not advertise Authorization header bearer-token support.',
      );
    }

    const advertisedAuthorizationServers = this.stringArray(
      protectedResource.metadata.authorization_servers,
    );
    if (advertisedAuthorizationServers.length === 0) {
      throw new McpRuntimeError(
        'MCP_OAUTH_AUTHORIZATION_SERVER_NOT_FOUND',
        'The MCP protected-resource metadata did not declare an authorization server.',
      );
    }

    const staticAuthorizationServer = this.optionalString(
      config.authorizationServer,
    );
    const authorizationServer =
      staticAuthorizationServer ?? advertisedAuthorizationServers[0];

    if (
      staticAuthorizationServer &&
      !advertisedAuthorizationServers.includes(staticAuthorizationServer)
    ) {
      throw new McpRuntimeError(
        'MCP_OAUTH_AUTHORIZATION_SERVER_MISMATCH',
        'The configured authorization server is not advertised by the MCP protected resource.',
      );
    }

    const authorizationServerUrl = await this.urls.assertAllowed(
      authorizationServer,
      allowedDomains,
      deniedDomains,
    );
    this.assertSecureAuthorizationEndpoint(authorizationServerUrl);

    const authorizationMetadata = await this.authorizationServerMetadata(
      authorizationServerUrl,
      allowedDomains,
      deniedDomains,
    );
    const metadataIssuer = this.optionalString(authorizationMetadata.issuer);
    if (!metadataIssuer || metadataIssuer !== authorizationServer) {
      throw new McpRuntimeError(
        'MCP_OAUTH_ISSUER_MISMATCH',
        'Authorization server metadata issuer does not exactly match the selected authorization server.',
      );
    }

    const pkceMethods = this.stringArray(
      authorizationMetadata.code_challenge_methods_supported,
    );
    if (!pkceMethods.includes('S256')) {
      throw new McpRuntimeError(
        'MCP_OAUTH_PKCE_S256_UNSUPPORTED',
        'Authorization server metadata does not advertise PKCE S256 support.',
      );
    }

    const responseTypes = this.stringArray(
      authorizationMetadata.response_types_supported,
    );
    if (!responseTypes.includes('code')) {
      throw new McpRuntimeError(
        'MCP_OAUTH_AUTHORIZATION_CODE_UNSUPPORTED',
        'Authorization server metadata does not advertise the authorization code response type.',
      );
    }
    const grantTypes = this.stringArray(
      authorizationMetadata.grant_types_supported,
    );
    if (grantTypes.length > 0 && !grantTypes.includes('authorization_code')) {
      throw new McpRuntimeError(
        'MCP_OAUTH_AUTHORIZATION_CODE_UNSUPPORTED',
        'Authorization server metadata does not advertise the authorization_code grant.',
      );
    }

    const authorizationEndpoint =
      this.optionalString(
        config.authorizationUrl ?? config.authorizationEndpoint,
      ) ?? this.optionalString(authorizationMetadata.authorization_endpoint);
    const tokenEndpoint =
      this.optionalString(config.tokenUrl ?? config.tokenEndpoint) ??
      this.optionalString(authorizationMetadata.token_endpoint);
    const registrationEndpoint =
      this.optionalString(config.registrationUrl ?? config.registrationEndpoint) ??
      this.optionalString(authorizationMetadata.registration_endpoint);
    const revocationEndpoint =
      this.optionalString(config.revocationUrl ?? config.revocationEndpoint) ??
      this.optionalString(authorizationMetadata.revocation_endpoint);

    if (!authorizationEndpoint || !tokenEndpoint) {
      throw new McpRuntimeError(
        'MCP_OAUTH_METADATA_INVALID',
        'OAuth discovery did not return authorization and token endpoints.',
      );
    }

    const endpointUrls = await Promise.all([
      this.urls.assertAllowed(authorizationEndpoint, allowedDomains, deniedDomains),
      this.urls.assertAllowed(tokenEndpoint, allowedDomains, deniedDomains),
      registrationEndpoint
        ? this.urls.assertAllowed(registrationEndpoint, allowedDomains, deniedDomains)
        : Promise.resolve(null),
      revocationEndpoint
        ? this.urls.assertAllowed(revocationEndpoint, allowedDomains, deniedDomains)
        : Promise.resolve(null),
    ]);
    endpointUrls.filter((value): value is URL => Boolean(value)).forEach((value) => {
      this.assertSecureAuthorizationEndpoint(value);
    });

    const advertisedTokenAuthMethods = this.stringArray(
      authorizationMetadata.token_endpoint_auth_methods_supported,
    );
    const tokenEndpointAuthMethods = advertisedTokenAuthMethods.length > 0
      ? advertisedTokenAuthMethods
      : ['client_secret_basic'];
    const configuredClientId =
      this.optionalString(config.clientId) ??
      this.environmentValue(config.clientIdEnv);
    const configuredClientSecret =
      this.optionalString(config.clientSecret) ??
      this.environmentValue(config.clientSecretEnv);
    const configuredTokenAuthMethod =
      this.optionalString(config.tokenEndpointAuthMethod) ??
      (configuredClientSecret ? 'client_secret_basic' : 'none');
    const metadataDocumentClientId =
      this.optionalString(config.clientIdMetadataDocumentUrl) ??
      this.environmentValue(config.clientIdMetadataDocumentUrlEnv);
    const clientIdMetadataDocumentSupported =
      authorizationMetadata.client_id_metadata_document_supported === true;

    const reusableExisting =
      existing?.clientId && existing.authorizationServer === authorizationServer
        ? existing
        : undefined;

    const registration = configuredClientId
      ? {
          clientId: configuredClientId,
          clientSecret: configuredClientSecret,
          tokenEndpointAuthMethod: configuredTokenAuthMethod,
        }
      : metadataDocumentClientId && clientIdMetadataDocumentSupported
        ? {
            clientId: this.clientIdMetadataDocument(metadataDocumentClientId),
            tokenEndpointAuthMethod: 'none',
          }
        : reusableExisting?.clientId
          ? {
              clientId: reusableExisting.clientId,
              clientSecret: reusableExisting.clientSecret,
              tokenEndpointAuthMethod:
                reusableExisting.tokenEndpointAuthMethod ??
                (reusableExisting.clientSecret
                  ? 'client_secret_basic'
                  : 'none'),
            }
          : await this.registerClient(
              registrationEndpoint,
              redirectUri,
              allowedDomains,
              deniedDomains,
            );

    this.assertSupportedTokenAuthMethod(
      registration.tokenEndpointAuthMethod,
      registration.clientSecret,
      tokenEndpointAuthMethods,
    );

    const challengeScopes = protectedResource.challenge?.scopes ?? [];
    const resourceScopes = this.stringArray(
      protectedResource.metadata.scopes_supported,
    );
    const configuredScope = this.optionalString(config.scope);
    const configuredScopes = this.stringArray(config.scopes);
    const authorizationScopes = this.stringArray(
      authorizationMetadata.scopes_supported,
    );

    const selectedScopes = config.omitScope === true
      ? []
      : requestedScope
        ? normalizeScopes(requestedScope)
        : challengeScopes.length > 0
          ? challengeScopes
          : configuredScope || configuredScopes.length > 0
            ? unionScopes(configuredScope, configuredScopes)
            : resourceScopes.length > 0
              ? resourceScopes
              : config.useAllDiscoveredScopes === true
                ? authorizationScopes
                : [];

    return {
      ...registration,
      resource: resourceUrl.toString(),
      authorizationServer,
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint,
      revocationEndpoint,
      scope: selectedScopes.length > 0 ? selectedScopes.join(' ') : undefined,
      authorizationResponseIssParameterSupported:
        authorizationMetadata.authorization_response_iss_parameter_supported === true,
    };
  }

  private async protectedResourceMetadata(
    endpoint: URL,
    resource: URL,
    explicitMetadataUrl: string | undefined,
    allowedDomains: string[],
    deniedDomains: string[],
  ): Promise<ProtectedResourceDiscovery> {
    const fetcher = this.urls.createValidatedFetch(
      allowedDomains,
      deniedDomains,
      512 * 1024,
    );
    const candidates: string[] = [];
    let challenge: McpOAuthChallenge | null = null;

    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'oauth-discovery',
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'SEEKMORE', version: '1.0.0' },
          },
        }),
      });
      challenge = parseMcpOAuthChallenge(
        response.headers.get('www-authenticate'),
        response.status,
      );
      if (challenge?.resourceMetadata) {
        candidates.push(
          new URL(challenge.resourceMetadata, endpoint).toString(),
        );
      }
      await response.body?.cancel().catch(() => undefined);
    } catch {
                                                                  
    }

    if (explicitMetadataUrl) {
      candidates.push(
        new URL(explicitMetadataUrl, endpoint).toString(),
      );
    }

    const path = resource.pathname === '/' ? '' : resource.pathname;
    candidates.push(
      new URL(
        `/.well-known/oauth-protected-resource${path}`,
        resource.origin,
      ).toString(),
      new URL(
        '/.well-known/oauth-protected-resource',
        resource.origin,
      ).toString(),
    );

    const metadata = await this.firstJson(
      candidates,
      fetcher,
      'MCP_OAUTH_RESOURCE_METADATA_NOT_FOUND',
    );
    const metadataResource = this.optionalString(metadata.resource);
    if (!metadataResource) {
      throw new McpRuntimeError(
        'MCP_OAUTH_RESOURCE_METADATA_INVALID',
        'Protected-resource metadata does not contain the required resource identifier.',
      );
    }
    let metadataResourceUrl: URL;
    try {
      metadataResourceUrl = new URL(metadataResource);
    } catch {
      throw new McpRuntimeError(
        'MCP_OAUTH_RESOURCE_METADATA_INVALID',
        'Protected-resource metadata contains an invalid resource identifier.',
      );
    }
    if (metadataResourceUrl.toString() !== resource.toString()) {
      throw new McpRuntimeError(
        'MCP_OAUTH_RESOURCE_METADATA_MISMATCH',
        'Protected-resource metadata does not describe the requested MCP resource.',
      );
    }

    return { metadata, challenge };
  }

  private async authorizationServerMetadata(
    issuer: URL,
    allowedDomains: string[],
    deniedDomains: string[],
  ): Promise<Record<string, unknown>> {
    const fetcher = this.urls.createValidatedFetch(
      allowedDomains,
      deniedDomains,
      512 * 1024,
    );
    const path = issuer.pathname === '/' ? '' : issuer.pathname.replace(/\/$/, '');
    const candidates = path
      ? [
          new URL(
            `/.well-known/oauth-authorization-server${path}`,
            issuer.origin,
          ).toString(),
          new URL(
            `/.well-known/openid-configuration${path}`,
            issuer.origin,
          ).toString(),
          new URL(
            '.well-known/openid-configuration',
            `${issuer.toString().replace(/\/$/, '')}/`,
          ).toString(),
        ]
      : [
          new URL(
            '/.well-known/oauth-authorization-server',
            issuer.origin,
          ).toString(),
          new URL(
            '/.well-known/openid-configuration',
            issuer.origin,
          ).toString(),
        ];

    return this.firstJson(
      candidates,
      fetcher,
      'MCP_OAUTH_SERVER_METADATA_NOT_FOUND',
    );
  }

  private async registerClient(
    registrationEndpoint: string | undefined,
    redirectUri: string,
    allowedDomains: string[],
    deniedDomains: string[],
  ): Promise<McpOAuthClientRegistration> {
    if (!registrationEndpoint) {
      throw new McpRuntimeError(
        'MCP_OAUTH_CLIENT_REGISTRATION_REQUIRED',
        'The authorization server does not support dynamic client registration and no client ID is configured.',
      );
    }
    const fetcher = this.urls.createValidatedFetch(
      allowedDomains,
      deniedDomains,
      512 * 1024,
    );
    const response = await fetcher(registrationEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        client_name: 'SEEKMORE',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
      }),
    });
    if (!response.ok) {
      throw new McpRuntimeError(
        'MCP_OAUTH_DYNAMIC_REGISTRATION_FAILED',
        `Dynamic client registration failed with status ${response.status}.`,
      );
    }
    const body = (await response.json()) as Record<string, unknown>;
    const clientId = this.optionalString(body.client_id);
    if (!clientId) {
      throw new McpRuntimeError(
        'MCP_OAUTH_DYNAMIC_REGISTRATION_INVALID',
        'Dynamic client registration did not return client_id.',
      );
    }
    const clientSecret = this.optionalString(body.client_secret);
    return {
      clientId,
      clientSecret,
      tokenEndpointAuthMethod:
        this.optionalString(body.token_endpoint_auth_method) ??
        (clientSecret ? 'client_secret_basic' : 'none'),
    };
  }

  private async firstJson(
    candidates: string[],
    fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    errorCode: string,
  ): Promise<Record<string, unknown>> {
    const tried = new Set<string>();
    for (const raw of candidates) {
      if (!raw || tried.has(raw)) continue;
      tried.add(raw);
      try {
        const response = await fetcher(raw, {
          method: 'GET',
          headers: { accept: 'application/json' },
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          continue;
        }
        const body = await response.json();
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          return body as Record<string, unknown>;
        }
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
      }
    }
    throw new McpRuntimeError(errorCode, 'OAuth metadata discovery failed.');
  }

  private assertSupportedTokenAuthMethod(
    method: string,
    clientSecret: string | undefined,
    advertised: string[],
  ): void {
    const supportedLocally = new Set([
      'none',
      'client_secret_basic',
      'client_secret_post',
    ]);
    if (!supportedLocally.has(method)) {
      throw new McpRuntimeError(
        'MCP_OAUTH_TOKEN_AUTH_METHOD_UNSUPPORTED',
        `Unsupported OAuth token endpoint authentication method: ${method}.`,
      );
    }
    if (method !== 'none' && !clientSecret) {
      throw new McpRuntimeError(
        'MCP_OAUTH_CLIENT_SECRET_REQUIRED',
        `OAuth token endpoint authentication method ${method} requires a client secret.`,
      );
    }
    if (advertised.length > 0 && !advertised.includes(method)) {
      throw new McpRuntimeError(
        'MCP_OAUTH_TOKEN_AUTH_METHOD_NOT_ADVERTISED',
        `Authorization server does not advertise token endpoint authentication method ${method}.`,
      );
    }
  }

  private assertSecureAuthorizationEndpoint(url: URL): void {
    if (url.protocol !== 'https:') {
      throw new McpRuntimeError(
        'MCP_OAUTH_HTTPS_REQUIRED',
        'OAuth authorization server endpoints must use HTTPS.',
      );
    }
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.map(String).map((item) => item.trim()).filter(Boolean)
      : [];
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private clientIdMetadataDocument(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new McpRuntimeError(
        'MCP_OAUTH_CLIENT_METADATA_URL_INVALID',
        'OAuth client metadata document URL is invalid.',
      );
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      !url.pathname ||
      url.pathname === '/'
    ) {
      throw new McpRuntimeError(
        'MCP_OAUTH_CLIENT_METADATA_URL_INVALID',
        'OAuth client metadata document must use a public HTTPS URL with a path component.',
      );
    }
    return url.toString();
  }

  private environmentValue(name: unknown): string | undefined {
    const key = this.optionalString(name);
    if (!key) return undefined;
    return this.optionalString(process.env[key]);
  }

  private optionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const clean = value.trim();
    return clean || undefined;
  }
}
