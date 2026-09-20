// desktop-mcp-stdio-host.ts
import { app, dialog, safeStorage } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveSeekmoreDataHome } from '../seekmore-data-home';
import {
  createDesktopMcpClient,
  desktopHasMcpCapability,
  desktopMcpConnectionMetadata,
  listDesktopMcpItems,
  loadDesktopMcpSdk,
  type DesktopMcpSdkGeneration,
} from './desktop-mcp-dynamic-import';
import { DesktopMcpSecretStore } from './desktop-mcp-secret-store';
import { DesktopMcpExecutionApprovalStore } from './desktop-mcp-execution-approval-store';
import { DesktopMcpRuntimeResolver } from './desktop-mcp-runtime-resolver';
import { DesktopMcpSetupRegistry } from './setup/desktop-mcp-setup-registry';
import type { DesktopMcpSetup, DesktopMcpSetupResult } from './setup/desktop-mcp-setup.types';

type ConnectInput = {
  installationId: string;
  displayName: string;
  command: string;
  args?: string[];
  workingDirectory?: string | null;
  timeoutMs?: number;
  protocolPreference?: string | null;
  secretRef?: string | null;
  environment?: Record<string, string>;
  desktopSetup?: unknown;
};

type ConnectionState = {
  cachedTools: Record<string, unknown>[];
  cachedResources: Record<string, unknown>[];
  cachedPrompts: Record<string, unknown>[];
  toolsChanged: boolean;
};

type ActiveConnection = {
  installationId: string;
  displayName: string;
  digest: string;
  sdkGeneration: DesktopMcpSdkGeneration;
  client: any;
  transport: any;
  connectedAt: string;
  protocolEra: string | null;
  protocolVersion: string | null;
  serverInfo: Record<string, unknown> | null;
  capabilities: Record<string, unknown>;
  instructions: string | null;
  pid: number | null;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  state: ConnectionState;
};

type RecentStatus = {
  connected: false;
  installationId: string;
  displayName?: string;
  failureCode?: string;
  failureMessage?: string;
  failureStage?: string;
  pid?: number | null;
  stderrSummary?: string | null;
  updatedAt: string;
};

type DiagnosticState = {
  installationId: string;
  displayName: string;
  startedAt: number;
  stage: string;
  pid: number | null;
  stderrText: string;
  transportError: string | null;
};

type McpHostError = Error & {
  code: string;
  detail?: Record<string, unknown>;
};

const MAX_STDERR_CHARS = 16_384;
const MAX_STDERR_SUMMARY_CHARS = 2_000;
const MAX_RECENT_STATUSES = 100;

export class DesktopMcpStdioHost {
  private readonly connections = new Map<string, ActiveConnection>();
  private readonly activeCalls = new Map<
    string,
    { installationId: string; controller: AbortController }
  >();
  private readonly recentStatuses = new Map<string, RecentStatus>();
  private readonly runtimeResolver = new DesktopMcpRuntimeResolver({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    homePath: app.getPath('home'),
    platform: process.platform,
    arch: process.arch,
    environment: process.env,
  });

  constructor(
    private readonly secrets: DesktopMcpSecretStore,
    private readonly setups: DesktopMcpSetupRegistry,
    private readonly approvals: DesktopMcpExecutionApprovalStore,
  ) {}

  health(): Record<string, unknown> {
    return {
      available: true,
      protocolBaseline: '2025-11-25',
      activeConnections: this.connections.size,
      recentFailures: [...this.recentStatuses.values()].filter(
        (item) => Boolean(item.failureCode),
      ).length,
      safeStorageAvailable: safeStorage.isEncryptionAvailable(),
    };
  }

