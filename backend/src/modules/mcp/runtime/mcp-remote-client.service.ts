import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { McpRuntimeError } from '../domain/mcp-runtime.errors';
import { parseMcpOAuthChallenge, type McpOAuthChallenge } from '../auth/oauth/mcp-oauth-challenge';
import type {
  McpCapabilityDiscovery,
  McpClientConnectionInfo,
  McpRuntimeConfig,
  McpProtocolPreference,
} from '../domain/mcp-runtime.types';
import { MCP_RUNTIME_CONFIG } from '../mcp-runtime.tokens';
import {
  createMcpClient,
  hasMcpCapability,
  listMcpItems,
  loadMcpClientSdk,
  mcpConnectionMetadata,
  type McpSdkGeneration,
} from './mcp-dynamic-import';
import { McpRemoteUrlGuardService } from './mcp-remote-url-guard.service';

export interface RemoteMcpConnectionSpec {
  installationId: string;
  endpoint: string;
  headers: Record<string, string>;
  allowedDomains: string[];
  deniedDomains: string[];
  timeoutMs: number;
  protocolPreference?: McpProtocolPreference | null;
  onCapabilitiesChanged?: (
    discovery: McpCapabilityDiscovery,
  ) => void | Promise<void>;
}

type LiveClient = McpClientConnectionInfo & {
  sdkGeneration: McpSdkGeneration;
  client: any;
  transport: any;
  lastUsedAt: number;
  headerFingerprint: string;
  authChallengeRef: { current: McpOAuthChallenge | null };
};

@Injectable()
export class McpRemoteClientService implements OnModuleDestroy {
  private readonly clients = new Map<string, LiveClient>();

  constructor(
    private readonly urls: McpRemoteUrlGuardService,
    @Inject(MCP_RUNTIME_CONFIG)
    private readonly config: McpRuntimeConfig,
  ) {}

