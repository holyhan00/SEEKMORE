// backend/src/modules/mcp/runtime/mcp-installation-runtime.service.ts
import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';
import { McpSecretCipherService } from '../application/mcp-secret-cipher.service';
import { McpOAuthFlowService } from '../auth/oauth/mcp-oauth-flow.service';
import { BuiltinMcpCatalogService } from '../catalog/builtin-mcp-catalog.service';
import type { JsonObject } from '../domain/json.types';
import type {
  McpCapabilityDiscovery,
  McpInvokeOutput,
  McpRuntimeConfig,
} from '../domain/mcp-runtime.types';
import { MCP_AUDIT_SINK, MCP_RUNTIME_CONFIG } from '../mcp-runtime.tokens';
import type { McpAuditSink } from '../observability/mcp-audit.sink';
import { McpToolResultNormalizerService } from './mcp-tool-result-normalizer.service';
import { McpBackendStdioHostService } from './mcp-backend-stdio-host.service';
import { McpDesktopBridgeService } from './mcp-desktop-bridge.service';
import { McpRemoteClientService } from './mcp-remote-client.service';

@Injectable()
export class McpInstallationRuntimeService {
  private readonly db: any;
  private readonly activeConnections = new Map<string, Promise<void>>();
  private readonly restoreAttempts = new Map<string, number>();

  constructor(
    prisma: PrismaService,
    private readonly cipher: McpSecretCipherService,
    private readonly catalog: BuiltinMcpCatalogService,
    private readonly oauth: McpOAuthFlowService,
    private readonly remote: McpRemoteClientService,
    private readonly backendStdio: McpBackendStdioHostService,
    private readonly desktop: McpDesktopBridgeService,
    private readonly normalizer: McpToolResultNormalizerService,
    private readonly trace: RuntimeFlowTraceLogger,
    @Inject(MCP_RUNTIME_CONFIG)
    private readonly config: McpRuntimeConfig,
    @Inject(MCP_AUDIT_SINK)
    private readonly audit: McpAuditSink,
  ) {
    this.db = prisma as any;
  }

  async startConnect(
    userId: string,
    installationId: string,
    reconnect = false,
    options: { allowDesktopSetup?: boolean } = {},
  ): Promise<{ status: 'connecting'; installationId: string }> {
    const key = `${userId}:${installationId}`;
    if (this.activeConnections.has(key)) {
      return { status: 'connecting', installationId };
    }

    await this.markConnecting(userId, installationId);
    const task = (reconnect
      ? this.reconnect(userId, installationId, {
          prepared: true,
          allowDesktopSetup: options.allowDesktopSetup === true,
        })
      : this.connect(userId, installationId, {
          prepared: true,
          allowDesktopSetup: options.allowDesktopSetup === true,
        }))
      .then(() => undefined)
      .catch((error) => {
        this.trace.warn('mcp.installation.background_connect_failed', {
          userId,
          installationId,
          error: error instanceof Error ? error.message : String(error),
          code:
            error && typeof error === 'object' && 'code' in error
              ? String((error as { code?: unknown }).code ?? '') || null
              : null,
        });
      })
      .finally(() => {
        this.activeConnections.delete(key);
      });

    this.activeConnections.set(key, task);
    return { status: 'connecting', installationId };
  }

  async markConnecting(userId: string, installationId: string): Promise<void> {
    const installation = await this.mustOwnInstallation(
      userId,
      installationId,
      true,
    );
    if (!installation.enabled) {
      throw new BadRequestException('MCP_INSTALLATION_DISABLED');
    }
    if (!(await this.mcpGloballyEnabled(userId))) {
      throw new BadRequestException('MCP_GLOBALLY_DISABLED');
    }
    if (installation.configurationState !== 'ready') {
      throw new BadRequestException('MCP_CONFIGURATION_REQUIRED');
    }
    await this.markConnection(installation, 'connecting');
  }