  async connect(input: ConnectInput): Promise<Record<string, unknown>> {
    const normalized = await this.validate(input);
    const existing = this.connections.get(normalized.installationId);

    if (existing?.digest === normalized.digest) {
      return this.status(normalized.installationId);
    }
    if (existing) {
      await this.disconnect(normalized.installationId);
    }

    const diagnostic: DiagnosticState = {
      installationId: normalized.installationId,
      displayName: normalized.displayName,
      startedAt: Date.now(),
      stage: 'validated',
      pid: null,
      stderrText: '',
      transportError: null,
    };

    this.log('desktop.mcp.connect_started', {
      installationId: normalized.installationId,
      displayName: normalized.displayName,
      command: normalized.command,
      argumentCount: normalized.args.length,
      environmentKeys: Object.keys(normalized.environment).join(','),
      workingDirectory: normalized.workingDirectory,
      timeoutMs: normalized.timeoutMs,
    });

    if (
      !await this.approvals.isApproved(
        normalized.installationId,
        normalized.executionApprovalDigest,
        normalized.desktopSetupApprovalDigest,
      )
    ) {
      diagnostic.stage = 'awaiting_user_approval';
      const result = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['取消', '允许并连接'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: '允许启动本地 MCP？',
        message: `Seek More 将启动“${normalized.displayName}”`,
        detail: [
          `命令：${normalized.command}`,
          `参数：${normalized.args.join(' ') || '无'}`,
          `工作目录：${normalized.workingDirectory ?? '默认受限目录'}`,
          ...(normalized.desktopSetup
            ? [
                '',
                `该 Integration 需要执行经过审核的本地准备：${normalized.desktopSetup.kind}`,
              ]
            : []),
          '',
          '该进程仅继承最小环境变量，并由 Desktop Connector Host 管理。',
        ].join('\n'),
      });

      if (result.response !== 1) {
        const error = this.error(
          'MCP_STDIO_USER_DENIED',
          'User denied the local MCP process.',
          this.diagnosticDetail(diagnostic),
        );
        this.rememberFailure(normalized, error);
        throw error;
      }
      await this.approvals.approve(
        normalized.installationId,
        normalized.executionApprovalDigest,
        normalized.desktopSetupApprovalDigest,
      );
    }

    let setupResult: DesktopMcpSetupResult | null = null;
    if (normalized.desktopSetup) {
      diagnostic.stage = 'desktop_setup';
      this.log('desktop.mcp.setup_started', {
        installationId: normalized.installationId,
        setupKind: normalized.desktopSetup.kind,
        releaseKey: normalized.desktopSetup.releaseKey,
      });
      try {
        setupResult = await this.setups.prepare(normalized.desktopSetup, {
          installationId: normalized.installationId,
          displayName: normalized.displayName,
          log: (stage, fields) => this.log(stage, fields),
          warn: (stage, fields) => this.warn(stage, fields),
        });
        this.log('desktop.mcp.setup_ready', {
          installationId: normalized.installationId,
          setupKind: setupResult.kind,
          releaseKey: setupResult.releaseKey,
          applicationVersion: setupResult.applicationVersion,
          installed: setupResult.installed,
          launched: setupResult.launched,
        });
      } catch (error) {
        const normalizedError = this.normalizeConnectError(error, diagnostic);
        this.rememberFailure(normalized, normalizedError);
        throw normalizedError;
      }
    }

    diagnostic.stage = 'resolving_secrets';
    const secretValues = await this.secrets.resolve(
      normalized.installationId,
      normalized.secretRef,
    );
    const environment = {
      ...normalized.environment,
      ...secretValues,
    };

    diagnostic.stage = 'loading_client';

    let sdk;
    try {
      sdk = await loadDesktopMcpSdk(normalized.protocolPreference);
    } catch (error) {
      const normalizedError = this.asError(
        error,
        'MCP_CLIENT_SDK_NOT_INSTALLED',
        'Install @modelcontextprotocol/client v2 or @modelcontextprotocol/sdk v1 to use local MCP services.',
        this.diagnosticDetail(diagnostic),
      );
      this.rememberFailure(normalized, normalizedError);
      throw normalizedError;
    }

    const liveState: ConnectionState = {
      cachedTools: [],
      cachedResources: [],
      cachedPrompts: [],
      toolsChanged: false,
    };
    let client: any;
    const onListChanged = async (kind: 'tools' | 'resources' | 'prompts') => {
      if (!client) return;
      const metadata = desktopMcpConnectionMetadata(client, sdk.generation);
      const discovery = await this.discoverWithClient(
        client,
        metadata,
        normalized.timeoutMs,
      );
      liveState.cachedTools = discovery.tools;
      liveState.cachedResources = discovery.resources;
      liveState.cachedPrompts = discovery.prompts;
      if (kind === 'tools') liveState.toolsChanged = true;
      const connection = this.connections.get(normalized.installationId);
      if (connection?.digest === normalized.digest) {
        connection.protocolEra = metadata.protocolEra;
        connection.protocolVersion = metadata.protocolVersion;
        connection.serverInfo = metadata.serverInfo;
        connection.capabilities = metadata.capabilities;
        connection.instructions = metadata.instructions;
        connection.toolCount = discovery.tools.length;
        connection.resourceCount = discovery.resources.length;
        connection.promptCount = discovery.prompts.length;
      }
      this.log('desktop.mcp.capabilities_changed', {
        installationId: normalized.installationId,
        kind,
        toolCount: discovery.tools.length,
        resourceCount: discovery.resources.length,
        promptCount: discovery.prompts.length,
      });
    };
    client = createDesktopMcpClient(
      sdk,
      { name: 'seek-more-desktop', version: app.getVersion() },
      normalized.protocolPreference,
      onListChanged,
    );

