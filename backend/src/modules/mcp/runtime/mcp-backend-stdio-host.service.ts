import {
  Inject,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  McpCapabilityDiscovery,
  McpClientConnectionInfo,
  McpRuntimeConfig,
  McpServerConfig,
} from '../domain/mcp-runtime.types';
import { MCP_RUNTIME_CONFIG } from '../mcp-runtime.tokens';
import { McpStdioPolicyService } from '../security/mcp-stdio-policy.service';
import {
  createMcpClient,
  hasMcpCapability,
  listMcpItems,
  loadMcpClientSdk,
  mcpConnectionMetadata,
  type McpSdkGeneration,
} from './mcp-dynamic-import';

type BackendStdioConnection = McpClientConnectionInfo & {
  sdkGeneration: McpSdkGeneration;
  client: any;
  transport: any;
  lastUsedAt: number;
};

export interface BackendStdioConnectSpec {
  installationId: string;
  server: McpServerConfig;
  timeoutMs: number;
  onCapabilitiesChanged?: (
    discovery: McpCapabilityDiscovery,
  ) => void | Promise<void>;
}

@Injectable()
export class McpBackendStdioHostService implements OnModuleDestroy {
  private readonly connections = new Map<string, BackendStdioConnection>();

  constructor(
    private readonly stdioPolicy: McpStdioPolicyService,
    @Inject(MCP_RUNTIME_CONFIG)
    private readonly config: McpRuntimeConfig,
  ) {}

  async connect(spec: BackendStdioConnectSpec): Promise<McpClientConnectionInfo> {
    this.assertEnabled();
    this.stdioPolicy.assertAllowed(spec.server);
    await this.disconnect(spec.installationId);

    if (!spec.server.command) {
      throw Object.assign(new Error('MCP_COMMAND_REQUIRED'), {
        code: 'MCP_COMMAND_REQUIRED',
      });
    }

    let sdk;
    try {
      sdk = await loadMcpClientSdk(
        'stdio',
        spec.server.protocolPreference,
      );
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'MCP_CLIENT_SDK_NOT_INSTALLED',
        message:
          'Install @modelcontextprotocol/client v2 or @modelcontextprotocol/sdk v1 to use MCP stdio.',
        cause: error instanceof Error ? error.message : String(error),
        detail:
          error && typeof error === 'object' && 'detail' in error
            ? (error as { detail?: unknown }).detail
            : undefined,
      });
    }

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
      spec.server.protocolPreference,
      notifyChanged,
    );

    const transport = new sdk.Transport({
      command: spec.server.command,
      args: spec.server.args ?? [],
      cwd: spec.server.workingDirectory,
      env: this.cleanEnvironment(spec.server.env ?? {}),
    });

    client.onclose = () => {
      const live = this.connections.get(spec.installationId);
      if (live?.client === client) {
        this.connections.delete(spec.installationId);
      }
    };

    try {
      await this.withTimeout(
        client.connect(transport),
        spec.timeoutMs,
        'MCP_CONNECT_TIMEOUT',
      );
    } catch (error) {
      await Promise.resolve(client.close?.()).catch(() => undefined);
      await Promise.resolve(transport.close?.()).catch(() => undefined);
      throw error;
    }

    const metadata = mcpConnectionMetadata(client, sdk.generation);
    this.connections.set(spec.installationId, {
      sdkGeneration: sdk.generation,
      client,
      transport,
      ...metadata,
      lastUsedAt: Date.now(),
    });

    return metadata;
  }

  async discover(
    installationId: string,
    timeoutMs: number,
  ): Promise<McpCapabilityDiscovery> {
    const live = this.mustGet(installationId);
    const discovery = await this.discoverWithClient(live.client, live, timeoutMs);
    live.lastUsedAt = Date.now();
    return discovery;
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
    const result = await this.withTimeout(
      call,
      timeoutMs,
      'MCP_CALL_TIMEOUT',
      signal,
    );
    live.lastUsedAt = Date.now();
    return result;
  }

  isConnected(installationId: string): boolean {
    return this.connections.has(installationId);
  }

  connectionInfo(installationId: string): McpClientConnectionInfo | null {
    const live = this.connections.get(installationId);
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
    const live = this.connections.get(installationId);
    this.connections.delete(installationId);
    if (!live) return;
    await Promise.resolve(live.client.close?.()).catch(() => undefined);
    await Promise.resolve(live.transport.close?.()).catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(
      [...this.connections.keys()].map((id) => this.disconnect(id)),
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

  private mustGet(installationId: string): BackendStdioConnection {
    const live = this.connections.get(installationId);
    if (!live) {
      throw Object.assign(new Error('MCP_NOT_CONNECTED'), {
        code: 'MCP_NOT_CONNECTED',
      });
    }
    return live;
  }

  private cleanEnvironment(
    explicit: Record<string, string>,
  ): Record<string, string> {
    const baselineKeys =
      process.platform === 'win32'
        ? [
            'PATH',
            'Path',
            'SystemRoot',
            'TEMP',
            'TMP',
            'USERPROFILE',
            'APPDATA',
            'LOCALAPPDATA',
          ]
        : ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER'];
    const baseline = Object.fromEntries(
      baselineKeys
        .map((key) => [key, process.env[key]])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    return { ...baseline, ...explicit };
  }

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('MCP_RUNTIME_DISABLED');
    }
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