  async connect(
    userId: string,
    installationId: string,
    options: { prepared?: boolean; allowDesktopSetup?: boolean } = {},
  ) {
    this.assertEnabled();
    const startedAt = Date.now();
    const traceId = `mcp-installation-${installationId}-${startedAt}`;
    const installation = await this.mustOwnInstallation(
      userId,
      installationId,
      true,
    );
    const server = installation.server;

    if (!installation.enabled) {
      throw new BadRequestException('MCP_INSTALLATION_DISABLED');
    }
    if (!(await this.mcpGloballyEnabled(userId))) {
      throw new BadRequestException('MCP_GLOBALLY_DISABLED');
    }

    this.trace.event('mcp.installation.connect_started', {
      trace: traceId,
      userId,
      installationId,
      serverId: installation.serverId,
      stableKey: server.stableKey ?? null,
      transport: server.transport,
      managedRuntime: server.managedRuntime,
      timeoutMs: server.timeoutMs ?? this.config.defaultTimeoutMs,
    });

    if (installation.configurationState !== 'ready') {
      this.trace.warn('mcp.installation.connect_rejected', {
        trace: traceId,
        userId,
        installationId,
        serverId: installation.serverId,
        reason: 'configuration_required',
      });
      throw new BadRequestException('MCP_CONFIGURATION_REQUIRED');
    }

    if (!options.prepared) {
      await this.markConnection(installation, 'connecting');
    }

    let discovery: McpCapabilityDiscovery | null = null;

    try {
      if (server.transport === 'stdio') {
        const builtinDefinition =
          server.source === 'SYSTEM' &&
          server.reviewStatus === 'approved' &&
          server.stableKey
            ? await this.catalog.findByStableKey(server.stableKey)
            : null;

        if (server.managedRuntime === 'DESKTOP') {
          const desktopSetup = builtinDefinition?.desktopSetup ?? null;
          const allowDesktopSetup = options.allowDesktopSetup === true;
          if (desktopSetup && !allowDesktopSetup) {
            const applicationReady = await this.desktopApplicationReady(desktopSetup);
            if (!applicationReady) {
              throw Object.assign(
                new Error('Required desktop application is not running.'),
                {
                  code: 'MCP_REQUIRED_APPLICATION_NOT_RUNNING',
                  detail: { stage: 'desktop_readiness' },
                },
              );
            }
          }

          this.trace.event('mcp.installation.desktop_connect_requested', {
            trace: traceId,
            userId,
            installationId,
            serverId: installation.serverId,
            stableKey: server.stableKey ?? null,
          });

          const desktopConnection = await this.desktop.invoke<{
            connected?: boolean;
            protocolEra?: string | null;
            protocolVersion?: string | null;
            pid?: number | null;
            toolCount?: number;
            resourceCount?: number;
            promptCount?: number;
            connectedAt?: string;
            setup?: Record<string, unknown> | null;
            tools?: Record<string, unknown>[];
            resources?: Record<string, unknown>[];
            prompts?: Record<string, unknown>[];
            serverInfo?: Record<string, unknown> | null;
            capabilities?: Record<string, unknown>;
            instructions?: string | null;
          }>('mcp_connect', {
            installationId,
            displayName: server.displayName ?? server.name,
            command: server.command,
            args: server.args ?? [],
            workingDirectory: server.workingDirectory,
            timeoutMs: server.timeoutMs ?? this.config.defaultTimeoutMs,
            protocolPreference: server.protocolPreference ?? 'legacy',
            secretRef: installation.credential?.secretRef ?? null,
            environment:
              server.source === 'SYSTEM' && server.reviewStatus === 'approved'
                ? this.stringRecord(server.env)
                : {},
            desktopSetup: allowDesktopSetup ? desktopSetup : null,
            bridgeTimeoutMs: this.desktopConnectBridgeTimeout(
              server.timeoutMs ?? this.config.defaultTimeoutMs,
              allowDesktopSetup
                ? Number(desktopSetup?.setupTimeoutMs ?? 0)
                : 0,
            ),
          });

          discovery = {
            connection: {
              protocolEra:
                String(desktopConnection?.protocolEra ?? '').trim() || null,
              protocolVersion:
                String(desktopConnection?.protocolVersion ?? '').trim() || null,
              serverInfo: this.nullableRecord(desktopConnection?.serverInfo),
              capabilities: this.record(desktopConnection?.capabilities),
              instructions:
                typeof desktopConnection?.instructions === 'string'
                  ? desktopConnection.instructions
                  : null,
            },
            tools: Array.isArray(desktopConnection?.tools)
              ? desktopConnection.tools
              : [],
            resources: Array.isArray(desktopConnection?.resources)
              ? desktopConnection.resources
              : [],
            prompts: Array.isArray(desktopConnection?.prompts)
              ? desktopConnection.prompts
              : [],
          };

          this.trace.event('mcp.installation.desktop_connected', {
            trace: traceId,
            userId,
            installationId,
            serverId: installation.serverId,
            stableKey: server.stableKey ?? null,
            pid: desktopConnection?.pid ?? null,
            protocolEra: discovery.connection.protocolEra,
            protocolVersion: discovery.connection.protocolVersion,
            desktopToolCount: desktopConnection?.toolCount ?? null,
            desktopResourceCount: desktopConnection?.resourceCount ?? null,
            desktopPromptCount: desktopConnection?.promptCount ?? null,
            durationMs: Date.now() - startedAt,
          });
        } else if (server.managedRuntime === 'BACKEND_INTERNAL') {
          this.trace.event('mcp.installation.backend_stdio_connect_requested', {
            trace: traceId,
            userId,
            installationId,
            serverId: installation.serverId,
            stableKey: server.stableKey ?? null,
          });

          const backendConnection = await this.backendStdio.connect({
            installationId,
            server,
            timeoutMs: server.timeoutMs ?? this.config.defaultTimeoutMs,
            onCapabilitiesChanged: async (changed) => {
              await this.syncToolSnapshots(installation, changed.tools);
              this.trace.event('mcp.installation.capabilities_changed', {
                trace: traceId,
                userId,
                installationId,
                serverId: installation.serverId,
                toolCount: changed.tools.length,
                resourceCount: changed.resources.length,
                promptCount: changed.prompts.length,
              });
            },
          });

          this.trace.event('mcp.installation.backend_stdio_connected', {
            trace: traceId,
            userId,
            installationId,
            serverId: installation.serverId,
            stableKey: server.stableKey ?? null,
            protocolEra: backendConnection.protocolEra,
            protocolVersion: backendConnection.protocolVersion,
            durationMs: Date.now() - startedAt,
          });
        } else {
          throw new BadRequestException('MCP_STDIO_RUNTIME_UNSUPPORTED');
        }
      } else {
        const credentials = server.authKind === 'oauth2'
          ? {}
          : await this.credentialValues(installation);
        let authorizationHeaders = server.authKind === 'oauth2'
          ? await this.oauth.authorizationHeaders(installation)
          : {};

        this.trace.event('mcp.installation.remote_connect_requested', {
          trace: traceId,
          userId,
          installationId,
          serverId: installation.serverId,
          stableKey: server.stableKey ?? null,
        });

        let remoteConnection;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            remoteConnection = await this.remote.connect({
              installationId,
              endpoint: String(server.endpoint ?? ''),
              headers: {
                ...this.headers(server, credentials),
                ...authorizationHeaders,
              },
              allowedDomains: server.allowedDomains ?? [],
              deniedDomains: server.deniedDomains ?? [],
              timeoutMs: server.timeoutMs ?? this.config.defaultTimeoutMs,
              protocolPreference: server.protocolPreference ?? 'legacy',
              onCapabilitiesChanged: async (changed) => {
                await this.syncToolSnapshots(installation, changed.tools);
                this.trace.event('mcp.installation.capabilities_changed', {
                  trace: traceId,
                  userId,
                  installationId,
                  serverId: installation.serverId,
                  toolCount: changed.tools.length,
                  resourceCount: changed.resources.length,
                  promptCount: changed.prompts.length,
                });
              },
            });
            break;
          } catch (error) {
            const recovered = attempt === 0
              ? await this.oauth.recoverFromRemoteAuthorizationError(
                  installation,
                  error,
                )
              : false;
            if (!recovered) throw error;
            authorizationHeaders = await this.oauth.authorizationHeaders(
              installation,
            );
          }
        }
        if (!remoteConnection) {
          throw new ServiceUnavailableException('MCP_REMOTE_CONNECT_FAILED');
        }

        this.trace.event('mcp.installation.remote_connected', {
          trace: traceId,
          userId,
          installationId,
          serverId: installation.serverId,
          stableKey: server.stableKey ?? null,
          protocolEra: remoteConnection.protocolEra,
          protocolVersion: remoteConnection.protocolVersion,
          durationMs: Date.now() - startedAt,
        });
      }