    const transport = new sdk.StdioClientTransport({
      command: normalized.command,
      args: normalized.args,
      cwd: normalized.workingDirectory ?? undefined,
      env: this.runtimeResolver.cleanEnvironment(environment),
      stderr: 'pipe',
      maxBufferSize: 10 * 1024 * 1024,
    });

    const stderrStream = transport.stderr;
    const onStderr = (chunk: unknown) => {
      diagnostic.stderrText = this.appendDiagnosticText(
        diagnostic.stderrText,
        chunk,
      );
    };
    stderrStream?.on?.('data', onStderr);

    client.onerror = (error: unknown) => {
      diagnostic.transportError = this.safeErrorMessage(error);
      this.warn('desktop.mcp.client_error', {
        installationId: normalized.installationId,
        stage: diagnostic.stage,
        pid: diagnostic.pid,
        error: diagnostic.transportError,
      });
    };

    let rejectClosed: ((error: McpHostError) => void) | null = null;
    const closedPromise = new Promise<never>((_resolve, reject) => {
      rejectClosed = reject;
    });

    client.onclose = () => {
      const closedError = this.error(
        'MCP_STDIO_PROCESS_CLOSED',
        'The local MCP process closed.',
        this.diagnosticDetail(diagnostic),
      );
      rejectClosed?.(closedError);

      const connection = this.connections.get(normalized.installationId);
      if (!connection || connection.digest !== normalized.digest) return;

      this.dropConnection(normalized.installationId, normalized.digest);
      const status: RecentStatus = {
        connected: false,
        installationId: normalized.installationId,
        displayName: normalized.displayName,
        failureCode: 'MCP_STDIO_PROCESS_CLOSED',
        failureMessage: 'The local MCP process closed.',
        failureStage: 'runtime_closed',
        pid: connection.pid,
        stderrSummary: this.stderrSummary(diagnostic.stderrText),
        updatedAt: new Date().toISOString(),
      };
      this.rememberStatus(status);
      this.warn('desktop.mcp.process_closed', {
        installationId: normalized.installationId,
        displayName: normalized.displayName,
        pid: connection.pid,
        stderrSummary: status.stderrSummary,
      });
    };