  async connect(spec: RemoteMcpConnectionSpec): Promise<McpClientConnectionInfo> {
    this.assertEnabled();
    await this.disconnect(spec.installationId);
    const url = await this.urls.assertAllowed(
      spec.endpoint,
      spec.allowedDomains,
      spec.deniedDomains,
    );

    let sdk;
    try {
      sdk = await loadMcpClientSdk(
        'streamable_http',
        spec.protocolPreference,
      );
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'MCP_CLIENT_SDK_NOT_INSTALLED',
        message:
          'Install @modelcontextprotocol/client v2 or @modelcontextprotocol/sdk v1 to use MCP Streamable HTTP.',
        cause: error instanceof Error ? error.message : String(error),
        detail:
          error && typeof error === 'object' && 'detail' in error
            ? (error as { detail?: unknown }).detail
            : undefined,
      });
    }

    const validatedFetch = this.urls.createValidatedFetch(
      spec.allowedDomains,
      spec.deniedDomains,
      4 * 1024 * 1024,
    );
    const authChallengeRef: { current: McpOAuthChallenge | null } = {
      current: null,
    };
    const authAwareFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const response = await validatedFetch(input, init);
      authChallengeRef.current = parseMcpOAuthChallenge(
        response.headers.get('www-authenticate'),
        response.status,
      );
      return response;
    };

    let client: any;
    const notifyChanged = async () => {
      if (!client || !spec.onCapabilitiesChanged) return;
      const discovery = await this.discoverWithClient(
        client,
        mcpConnectionMetadata(client, sdk.generation),
        spec.timeoutMs,
      );
      await spec.onCapabilitiesChanged(discovery);
    };

    client = createMcpClient(
      sdk,
      {
        name: this.config.clientName,
        version: this.config.clientVersion,
      },
      spec.protocolPreference,
      notifyChanged,
    );
    const transport = new sdk.Transport(url, {
      requestInit: { headers: spec.headers },
      fetch: authAwareFetch,
    });

    client.onclose = () => {
      const live = this.clients.get(spec.installationId);
      if (live?.client === client) this.clients.delete(spec.installationId);
    };

    try {
      await this.withTimeout(
        client.connect(transport),
        spec.timeoutMs,
        'MCP_CONNECT_TIMEOUT',
      );
    } catch (error) {
      await this.closeClient(client, transport);
      throw this.withAuthorizationChallenge(
        error,
        this.takeAuthorizationChallenge(authChallengeRef),
      );
    }

    const metadata = mcpConnectionMetadata(client, sdk.generation);
    this.clients.set(spec.installationId, {
      sdkGeneration: sdk.generation,
      client,
      transport,
      lastUsedAt: Date.now(),
      headerFingerprint: this.headerFingerprint(spec.headers),
      authChallengeRef,
      ...metadata,
    });
    return metadata;
  }

  async discover(
    installationId: string,
    timeoutMs: number,
  ): Promise<McpCapabilityDiscovery> {
    const live = this.mustGet(installationId);
    try {
      const discovery = await this.discoverWithClient(
        live.client,
        live,
        timeoutMs,
      );
      live.lastUsedAt = Date.now();
      return discovery;
    } catch (error) {
      throw this.withAuthorizationChallenge(
        error,
        this.takeAuthorizationChallenge(live.authChallengeRef),
      );
    }
  }

  async callTool(
    installationId: string,
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const live = this.mustGet(installationId);
    if (signal?.aborted) {
      throw Object.assign(new Error('MCP_CALL_CANCELLED'), {
        code: 'MCP_CALL_CANCELLED',
      });
    }
    const request = { name, arguments: args };
    const call =
      live.sdkGeneration === 'client_package'
        ? live.client.callTool(request, {
            signal,
            timeout: timeoutMs,
            maxTotalTimeout: timeoutMs,
            resetTimeoutOnProgress: true,
          })
        : live.client.callTool(request);
    try {
      const result = await this.withTimeout(
        call,
        timeoutMs,
        'MCP_CALL_TIMEOUT',
        signal,
      );
      live.lastUsedAt = Date.now();
      return result;
    } catch (error) {
      throw this.withAuthorizationChallenge(
        error,
        this.takeAuthorizationChallenge(live.authChallengeRef),
      );
    }
  }

  isConnected(installationId: string): boolean {
    return this.clients.has(installationId);
  }

  usesHeaders(
    installationId: string,
    headers: Record<string, string>,
  ): boolean {
    return this.clients.get(installationId)?.headerFingerprint
      === this.headerFingerprint(headers);
  }

  connectionInfo(installationId: string): McpClientConnectionInfo | null {
    const live = this.clients.get(installationId);
    return live
      ? {
          protocolEra: live.protocolEra,
          protocolVersion: live.protocolVersion,
          serverInfo: live.serverInfo,
          capabilities: live.capabilities,
          instructions: live.instructions,
        }
      : null;
  }

  async disconnect(installationId: string): Promise<void> {
    const live = this.clients.get(installationId);
    this.clients.delete(installationId);
    if (live) await this.closeClient(live.client, live.transport);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(
      [...this.clients.keys()].map((id) => this.disconnect(id)),
    );
  }

  private async discoverWithClient(
    client: any,
    connection: McpClientConnectionInfo,
    timeoutMs: number,
  ): Promise<McpCapabilityDiscovery> {
    const capabilities = connection.capabilities ?? {};
    const tools = hasMcpCapability(capabilities, 'tools')
      ? await this.withTimeout(
          listMcpItems(client, 'tools'),
          timeoutMs,
          'MCP_LIST_TOOLS_TIMEOUT',
        )
      : [];
    const resources = hasMcpCapability(capabilities, 'resources')
      ? await this.withTimeout(
          listMcpItems(client, 'resources'),
          timeoutMs,
          'MCP_LIST_RESOURCES_TIMEOUT',
        )
      : [];
    const prompts = hasMcpCapability(capabilities, 'prompts')
      ? await this.withTimeout(
          listMcpItems(client, 'prompts'),
          timeoutMs,
          'MCP_LIST_PROMPTS_TIMEOUT',
        )
      : [];

    return { connection, tools, resources, prompts };
  }

  private async closeClient(client: any, transport: any): Promise<void> {
    if (typeof transport?.terminateSession === 'function') {
      await Promise.resolve(transport.terminateSession()).catch(() => undefined);
    }
    await Promise.resolve(client?.close?.()).catch(() => undefined);
    await Promise.resolve(transport?.close?.()).catch(() => undefined);
  }


  private takeAuthorizationChallenge(
    reference: { current: McpOAuthChallenge | null },
  ): McpOAuthChallenge | null {
    const challenge = reference.current;
    reference.current = null;
    return challenge;
  }

  private withAuthorizationChallenge(
    error: unknown,
    challenge: McpOAuthChallenge | null,
  ): unknown {
    if (!challenge) return error;
    const code = challenge.error === 'insufficient_scope'
      ? 'MCP_OAUTH_INSUFFICIENT_SCOPE'
      : challenge.status === 401
        ? 'MCP_OAUTH_UNAUTHORIZED'
        : 'MCP_OAUTH_FORBIDDEN';
    return new McpRuntimeError(
      code,
      challenge.errorDescription ||
        (challenge.status === 401
          ? 'The MCP server rejected the OAuth access token.'
          : 'The MCP server rejected the current OAuth authorization.'),
      error,
      { authChallenge: challenge as unknown as Record<string, unknown> },
    );
  }

  private headerFingerprint(headers: Record<string, string>): string {
    const normalized = Object.entries(headers)
      .map(([key, value]) => [key.toLowerCase(), String(value)] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('MCP_RUNTIME_DISABLED');
    }
  }

  private mustGet(installationId: string): LiveClient {
    const live = this.clients.get(installationId);
    if (!live) {
      throw Object.assign(new Error('MCP_NOT_CONNECTED'), {
        code: 'MCP_NOT_CONNECTED',
      });
    }
    return live;
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    code: string,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Object.assign(new Error(code), { code })),
        Math.max(1_000, timeoutMs),
      );
      const onAbort = () =>
        reject(
          Object.assign(new Error('MCP_CALL_CANCELLED'), {
            code: 'MCP_CALL_CANCELLED',
          }),
        );
      signal?.addEventListener('abort', onAbort, { once: true });
      promise.then(resolve, reject).finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      });
    });
  }
}