      this.trace.event('mcp.installation.capability_discovery_started', {
        trace: traceId,
        userId,
        installationId,
        serverId: installation.serverId,
        transport: server.transport,
      });

      discovery ??= await this.discoverTransportCapabilities(
        installation,
        server.timeoutMs ?? this.config.defaultTimeoutMs,
      );

      await this.syncToolSnapshots(installation, discovery.tools);
      await this.markConnection(
        installation,
        'connected',
        undefined,
        undefined,
        discovery.connection.protocolEra,
        discovery.connection.protocolVersion,
      );

      const tools = await this.listTools(userId, installationId);

      const connectedServerName = this.detailString(
        discovery.connection.serverInfo,
        'name',
      );
      const connectedServerVersion = this.detailString(
        discovery.connection.serverInfo,
        'version',
      );
      const auditMetadata: JsonObject = {
        installationId,
        transport: server.transport,
        managedRuntime: server.managedRuntime,
        protocolEra: discovery.connection.protocolEra,
        protocolVersion: discovery.connection.protocolVersion,
        serverName: connectedServerName,
        serverVersion: connectedServerVersion,
        capabilityKinds: Object.keys(discovery.connection.capabilities).sort(),
        hasInstructions: Boolean(discovery.connection.instructions),
        toolCount: tools.length,
        resourceCount: discovery.resources.length,
        promptCount: discovery.prompts.length,
        durationMs: Date.now() - startedAt,
      };

      this.trace.event('mcp.installation.connected', {
        trace: traceId,
        userId,
        installationId,
        serverId: installation.serverId,
        stableKey: server.stableKey ?? null,
        protocolEra: discovery.connection.protocolEra,
        protocolVersion: discovery.connection.protocolVersion,
        serverName: connectedServerName,
        serverVersion: connectedServerVersion,
        capabilityKinds: Object.keys(
          discovery.connection.capabilities,
        )
          .sort()
          .join(','),
        hasInstructions: Boolean(discovery.connection.instructions),
        toolCount: tools.length,
        resourceCount: discovery.resources.length,
        promptCount: discovery.prompts.length,
        durationMs: Date.now() - startedAt,
      });
      await this.writeAudit({
        eventType: 'mcp.connection.connected',
        userId,
        serverId: installation.serverId,
        traceId,
        metadata: auditMetadata,
      });