    try {
      diagnostic.stage = 'protocol_connecting';
      this.log('desktop.mcp.protocol_connecting', {
        installationId: normalized.installationId,
        displayName: normalized.displayName,
        timeoutMs: normalized.timeoutMs,
      });

      const connectPromise = client.connect(transport);
      diagnostic.pid = this.transportPid(transport);

      await this.withTimeout(
        Promise.race([connectPromise, closedPromise]),
        normalized.timeoutMs,
        'MCP_STDIO_PROTOCOL_TIMEOUT',
        undefined,
        () => this.diagnosticDetail(diagnostic),
      );

      diagnostic.pid = this.transportPid(transport);
      diagnostic.stage = 'protocol_connected';
      const metadata = desktopMcpConnectionMetadata(client, sdk.generation);

      this.log('desktop.mcp.protocol_connected', {
        installationId: normalized.installationId,
        displayName: normalized.displayName,
        pid: diagnostic.pid,
        protocolEra: metadata.protocolEra,
        protocolVersion: metadata.protocolVersion,
        durationMs: Date.now() - diagnostic.startedAt,
      });

      diagnostic.stage = 'capability_discovery';
      this.log('desktop.mcp.capability_discovery_started', {
        installationId: normalized.installationId,
        pid: diagnostic.pid,
      });

      const discovery = await this.withTimeout(
        Promise.race([
          this.discoverWithClient(client, metadata, normalized.timeoutMs),
          closedPromise,
        ]),
        normalized.timeoutMs,
        'MCP_STDIO_CAPABILITY_DISCOVERY_TIMEOUT',
        undefined,
        () => this.diagnosticDetail(diagnostic),
      );
      liveState.cachedTools = discovery.tools;
      liveState.cachedResources = discovery.resources;
      liveState.cachedPrompts = discovery.prompts;
      liveState.toolsChanged = false;

      const connection: ActiveConnection = {
        installationId: normalized.installationId,
        displayName: normalized.displayName,
        digest: normalized.digest,
        sdkGeneration: sdk.generation,
        client,
        transport,
        connectedAt: new Date().toISOString(),
        protocolEra: metadata.protocolEra,
        protocolVersion: metadata.protocolVersion,
        serverInfo: metadata.serverInfo,
        capabilities: metadata.capabilities,
        instructions: metadata.instructions,
        pid: diagnostic.pid,
        toolCount: liveState.cachedTools.length,
        resourceCount: liveState.cachedResources.length,
        promptCount: liveState.cachedPrompts.length,
        state: liveState,
      };

      rejectClosed = null;
      this.connections.set(normalized.installationId, connection);
      this.recentStatuses.delete(normalized.installationId);

      this.log('desktop.mcp.connected', {
        installationId: normalized.installationId,
        displayName: normalized.displayName,
        pid: diagnostic.pid,
        protocolEra: metadata.protocolEra,
        protocolVersion: metadata.protocolVersion,
        toolCount: liveState.cachedTools.length,
        resourceCount: liveState.cachedResources.length,
        promptCount: liveState.cachedPrompts.length,
        durationMs: Date.now() - diagnostic.startedAt,
      });

      return {
        ...this.status(normalized.installationId),
        setup: setupResult,
        tools: liveState.cachedTools,
        resources: liveState.cachedResources,
        prompts: liveState.cachedPrompts,
      };
    } catch (error) {
      const normalizedError = this.normalizeConnectError(error, diagnostic);

      await Promise.resolve(client.close?.()).catch(() => undefined);
      await Promise.resolve(transport.close?.()).catch(() => undefined);
      stderrStream?.off?.('data', onStderr);

      this.rememberFailure(normalized, normalizedError);
      this.warn('desktop.mcp.connect_failed', {
        installationId: normalized.installationId,
        displayName: normalized.displayName,
        stage: normalizedError.detail?.stage,
        pid: normalizedError.detail?.pid,
        failureCode: normalizedError.code,
        stderrSummary: normalizedError.detail?.stderrSummary,
        durationMs: Date.now() - diagnostic.startedAt,
        error: normalizedError.message,
      });

      throw normalizedError;
    }
  }

  async discover(
    installationId: string,
    timeoutMs = 120_000,
  ): Promise<Record<string, unknown>> {
    const connection = this.mustGet(installationId);
    const startedAt = Date.now();
    const metadata = {
      protocolEra: connection.protocolEra,
      protocolVersion: connection.protocolVersion,
      serverInfo: connection.serverInfo,
      capabilities: connection.capabilities,
      instructions: connection.instructions,
    };

    try {
      const discovery = await this.discoverWithClient(
        connection.client,
        metadata,
        this.timeout(timeoutMs),
      );
      connection.state.cachedTools = discovery.tools;
      connection.state.cachedResources = discovery.resources;
      connection.state.cachedPrompts = discovery.prompts;
      connection.state.toolsChanged = false;
      connection.toolCount = discovery.tools.length;
      connection.resourceCount = discovery.resources.length;
      connection.promptCount = discovery.prompts.length;

      this.log('desktop.mcp.capabilities_discovered', {
        installationId: connection.installationId,
        pid: connection.pid,
        toolCount: connection.toolCount,
        resourceCount: connection.resourceCount,
        promptCount: connection.promptCount,
        durationMs: Date.now() - startedAt,
      });

      return discovery;
    } catch (error) {
      this.warn('desktop.mcp.capability_discovery_failed', {
        installationId: connection.installationId,
        pid: connection.pid,
        durationMs: Date.now() - startedAt,
        error: this.safeErrorMessage(error),
      });
      throw error;
    }
  }

  async listTools(
    installationId: string,
  ): Promise<Record<string, unknown>[]> {
    const discovery = await this.discover(installationId);
    return Array.isArray(discovery.tools)
      ? (discovery.tools as Record<string, unknown>[])
      : [];
  }

  consumeToolChanges(installationId: string): Record<string, unknown> {
    const connection = this.mustGet(installationId);
    if (!connection.state.toolsChanged) {
      return { changed: false, tools: [] };
    }
    connection.state.toolsChanged = false;
    return { changed: true, tools: connection.state.cachedTools };
  }

  async callTool(
    installationId: string,
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 60_000,
    requestId?: string | null,
  ): Promise<unknown> {
    const connection = this.mustGet(installationId);
    const toolName = String(name ?? '').trim();
    if (!toolName || toolName.length > 300 || /[\r\n\0]/.test(toolName)) {
      throw this.error('MCP_TOOL_NAME_INVALID', 'Invalid MCP tool name.');
    }

    const callId =
      this.optionalRequestId(requestId) ?? `mcp_call_${randomUUID()}`;
    if (this.activeCalls.has(callId)) {
      throw this.error(
        'MCP_REQUEST_ID_CONFLICT',
        'The MCP request id is already active.',
      );
    }

    const controller = new AbortController();
    this.activeCalls.set(callId, { installationId, controller });
    const startedAt = Date.now();

    try {
      const timeout = this.timeout(timeoutMs);
      this.log('desktop.mcp.tool_call_started', {
        installationId,
        requestId: callId,
        toolName,
        timeoutMs: timeout,
      });

      const request = { name: toolName, arguments: args };
      const call =
        connection.sdkGeneration === 'client_package'
          ? connection.client.callTool(request, {
              signal: controller.signal,
              timeout,
              maxTotalTimeout: timeout,
              resetTimeoutOnProgress: true,
            })
          : connection.client.callTool(request);
      const result = await this.withTimeout(
        call,
        timeout,
        'MCP_TOOL_CALL_TIMEOUT',
        controller.signal,
      );
      this.assertResultSize(result, 8 * 1024 * 1024);

      this.log('desktop.mcp.tool_call_completed', {
        installationId,
        requestId: callId,
        toolName,
        durationMs: Date.now() - startedAt,
      });

      return result;
    } catch (error) {
      this.warn('desktop.mcp.tool_call_failed', {
        installationId,
        requestId: callId,
        toolName,
        durationMs: Date.now() - startedAt,
        error: this.safeErrorMessage(error),
      });
      throw error;
    } finally {
      this.activeCalls.delete(callId);
    }
  }

  cancelCall(requestId: string): { cancelled: boolean } {
    const cleanRequestId = this.optionalRequestId(requestId);
    if (!cleanRequestId) return { cancelled: false };
    const active = this.activeCalls.get(cleanRequestId);
    if (!active) return { cancelled: false };
    active.controller.abort();
    return { cancelled: true };
  }

  async disconnect(
    installationId: string,
  ): Promise<{ disconnected: boolean }> {
    const cleanInstallationId = String(installationId ?? '').trim();
    const connection = this.connections.get(cleanInstallationId);
    if (!connection) {
      return { disconnected: true };
    }

    this.connections.delete(connection.installationId);
    for (const [requestId, active] of this.activeCalls) {
      if (active.installationId === connection.installationId) {
        active.controller.abort();
        this.activeCalls.delete(requestId);
      }
    }

    await Promise.resolve(connection.transport.terminateSession?.()).catch(() => undefined);
    await Promise.resolve(connection.client.close?.()).catch(() => undefined);
    await Promise.resolve(connection.transport.close?.()).catch(() => undefined);
    this.recentStatuses.delete(connection.installationId);

    this.log('desktop.mcp.disconnected', {
      installationId: connection.installationId,
      displayName: connection.displayName,
      pid: connection.pid,
    });

    return { disconnected: true };
  }

  status(installationId: string): Record<string, unknown> {
    const cleanInstallationId = String(installationId ?? '').trim();
    const connection = this.connections.get(cleanInstallationId);

    if (connection) {
      return {
        connected: true,
        installationId: connection.installationId,
        displayName: connection.displayName,
        connectedAt: connection.connectedAt,
        protocolEra: connection.protocolEra,
        protocolVersion: connection.protocolVersion,
        serverInfo: connection.serverInfo,
        capabilities: connection.capabilities,
        instructions: connection.instructions,
        pid: connection.pid,
        toolCount: connection.toolCount,
        resourceCount: connection.resourceCount,
        promptCount: connection.promptCount,
      };
    }

    return (
      this.recentStatuses.get(cleanInstallationId) ?? {
        connected: false,
        installationId: cleanInstallationId,
      }
    );
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(
      [...this.connections.keys()].map((installationId) =>
        this.disconnect(installationId),
      ),
    );
  }

  private dropConnection(installationId: string, digest: string): void {
    const connection = this.connections.get(installationId);
    if (!connection || connection.digest !== digest) return;
    this.connections.delete(installationId);

    for (const [requestId, active] of this.activeCalls) {
      if (active.installationId === installationId) {
        active.controller.abort();
        this.activeCalls.delete(requestId);
      }
    }
  }


  private mustGet(installationId: string): ActiveConnection {
    const connection = this.connections.get(
      String(installationId ?? '').trim(),
    );
    if (!connection) {
      throw this.error(
        'MCP_STDIO_NOT_CONNECTED',
        'The local MCP server is not connected.',
      );
    }
    return connection;
  }

  private async validate(input: ConnectInput) {
    const installationId = this.required(
      input.installationId,
      'MCP_INSTALLATION_ID_INVALID',
      200,
    );
    const displayName = this.required(
      input.displayName,
      'MCP_DISPLAY_NAME_REQUIRED',
      200,
    );
    const requestedCommand = this.required(
      input.command,
      'MCP_STDIO_COMMAND_REQUIRED',
      1_024,
    );
    if (/[\r\n\0]/.test(requestedCommand)) {
      throw this.error(
        'MCP_STDIO_COMMAND_INVALID',
        'The MCP command contains forbidden characters.',
      );
    }

    const requestedArgs = Array.isArray(input.args)
      ? input.args.map((item) => String(item))
      : [];
    if (
      requestedArgs.length > 128 ||
      requestedArgs.some((item) => item.length > 8_192 || /[\r\n\0]/.test(item))
    ) {
      throw this.error(
        'MCP_STDIO_ARGS_INVALID',
        'The MCP argument list is invalid.',
      );
    }

    const invocation = await this.runtimeResolver.resolveInvocation(
      requestedCommand,
      requestedArgs,
    );
    const { command, args } = invocation;

    const workingDirectory = await this.validateWorkingDirectory(
      input.workingDirectory,
      installationId,
    );
    const timeoutMs = this.timeout(input.timeoutMs);
    const protocolPreference = this.protocolPreference(input.protocolPreference);
    const secretRef = input.secretRef ? String(input.secretRef) : null;
    const environment = this.validateEnvironment(input.environment);
    const desktopSetup = this.validateDesktopSetup(input.desktopSetup);
    const executionApprovalDigest = createHash('sha256')
      .update(
        JSON.stringify({
          command,
          args,
          workingDirectory,
          environment,
          protocolPreference,
          secretRef,
        }),
      )
      .digest('hex');
    const desktopSetupApprovalDigest = desktopSetup
      ? createHash('sha256')
          .update(JSON.stringify(desktopSetup))
          .digest('hex')
      : null;
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          command,
          args,
          workingDirectory,
          environment,
          protocolPreference,
          secretRef,
          desktopSetup,
        }),
      )
      .digest('hex');

    return {
      installationId,
      displayName,
      command,
      args,
      workingDirectory,
      timeoutMs,
      protocolPreference,
      secretRef,
      environment,
      desktopSetup,
      executionApprovalDigest,
      desktopSetupApprovalDigest,
      digest,
    };
  }

  private validateDesktopSetup(value: unknown): DesktopMcpSetup | null {
    return this.setups.validate(value);
  }

  private async validateWorkingDirectory(
    value: string | null | undefined,
    installationId: string,
  ): Promise<string> {
    const raw = String(value ?? '').trim();
    const defaultDirectory = path.join(
      resolveSeekmoreDataHome(app),
      'mcp-workspaces',
      createHash('sha256')
        .update(installationId)
        .digest('hex')
        .slice(0, 32),
    );

    if (!raw) {
      await mkdir(defaultDirectory, { recursive: true, mode: 0o700 });
    }
    if (/[\r\n\0]/.test(raw)) {
      throw this.error(
        'MCP_WORKING_DIRECTORY_INVALID',
        'Invalid MCP working directory.',
      );
    }

    const resolved = await realpath(path.resolve(raw || defaultDirectory));
    const metadata = await stat(resolved);
    if (!metadata.isDirectory()) {
      throw this.error(
        'MCP_WORKING_DIRECTORY_INVALID',
        'MCP working directory must be a directory.',
      );
    }

    const allowedRoots = await Promise.all(
      [
        app.getPath('home'),
        resolveSeekmoreDataHome(app),
        ...this.extraAllowedRoots(),
      ]
        .filter(Boolean)
        .map((item) => realpath(path.resolve(item)).catch(() => null)),
    );
    if (!allowedRoots.some((root) => root && this.isInside(root, resolved))) {
      throw this.error(
        'MCP_WORKING_DIRECTORY_DENIED',
        'MCP working directory is outside the allowed Desktop roots.',
      );
    }

    return resolved;
  }

  private protocolPreference(
    value: unknown,
  ): 'legacy' | 'auto' | 'modern' {
    const normalized = String(value ?? 'legacy').trim().toLowerCase();
    return normalized === 'auto' || normalized === 'modern'
      ? normalized
      : 'legacy';
  }

  private validateEnvironment(value: unknown): Record<string, string> {
    const row = this.record(value);
    const entries = Object.entries(row);
    if (entries.length > 64) {
      throw this.error(
        'MCP_ENVIRONMENT_INVALID',
        'Too many MCP environment variables.',
      );
    }

    const result: Record<string, string> = {};
    for (const [rawKey, rawValue] of entries) {
      const key = rawKey.trim();
      const item = String(rawValue ?? '');
      if (
        !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) ||
        item.length > 16_384 ||
        /\0/.test(item)
      ) {
        throw this.error(
          'MCP_ENVIRONMENT_INVALID',
          'Invalid MCP environment variable.',
        );
      }
      result[key] = item;
    }
    return result;
  }

  private async discoverWithClient(
    client: any,
    connection: {
      protocolEra: string | null;
      protocolVersion: string | null;
      serverInfo: Record<string, unknown> | null;
      capabilities: Record<string, unknown>;
      instructions: string | null;
    },
    timeoutMs: number,
  ): Promise<{
    connection: typeof connection;
    tools: Record<string, unknown>[];
    resources: Record<string, unknown>[];
    prompts: Record<string, unknown>[];
  }> {
    const tools = desktopHasMcpCapability(connection.capabilities, 'tools')
      ? await this.withTimeout(
          listDesktopMcpItems(client, 'tools'),
          timeoutMs,
          'MCP_STDIO_TOOL_DISCOVERY_TIMEOUT',
        )
      : [];
    const resources = desktopHasMcpCapability(
      connection.capabilities,
      'resources',
    )
      ? await this.withTimeout(
          listDesktopMcpItems(client, 'resources'),
          timeoutMs,
          'MCP_STDIO_RESOURCE_DISCOVERY_TIMEOUT',
        )
      : [];
    const prompts = desktopHasMcpCapability(
      connection.capabilities,
      'prompts',
    )
      ? await this.withTimeout(
          listDesktopMcpItems(client, 'prompts'),
          timeoutMs,
          'MCP_STDIO_PROMPT_DISCOVERY_TIMEOUT',
        )
      : [];
    return {
      connection,
      tools: tools.map((tool) => this.safeToolDescriptor(tool)),
      resources,
      prompts,
    };
  }

  private safeToolDescriptor(value: unknown): Record<string, unknown> {
    const row = this.record(value);
    return {
      name: String(row.name ?? ''),
      ...(typeof row.title === 'string' ? { title: row.title } : {}),
      ...(typeof row.description === 'string'
        ? { description: row.description }
        : {}),
      inputSchema: this.inputSchema(row.inputSchema),
      ...(row.outputSchema
        ? { outputSchema: this.record(row.outputSchema) }
        : {}),
      ...(row.annotations
        ? { annotations: this.record(row.annotations) }
        : {}),
    };
  }

  private inputSchema(value: unknown): Record<string, unknown> {
    const schema = this.record(value);
    return Object.keys(schema).length > 0
      ? schema
      : { type: 'object', properties: {}, additionalProperties: true };
  }

  private assertResultSize(value: unknown, maximum: number): void {
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (bytes > maximum) {
      throw this.error(
        'MCP_TOOL_RESULT_TOO_LARGE',
        `MCP tool result exceeds ${maximum} bytes.`,
      );
    }
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    code: string,
    signal?: AbortSignal,
    detailFactory?: () => Record<string, unknown>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = () =>
        finish(() =>
          reject(
            this.error(
              'MCP_CALL_CANCELLED',
              'MCP operation was cancelled.',
              detailFactory?.(),
            ),
          ),
        );
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              this.error(
                code,
                'MCP operation timed out.',
                detailFactory?.(),
              ),
            ),
          ),
        timeoutMs,
      ) as ReturnType<typeof setTimeout> & { unref?: () => void };
      timer.unref?.();
      signal?.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  }

  private asError(
    error: unknown,
    fallbackCode: string,
    fallbackMessage: string,
    detail: Record<string, unknown> = {},
  ): McpHostError {
    const existing = error as Partial<McpHostError> | null;
    const code = String(existing?.code ?? '').trim() || fallbackCode;
    const message =
      error instanceof Error && error.message
        ? error.message
        : fallbackMessage;
    return this.error(code, message, {
      ...detail,
      ...this.record(existing?.detail),
    });
  }

  private normalizeConnectError(
    error: unknown,
    diagnostic: DiagnosticState,
  ): McpHostError {
    const existing = error as Partial<McpHostError> | null;
    const code = String(existing?.code ?? '').trim();
    const fallbackCode =
      diagnostic.stage === 'capability_discovery'
        ? 'MCP_STDIO_CAPABILITY_DISCOVERY_FAILED'
        : diagnostic.stage === 'protocol_connecting'
          ? 'MCP_STDIO_PROTOCOL_FAILED'
          : 'MCP_STDIO_PROCESS_START_FAILED';
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'The local MCP server failed to connect.';
    const detail = {
      ...this.record(existing?.detail),
      ...this.diagnosticDetail(diagnostic),
    };

    return this.error(code || fallbackCode, message, detail);
  }

  private diagnosticDetail(
    diagnostic: DiagnosticState,
  ): Record<string, unknown> {
    return {
      stage: diagnostic.stage,
      installationId: diagnostic.installationId,
      displayName: diagnostic.displayName,
      pid: diagnostic.pid,
      durationMs: Date.now() - diagnostic.startedAt,
      stderrSummary: this.stderrSummary(diagnostic.stderrText),
      transportError: diagnostic.transportError,
    };
  }

  private appendDiagnosticText(current: string, chunk: unknown): string {
    const next = `${current}${Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk ?? '')}`;
    return next.length <= MAX_STDERR_CHARS
      ? next
      : next.slice(next.length - MAX_STDERR_CHARS);
  }

  private stderrSummary(value: string): string | null {
    const clean = this.redactDiagnosticText(value)
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return null;
    return clean.length <= MAX_STDERR_SUMMARY_CHARS
      ? clean
      : `${clean.slice(0, MAX_STDERR_SUMMARY_CHARS)}...<truncated>`;
  }

  private redactDiagnosticText(value: string): string {
    return String(value ?? '')
      .replace(
        /\b(authorization|proxy-authorization)\s*[:=]\s*[^\s,;]+/gi,
        '$1=<redacted>',
      )
      .replace(
        /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret)\s*[:=]\s*[^\s,;]+/gi,
        '$1=<redacted>',
      )
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>');
  }

  private transportPid(transport: any): number | null {
    const pid = Number(transport?.pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }

  private rememberFailure(
    input: { installationId: string; displayName: string },
    error: McpHostError,
  ): void {
    const detail = this.record(error.detail);
    this.rememberStatus({
      connected: false,
      installationId: input.installationId,
      displayName: input.displayName,
      failureCode: error.code,
      failureMessage: error.message,
      failureStage:
        typeof detail.stage === 'string' ? detail.stage : undefined,
      pid:
        Number.isInteger(Number(detail.pid)) && Number(detail.pid) > 0
          ? Number(detail.pid)
          : null,
      stderrSummary:
        typeof detail.stderrSummary === 'string'
          ? detail.stderrSummary
          : null,
      updatedAt: new Date().toISOString(),
    });
  }

  private rememberStatus(status: RecentStatus): void {
    this.recentStatuses.delete(status.installationId);
    this.recentStatuses.set(status.installationId, status);
    while (this.recentStatuses.size > MAX_RECENT_STATUSES) {
      const oldest = this.recentStatuses.keys().next().value as
        | string
        | undefined;
      if (!oldest) break;
      this.recentStatuses.delete(oldest);
    }
  }

  private optionalRequestId(value: unknown): string | null {
    const requestId = String(value ?? '').trim();
    if (!requestId) return null;
    if (requestId.length > 300 || /[\r\n\0]/.test(requestId)) {
      throw this.error('MCP_REQUEST_ID_INVALID', 'Invalid MCP request id.');
    }
    return requestId;
  }

  private timeout(value: unknown): number {
    const parsed = Number(value ?? 60_000);
    return Number.isFinite(parsed)
      ? Math.min(300_000, Math.max(1_000, parsed))
      : 60_000;
  }

  private required(value: unknown, code: string, maximum: number): string {
    const text = String(value ?? '').trim();
    if (!text || text.length > maximum) throw this.error(code, code);
    return text;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private extraAllowedRoots(): string[] {
    return String(process.env.SEEKMORE_MCP_ALLOWED_ROOTS ?? '')
      .split(path.delimiter)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private isInside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
      relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative))
    );
  }

  private safeErrorMessage(error: unknown): string {
    return this.stderrSummary(
      error instanceof Error ? error.message : String(error),
    ) ?? 'Unknown MCP error.';
  }

  private log(stage: string, fields: Record<string, unknown>): void {
                                                       
  }

  private warn(stage: string, fields: Record<string, unknown>): void {
    console.warn(`[DesktopMcp] stage=${stage}`, fields);
  }

  private error(
    code: string,
    message: string,
    detail?: Record<string, unknown>,
  ): McpHostError {
    return Object.assign(new Error(message), {
      code,
      ...(detail ? { detail } : {}),
    });
  }
}