      return {
        connected: true,
        protocolEra: discovery.connection.protocolEra,
        protocolVersion: discovery.connection.protocolVersion,
        serverName: this.detailString(
          discovery.connection.serverInfo,
          'name',
        ),
        serverVersion: this.detailString(
          discovery.connection.serverInfo,
          'version',
        ),
        capabilityKinds: Object.keys(
          discovery.connection.capabilities,
        )
          .sort()
          .join(','),
        hasInstructions: Boolean(discovery.connection.instructions),
        toolCount: tools.length,
        resourceCount: discovery.resources.length,
        promptCount: discovery.prompts.length,
      };
    } catch (error) {
      await this.disconnectTransport(installation).catch(() => undefined);

      await this.db.mcpToolSnapshot.updateMany({
        where: { installationId },
        data: { status: 'unavailable' },
      });

      const failureCode = this.errorCode(error, 'MCP_CONNECTION_FAILED');
      const failureMessage = this.errorMessage(error);
      const detail = this.errorDetail(error);

      const disconnectedCondition = [
        'MCP_OAUTH_AUTHORIZATION_REQUIRED',
        'MCP_OAUTH_SESSION_EXPIRED',
        'MCP_OAUTH_STEP_UP_REQUIRED',
        'MCP_REQUIRED_APPLICATION_NOT_RUNNING',
      ].includes(failureCode);
      await this.markConnection(
        installation,
        disconnectedCondition ? 'disconnected' : 'failed',
        failureCode,
        failureMessage,
      );

      this.trace.warn('mcp.installation.connect_failed', {
        trace: traceId,
        userId,
        installationId,
        serverId: installation.serverId,
        stableKey: server.stableKey ?? null,
        transport: server.transport,
        managedRuntime: server.managedRuntime,
        failureCode,
        failureStage: this.detailString(detail, 'stage'),
        pid: this.detailNumber(detail, 'pid'),
        stderrSummary: this.detailString(detail, 'stderrSummary'),
        durationMs: Date.now() - startedAt,
        error: failureMessage,
      });
      await this.writeAudit({
        eventType: 'mcp.connection.failed',
        userId,
        serverId: installation.serverId,
        traceId,
        severity: 'error',
        code: failureCode,
        message: failureMessage,
        metadata: {
          installationId,
          transport: server.transport,
          managedRuntime: server.managedRuntime,
          failureStage: this.detailString(detail, 'stage'),
          pid: this.detailNumber(detail, 'pid'),
          durationMs: Date.now() - startedAt,
        },
      });

      throw error;
    }
  }

  async disconnectInstallation(installationId: string): Promise<void> {
    const installation = await this.db.mcpInstallation.findUnique({
      where: { id: installationId },
      include: { server: true },
    });
    if (!installation) return;
    await this.disconnectTransport(installation);
  }

  async disconnect(userId: string, installationId: string) {
    const installation = await this.mustOwnInstallation(
      userId,
      installationId,
      true,
    );
    await this.disconnectTransport(installation).catch(() => undefined);
    await this.db.mcpToolSnapshot.updateMany({
      where: { installationId },
      data: { status: 'unavailable' },
    });
    await this.markConnection(installation, 'disconnected');
    await this.writeAudit({
      eventType: 'mcp.connection.disconnected',
      userId,
      serverId: installation.serverId,
      metadata: {
        installationId,
        transport: installation.server.transport,
        managedRuntime: installation.server.managedRuntime,
      },
    });
    return { disconnected: true };
  }

  async reconnect(
    userId: string,
    installationId: string,
    options: { prepared?: boolean; allowDesktopSetup?: boolean } = {},
  ) {
    const installation = await this.mustOwnInstallation(
      userId,
      installationId,
      true,
    );
    await this.disconnectTransport(installation).catch(() => undefined);
    await this.db.mcpToolSnapshot.updateMany({
      where: { installationId },
      data: { status: 'unavailable' },
    });
    if (!options.prepared) {
      await this.markConnection(installation, 'connecting');
    }
    return this.connect(userId, installationId, {
      prepared: true,
      allowDesktopSetup: options.allowDesktopSetup === true,
    });
  }

  async refreshTools(userId: string, installationId: string) {
    const installation = await this.mustOwnInstallation(userId, installationId, true);
    const state = await this.latestState(installationId);
    if (state?.status !== 'connected') throw new BadRequestException('MCP_NOT_CONNECTED');
    const discovery = await this.discoverTransportCapabilities(
      installation,
      installation.server.timeoutMs ?? this.config.defaultTimeoutMs,
    );
    await this.syncToolSnapshots(installation, discovery.tools);
    return this.listTools(userId, installationId);
  }


  async reconcileConnections(userId: string, installationIds?: string[]): Promise<void> {
    const selected = installationIds
      ? [...new Set(installationIds.map(String).filter(Boolean))]
      : null;
    const installations = await this.db.mcpInstallation.findMany({
      where: {
        userId,
        enabled: true,
        status: 'installed',
        removedAt: null,
        ...(selected ? { id: { in: selected } } : {}),
        connectionStates: { some: { status: 'connected' } },
      },
      include: { server: true },
    });
    await Promise.allSettled(installations.map(async (installation: any) => {
      const connected = await this.transportConnected(installation);
      if (connected) return;
      await this.db.mcpToolSnapshot.updateMany({
        where: { installationId: installation.id },
        data: { status: 'unavailable' },
      });
      await this.markConnection(installation, 'disconnected');
    }));
  }

  async restoreEnabledConnections(
    userId: string,
    force = false,
  ): Promise<void> {
    if (!(await this.mcpGloballyEnabled(userId))) return;

    const now = Date.now();
    const lastAttempt = this.restoreAttempts.get(userId) ?? 0;
    if (!force && now - lastAttempt < 15_000) return;
    this.restoreAttempts.set(userId, now);

    await this.reconcileConnections(userId);
    const installations = await this.db.mcpInstallation.findMany({
      where: {
        userId,
        enabled: true,
        status: 'installed',
        removedAt: null,
        configurationState: 'ready',
        server: {
          status: 'enabled',
          OR: [
            { source: 'SYSTEM', visibility: 'PUBLIC', reviewStatus: 'approved' },
            { source: 'USER', ownerUserId: userId },
          ],
        },
      },
      include: {
        server: true,
        connectionStates: { orderBy: { updatedAt: 'desc' }, take: 1 },
      },
    });

    await Promise.allSettled(installations.map(async (installation: any) => {
      const state = installation.connectionStates?.[0];
      if (state?.status === 'connected' || state?.status === 'connecting') return;
      if (!(await this.canSilentlyRestore(installation))) {
        this.trace.event('mcp.installation.restore_skipped', {
          userId,
          installationId: installation.id,
          serverId: installation.serverId,
          stableKey: installation.server?.stableKey ?? null,
          reason: 'required_application_not_running',
        });
        return;
      }
      await this.startConnect(
        userId,
        installation.id,
        state?.status === 'failed',
      );
    }));
  }

  async synchronizePendingChanges(
    userId: string,
    installationIds?: string[],
  ): Promise<void> {
    const selected = installationIds
      ? [...new Set(installationIds.map(String).filter(Boolean))]
      : null;
    if (selected && selected.length === 0) return;
    await this.reconcileConnections(userId, selected ?? undefined);
    const installations = await this.db.mcpInstallation.findMany({
      where: {
        ...(selected ? { id: { in: selected } } : {}),
        userId,
        enabled: true,
        status: 'installed',
        removedAt: null,
        configurationState: 'ready',
        server: { transport: 'stdio', managedRuntime: 'DESKTOP' },
        connectionStates: { some: { status: 'connected' } },
      },
      include: { server: true },
    });
    await Promise.allSettled(installations.map(async (installation: any) => {
      const event = await this.desktop.invoke<{ changed?: boolean; tools?: Record<string, unknown>[] }>(
        'mcp_consume_tool_changes',
        { installationId: installation.id },
      );
      if (event.changed === true && Array.isArray(event.tools)) {
        await this.syncToolSnapshots(installation, event.tools);
      }
    }));
  }

  async listTools(userId: string, installationId: string) {
    await this.mustOwnInstallation(userId, installationId);
    return this.db.mcpToolSnapshot.findMany({
      where: { installationId },
      select: {
        id: true,
        runtimeToolId: true,
        toolName: true,
        title: true,
        description: true,
        inputSchema: true,
        outputSchema: true,
        annotations: true,
        status: true,
        discoveredAt: true,
      },
      orderBy: { toolName: 'asc' },
    });
  }

  async invoke(input: {
    userId: string;
    agentId?: string;
    installationId: string;
    runtimeToolId: string;
    arguments: Record<string, unknown>;
    traceId?: string;
    conversationId?: string;
    turnId?: string;
    workflowId?: string;
    stepId?: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<McpInvokeOutput> {
    if (!(await this.mcpGloballyEnabled(input.userId))) {
      throw new NotFoundException('MCP_TOOL_NOT_AVAILABLE');
    }
    const snapshot = await this.db.mcpToolSnapshot.findFirst({
      where: {
        runtimeToolId: input.runtimeToolId,
        installationId: input.installationId,
        status: 'available',
        installation: {
          userId: input.userId,
          enabled: true,
          status: 'installed',
          removedAt: null,
          configurationState: 'ready',
          connectionStates: { some: { status: 'connected' } },
          server: {
            status: 'enabled',
            OR: [
              { source: 'SYSTEM', visibility: 'PUBLIC', reviewStatus: 'approved' },
              { source: 'USER', ownerUserId: input.userId },
            ],
          },
        },
      },
      include: {
        installation: {
          include: {
            server: true,
          },
        },
      },
    });
    if (!snapshot || !this.toolAllowed(snapshot)) {
      throw new NotFoundException('MCP_TOOL_NOT_AVAILABLE');
    }
    const invocation = await this.db.mcpToolInvocation.create({
      data: {
        runtimeToolId: snapshot.runtimeToolId,
        serverId: snapshot.serverId,
        installationId: input.installationId,
        toolSnapshotId: snapshot.id,
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        workflowId: input.workflowId,
        stepId: input.stepId,
        requestId: input.requestId,
        traceId: input.traceId,
        status: 'started',
        arguments: input.arguments,
      },
    });
    try {
      const timeoutMs = snapshot.installation.server.timeoutMs ?? this.config.defaultTimeoutMs;
      const requestId = input.requestId ?? `mcp_call_${randomUUID()}`;
      await this.ensureTransportConnected(snapshot.installation);
      const raw = await this.callTransportToolWithOAuthRecovery({
        installation: snapshot.installation,
        name: snapshot.toolName,
        arguments: input.arguments,
        timeoutMs,
        requestId,
        signal: input.signal,
      });
      const normalized = this.normalizer.normalize(raw);
      await this.db.mcpToolInvocation.update({
        where: { id: invocation.id },
        data: {
          status: normalized.isError ? 'failed' : 'succeeded',
          result: normalized,
          finishedAt: new Date(),
        },
      });
      return {
        invocationId: invocation.id,
        runtimeToolId: snapshot.runtimeToolId,
        result: normalized,
      };
    } catch (error) {
      await this.db.mcpToolInvocation.update({
        where: { id: invocation.id },
        data: {
          status: input.signal?.aborted ? 'cancelled' : 'failed',
          errorCode: String((error as any)?.code ?? 'MCP_TOOL_CALL_FAILED'),
          errorMessage: error instanceof Error ? error.message : String(error),
          finishedAt: new Date(),
        },
      });
      throw error;
    }
  }



  private async disconnectTransport(installation: any): Promise<void> {
    if (installation.server.transport !== 'stdio') {
      await this.remote.disconnect(installation.id);
      return;
    }
    if (installation.server.managedRuntime === 'DESKTOP') {
      await this.desktop.invoke('mcp_disconnect', {
        installationId: installation.id,
      });
      return;
    }
    if (installation.server.managedRuntime === 'BACKEND_INTERNAL') {
      await this.backendStdio.disconnect(installation.id);
      return;
    }
    throw new BadRequestException('MCP_STDIO_RUNTIME_UNSUPPORTED');
  }

  private async discoverTransportCapabilities(
    installation: any,
    timeoutMs: number,
  ): Promise<McpCapabilityDiscovery> {
    if (installation.server.transport !== 'stdio') {
      return this.remote.discover(installation.id, timeoutMs);
    }
    if (installation.server.managedRuntime === 'DESKTOP') {
      return this.desktop.invoke<McpCapabilityDiscovery>('mcp_discover', {
        installationId: installation.id,
        timeoutMs,
      });
    }
    if (installation.server.managedRuntime === 'BACKEND_INTERNAL') {
      return this.backendStdio.discover(installation.id, timeoutMs);
    }
    throw new BadRequestException('MCP_STDIO_RUNTIME_UNSUPPORTED');
  }

  private async transportConnected(installation: any): Promise<boolean> {
    if (installation.server.transport !== 'stdio') {
      return this.remote.isConnected(installation.id);
    }
    if (installation.server.managedRuntime === 'DESKTOP') {
      return this.desktop
        .invoke<{ connected?: boolean }>('mcp_status', {
          installationId: installation.id,
        })
        .then((value) => value.connected === true)
        .catch(() => false);
    }
    if (installation.server.managedRuntime === 'BACKEND_INTERNAL') {
      return this.backendStdio.isConnected(installation.id);
    }
    return false;
  }

  private async ensureTransportConnected(installation: any): Promise<void> {
    const connected = await this.transportConnected(installation);
    if (connected) {
      if (
        installation.server.transport !== 'stdio'
        && installation.server.authKind === 'oauth2'
      ) {
        const headers = await this.oauth.authorizationHeaders(installation);
        if (this.remote.usesHeaders(installation.id, headers)) return;
        await this.remote.disconnect(installation.id);
      } else {
        return;
      }
    }
    await this.markConnection(installation, 'disconnected');
    await this.connect(installation.userId, installation.id);
  }

  private async callTransportToolWithOAuthRecovery(input: {
    installation: any;
    name: string;
    arguments: Record<string, unknown>;
    timeoutMs: number;
    requestId: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    try {
      return await this.callTransportTool(input);
    } catch (error) {
      const installation = input.installation;
      if (
        installation.server.transport === 'stdio' ||
        installation.server.authKind !== 'oauth2'
      ) {
        throw error;
      }
      const recovered = await this.oauth.recoverFromRemoteAuthorizationError(
        installation,
        error,
      );
      if (!recovered) throw error;

      await this.remote.disconnect(installation.id).catch(() => undefined);
      await this.ensureTransportConnected(installation);
      return this.callTransportTool(input);
    }
  }

  private async callTransportTool(input: {
    installation: any;
    name: string;
    arguments: Record<string, unknown>;
    timeoutMs: number;
    requestId: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const installation = input.installation;
    if (installation.server.transport !== 'stdio') {
      return this.remote.callTool(
        installation.id,
        input.name,
        input.arguments,
        input.timeoutMs,
        input.signal,
      );
    }
    if (installation.server.managedRuntime === 'DESKTOP') {
      return this.invokeDesktopTool({
        installationId: installation.id,
        name: input.name,
        arguments: input.arguments,
        timeoutMs: input.timeoutMs,
        requestId: input.requestId,
        signal: input.signal,
      });
    }
    if (installation.server.managedRuntime === 'BACKEND_INTERNAL') {
      return this.backendStdio.callTool(
        installation.id,
        input.name,
        input.arguments,
        input.timeoutMs,
        input.signal,
      );
    }
    throw new BadRequestException('MCP_STDIO_RUNTIME_UNSUPPORTED');
  }

  private async invokeDesktopTool(input: {
    installationId: string;
    name: string;
    arguments: Record<string, unknown>;
    timeoutMs: number;
    requestId: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    if (input.signal?.aborted) {
      throw Object.assign(new Error('MCP_CALL_CANCELLED'), { code: 'MCP_CALL_CANCELLED' });
    }
    const onAbort = () => {
      void this.desktop.invoke('mcp_cancel_tool', { requestId: input.requestId }).catch(() => undefined);
    };
    input.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await this.desktop.invoke('mcp_call_tool', {
        installationId: input.installationId,
        name: input.name,
        arguments: input.arguments,
        timeoutMs: input.timeoutMs,
        requestId: input.requestId,
      });
    } finally {
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async syncToolSnapshots(installation: any, rawTools: Record<string, unknown>[]): Promise<void> {
    const installationId = installation.id;
    const discoveredNames = new Set<string>();
    for (const raw of rawTools) {
      const toolName = String(raw.name ?? '').trim();
      if (!toolName) continue;
      discoveredNames.add(toolName);
      const inputSchema = this.inputSchema(raw.inputSchema);
      const outputSchema = raw.outputSchema ? this.record(raw.outputSchema) : null;
      const annotations = raw.annotations ? this.record(raw.annotations) : null;
      const snapshotHash = createHash('sha256')
        .update(JSON.stringify({ toolName, inputSchema, outputSchema, annotations }))
        .digest('hex');
      const existing = await this.db.mcpToolSnapshot.findFirst({ where: { installationId, toolName } });
      const runtimeToolId = existing?.runtimeToolId ?? `rt_mcp_${randomUUID()}`;
      await this.db.mcpToolSnapshot.upsert({
        where: { runtimeToolId },
        create: {
          runtimeToolId,
          serverId: installation.serverId,
          installationId,
          serverName: installation.server.name,
          toolName,
          title: typeof raw.title === 'string' ? raw.title : null,
          description: typeof raw.description === 'string' ? raw.description : null,
          inputSchema,
          outputSchema,
          annotations,
          snapshotHash,
          status: 'available',
          discoveredAt: new Date(),
        },
        update: {
          title: typeof raw.title === 'string' ? raw.title : null,
          description: typeof raw.description === 'string' ? raw.description : null,
          inputSchema,
          outputSchema,
          annotations,
          snapshotHash,
          status: 'available',
          discoveredAt: new Date(),
        },
      });
    }
    const current = await this.db.mcpToolSnapshot.findMany({
      where: { installationId },
      select: { id: true, toolName: true },
    });
    const removed = current
      .filter((item: any) => !discoveredNames.has(item.toolName))
      .map((item: any) => item.id);
    if (removed.length > 0) {
      await this.db.mcpToolSnapshot.updateMany({
        where: { id: { in: removed } },
        data: { status: 'disabled' },
      });
    }
  }

  private async latestState(installationId: string) {
    return this.db.mcpConnectionState.findFirst({ where: { installationId }, orderBy: { updatedAt: 'desc' } });
  }

  private async markConnection(
    installation: any,
    status: string,
    failureCode?: string,
    failureMessage?: string,
    protocolEra?: string | null,
    protocolVersion?: string | null,
  ) {
    const identityHash = createHash('sha256').update(`installation:${installation.id}`).digest('hex');
    return this.db.mcpConnectionState.upsert({
      where: { identityHash },
      create: {
        identityHash,
        serverId: installation.serverId,
        installationId: installation.id,
        userId: installation.userId,
        scope: 'user',
        status,
        failureCode,
        failureMessage,
        protocolEra: protocolEra ?? null,
        protocolVersion: protocolVersion ?? null,
        lastConnectedAt: status === 'connected' ? new Date() : null,
        lastDisconnectedAt: status === 'disconnected' ? new Date() : null,
      },
      update: {
        status,
        failureCode: failureCode ?? null,
        failureMessage: failureMessage ?? null,
        protocolEra: protocolEra === undefined ? undefined : protocolEra,
        protocolVersion: protocolVersion === undefined ? undefined : protocolVersion,
        lastConnectedAt: status === 'connected' ? new Date() : undefined,
        lastDisconnectedAt: status === 'disconnected' ? new Date() : undefined,
        lastHealthCheckAt: new Date(),
      },
    });
  }

  private toolAllowed(snapshot: any): boolean {
    const serverAllowed = snapshot.installation.server.allowedToolNames ?? [];
    const serverDenied = snapshot.installation.server.deniedToolNames ?? [];
    if (serverDenied.includes(snapshot.toolName)) return false;
    if (serverAllowed.length > 0 && !serverAllowed.includes(snapshot.toolName)) return false;
    return true;
  }

  private async mustOwnInstallation(
    userId: string,
    installationId: string,
    includeServer = false,
  ): Promise<any> {
    const installation = await this.db.mcpInstallation.findFirst({
      where: {
        id: installationId,
        userId,
        status: 'installed',
        removedAt: null,
      },
      include: includeServer ? { server: true, credential: true } : undefined,
    });
    if (!installation) {
      throw new NotFoundException('MCP_INSTALLATION_NOT_FOUND');
    }
    return installation;
  }

  private async credentialValues(installation: any): Promise<Record<string, string>> {
    const credential =
      installation.credential ??
      (await this.db.mcpCredential.findUnique({
        where: { installationId: installation.id },
      }));
    if (!credential || credential.storageLocation !== 'BACKEND_ENCRYPTED') {
      return {};
    }
    return this.cipher.decrypt(credential);
  }

  private headers(server: any, credentials: Record<string, string>): Record<string, string> {
    if (server.authKind === 'none' || server.authKind === 'oauth2') return {};
    if (server.authKind === 'bearer') {
      const token = credentials.token ?? credentials.bearerToken ?? credentials.accessToken;
      if (!token) throw new BadRequestException('MCP_BEARER_TOKEN_REQUIRED');
      return { Authorization: `Bearer ${token}` };
    }
    if (server.authKind === 'api_key') {
      const keyName = String(server.authConfig?.headerName ?? 'X-API-Key');
      const value = credentials.apiKey ?? credentials[keyName];
      if (!value) throw new BadRequestException('MCP_API_KEY_REQUIRED');
      return { [keyName]: value };
    }
    if (server.authKind === 'custom_headers') return credentials;
    throw new BadRequestException('MCP_AUTH_KIND_NOT_IMPLEMENTED');
  }


  private async canSilentlyRestore(installation: any): Promise<boolean> {
    const server = installation?.server;
    if (server?.transport !== 'stdio' || server?.managedRuntime !== 'DESKTOP') {
      return true;
    }
    if (server.source !== 'SYSTEM' || server.reviewStatus !== 'approved' || !server.stableKey) {
      return true;
    }
    const definition = await this.catalog.findByStableKey(server.stableKey);
    const desktopSetup = definition?.desktopSetup ?? null;
    return desktopSetup
      ? this.desktopApplicationReady(desktopSetup)
      : true;
  }

  private async desktopApplicationReady(
    desktopSetup: Record<string, unknown>,
  ): Promise<boolean> {
    const readiness = this.record(desktopSetup.readiness);
    const host = String(readiness.host ?? '').trim();
    const port = Number(readiness.port);
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65_535) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const socket = createConnection({ host, port });
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(ready);
      };
      socket.setTimeout(500);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  private desktopConnectBridgeTimeout(
    runtimeTimeoutMs: number,
    setupTimeoutMs: number,
  ): number {
    const runtime = Math.min(300_000, Math.max(1_000, Number(runtimeTimeoutMs) || 30_000));
    const setup = Math.min(300_000, Math.max(0, Number(setupTimeoutMs) || 0));
    return Math.min(900_000, setup + runtime * 2 + 30_000);
  }

  private errorCode(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = String((error as { code?: unknown }).code ?? '').trim();
      if (code) return code;
    }
    return fallback;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  private errorDetail(error: unknown): Record<string, unknown> {
    if (!error || typeof error !== 'object' || !('detail' in error)) return {};
    return this.record((error as { detail?: unknown }).detail);
  }

  private detailString(
    detail: Record<string, unknown> | null | undefined,
    key: string,
  ): string | null {
    if (!detail) return null;
    const value = detail[key];
    if (typeof value !== 'string') return null;
    const clean = value.trim();
    return clean || null;
  }

  private detailNumber(
    detail: Record<string, unknown>,
    key: string,
  ): number | null {
    const value = Number(detail[key]);
    return Number.isFinite(value) ? value : null;
  }

  private inputSchema(value: unknown): Record<string, unknown> {
    const schema = this.record(value);
    return Object.keys(schema).length > 0
      ? schema
      : { type: 'object', properties: {}, additionalProperties: true };
  }

  private stringRecord(value: unknown): Record<string, string> {
    const row = this.record(value);
    return Object.fromEntries(
      Object.entries(row).map(([key, item]) => [key, String(item ?? '')]),
    );
  }

  private nullableRecord(value: unknown): Record<string, unknown> | null {
    const row = this.record(value);
    return Object.keys(row).length > 0 ? row : null;
  }

  private async mcpGloballyEnabled(userId: string): Promise<boolean> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { mcpGloballyEnabled: true },
    });
    return user?.mcpGloballyEnabled ?? true;
  }

  private writeAudit(input: {
    eventType: string;
    userId: string;
    serverId: string;
    traceId?: string;
    severity?: 'info' | 'warn' | 'error';
    code?: string;
    message?: string;
    metadata?: JsonObject;
  }): Promise<void> {
    return this.audit.write({
      eventType: input.eventType,
      userId: input.userId,
      serverId: input.serverId,
      traceId: input.traceId,
      severity: input.severity ?? 'info',
      code: input.code,
      message: input.message,
      metadata: input.metadata ?? {},
      occurredAt: new Date(),
    });
  }

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('MCP_RUNTIME_DISABLED');
    }
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }
}