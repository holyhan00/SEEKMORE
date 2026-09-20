// backend/src/modules/mcp/application/mcp-library.service.ts
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { JsonObject } from '../domain/json.types';
import { McpConfigImportService } from '../import/mcp-config-import.service';
import { BuiltinMcpCatalogService } from '../catalog/builtin-mcp-catalog.service';
import type { BuiltinMcpDefinition } from '../catalog/builtin-mcp-definition';
import {
  describeMcpConfiguration,
  resolveMcpInstallationActionState,
  type McpPresentationAvailability,
} from '../domain/mcp-installation-presentation';
import { MCP_AUDIT_SINK } from '../mcp-runtime.tokens';
import type { McpAuditSink } from '../observability/mcp-audit.sink';
import { McpDesktopBridgeService } from '../runtime/mcp-desktop-bridge.service';
import { McpInstallationRuntimeService } from '../runtime/mcp-installation-runtime.service';
import { McpRemoteUrlGuardService } from '../runtime/mcp-remote-url-guard.service';
import { McpSecretCipherService } from './mcp-secret-cipher.service';

export interface CreateMcpDefinitionInput {
  displayName: string;
  description?: string;
  transport: 'stdio' | 'streamable_http';
  endpoint?: string;
  command?: string;
  args?: string[];
  workingDirectory?: string;
  authKind?: 'none' | 'bearer' | 'api_key' | 'custom_headers' | 'environment' | 'oauth2';
  headers?: Record<string, string>;
  environment?: Record<string, string>;
  timeoutMs?: number;
}

const MAX_SECRET_ENTRIES = 64;
const MAX_SECRET_VALUE_BYTES = 16 * 1024;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const FORBIDDEN_REMOTE_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'mcp-session-id',
  'proxy-authorization',
  'proxy-authenticate',
]);

@Injectable()
export class McpLibraryService {
  private readonly db: any;

  constructor(
    prisma: PrismaService,
    private readonly imports: McpConfigImportService,
    private readonly catalog: BuiltinMcpCatalogService,
    private readonly cipher: McpSecretCipherService,
    private readonly desktop: McpDesktopBridgeService,
    private readonly urls: McpRemoteUrlGuardService,
    private readonly runtime: McpInstallationRuntimeService,
    @Inject(MCP_AUDIT_SINK)
    private readonly audit: McpAuditSink,
  ) {
    this.db = prisma as any;
  }

  async listDefinitions(userId: string) {
    const rows = await this.db.mcpServerConfig.findMany({
      where: {
        status: { not: 'archived' },
        OR: [
          { source: 'SYSTEM', visibility: 'PUBLIC', reviewStatus: 'approved' },
          { source: 'USER', ownerUserId: userId },
        ],
      },
      orderBy: [{ source: 'asc' }, { displayName: 'asc' }],
    });
    return rows.map((row: any) => this.definitionDto(row));
  }

  async getDefinition(userId: string, id: string) {
    const row = await this.mustAccessDefinition(userId, id);
    return this.definitionDto(row, true);
  }

  async createDefinition(userId: string, input: CreateMcpDefinitionInput, originType = 'FORM') {
    const normalized = await this.validateDefinitionInput(input);
    const baseKey = this.slug(normalized.displayName);
    const name = await this.uniqueName(userId, baseKey);
    const row = await this.db.mcpServerConfig.create({
      data: {
        name,
        source: 'USER',
        ownerUserId: userId,
        displayName: normalized.displayName,
        description: normalized.description,
        visibility: 'PRIVATE',
        reviewStatus: 'approved',
        originType,
        protocolPreference: 'legacy',
        managedRuntime: normalized.transport === 'stdio' ? 'DESKTOP' : 'REMOTE',
        transport: normalized.transport,
        status: 'enabled',
        trustLevel: 'workspace',
        scope: 'user',
        endpoint: normalized.endpoint,
        command: normalized.command,
        args: normalized.args ?? [],
        workingDirectory: normalized.workingDirectory,
        env: {},
        headers: {},
        authKind: normalized.authKind ?? 'none',
        authConfig: this.authConfig(normalized),
        timeoutMs: normalized.timeoutMs ?? 30_000,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.writeAudit('mcp.definition.created', userId, row.id, {
      source: 'USER',
      transport: normalized.transport,
      originType,
    });
    return this.definitionDto(row, true);
  }

  async updateDefinition(userId: string, id: string, input: Partial<CreateMcpDefinitionInput>) {
    const existing = await this.mustOwnDefinition(userId, id);
    const existingAuthConfig = this.record(existing.authConfig);
    const merged = await this.validateDefinitionInput({
      displayName: this.hasOwn(input, 'displayName') ? String(input.displayName ?? '') : existing.displayName ?? existing.name,
      description: this.hasOwn(input, 'description') ? input.description : existing.description ?? undefined,
      transport: this.hasOwn(input, 'transport') ? input.transport ?? existing.transport : existing.transport,
      endpoint: this.hasOwn(input, 'endpoint') ? input.endpoint : existing.endpoint ?? undefined,
      command: this.hasOwn(input, 'command') ? input.command : existing.command ?? undefined,
      args: this.hasOwn(input, 'args') ? input.args : existing.args ?? [],
      workingDirectory: this.hasOwn(input, 'workingDirectory') ? input.workingDirectory : existing.workingDirectory ?? undefined,
      authKind: input.authKind ?? existing.authKind,
      headers: input.headers ?? this.declaredRecord(existingAuthConfig.declaredHeaderKeys),
      environment: input.environment ?? this.declaredRecord(existingAuthConfig.declaredEnvironmentKeys),
      timeoutMs: input.timeoutMs ?? existing.timeoutMs ?? undefined,
    });
    const nextAuthConfig = this.authConfig(merged);
    const runtimeChanged = this.runtimeDefinitionChanged(existing, merged, nextAuthConfig);
    const credentialsChanged = String(existing.authKind ?? 'none') !== String(merged.authKind ?? 'none')
      || JSON.stringify(existingAuthConfig) !== JSON.stringify(nextAuthConfig)
      || existing.transport !== merged.transport;
    const installations = runtimeChanged
      ? await this.db.mcpInstallation.findMany({
          where: { serverId: id, status: 'installed', removedAt: null },
          include: { credential: true },
        })
      : [];
    if (runtimeChanged) {
      await Promise.allSettled(
        installations.map((installation: any) => this.runtime.disconnectInstallation(installation.id)),
      );
    }
    if (credentialsChanged) {
      await Promise.allSettled(
        installations
          .filter((installation: any) => installation.credential?.storageLocation === 'DESKTOP_SAFE_STORAGE')
          .map((installation: any) => this.desktop.invoke('mcp_delete_secret', { installationId: installation.id })),
      );
    }
    const row = await this.db.$transaction(async (tx: any) => {
      const updated = await tx.mcpServerConfig.update({
        where: { id },
        data: {
          displayName: merged.displayName,
          description: merged.description,
          transport: merged.transport,
          managedRuntime: merged.transport === 'stdio' ? 'DESKTOP' : 'REMOTE',
          endpoint: merged.endpoint,
          command: merged.command,
          args: merged.args ?? [],
          workingDirectory: merged.workingDirectory,
          authKind: merged.authKind ?? 'none',
          authConfig: nextAuthConfig,
          timeoutMs: merged.timeoutMs ?? 30_000,
          updatedBy: userId,
        },
      });
      if (runtimeChanged) {
        await tx.mcpToolSnapshot.updateMany({
          where: { serverId: id },
          data: { status: 'unavailable' },
        });
        await tx.mcpConnectionState.updateMany({
          where: { serverId: id },
          data: { status: 'disconnected', lastDisconnectedAt: new Date() },
        });
        await tx.mcpInstallation.updateMany({
          where: { serverId: id, status: 'installed', removedAt: null },
          data: {
            enabled: false,
            configurationState: merged.authKind === 'none'
              ? 'ready'
              : merged.authKind === 'oauth2'
                ? 'needs_authorization'
                : 'needs_configuration',
          },
        });
      }
      if (credentialsChanged) {
        await tx.mcpCredential.deleteMany({ where: { installation: { serverId: id } } });
        await tx.mcpAuthSession.deleteMany({ where: { serverId: id, userId } });
      }
      return updated;
    });
    await this.writeAudit('mcp.definition.updated', userId, row.id, {
      transport: merged.transport,
      runtimeChanged,
      credentialsChanged,
    });
    return this.definitionDto(row, true);
  }

  async deleteDefinition(userId: string, id: string) {
    const existing = await this.mustOwnDefinition(userId, id);
    const blockers = await Promise.all([
      this.db.skillMcpBinding.count({ where: { mcpServerId: id } }),
      this.db.mcpToolInvocation.count({ where: { serverId: id, status: 'started' } }),
    ]);
    if (blockers.some((count) => count > 0)) {
      throw new ConflictException('MCP_DEFINITION_IN_USE');
    }
    const installations = await this.db.mcpInstallation.findMany({ where: { serverId: id }, select: { id: true, credential: { select: { storageLocation: true } } } });
    await Promise.allSettled(installations.map((item: any) => this.runtime.disconnectInstallation(item.id)));
    await Promise.allSettled(installations
      .filter((item: any) => item.credential?.storageLocation === 'DESKTOP_SAFE_STORAGE')
      .map((item: any) => this.desktop.invoke('mcp_delete_secret', { installationId: item.id }))); 
    await this.db.mcpServerConfig.delete({ where: { id } });
    await this.writeAudit('mcp.definition.deleted', userId, id, {
      displayName: existing.displayName ?? existing.name,
    });
    return { deleted: true };
  }

  parseImport(payload: unknown) {
    return this.imports.parseClaudeDesktopJson(payload);
  }

  async commitImport(userId: string, payload: unknown) {
    const definitions = this.imports.parseClaudeDesktopJson(payload);

    return Promise.all(
      definitions.map((item) =>
        this.createDefinition(
          userId,
          {
            displayName: item.displayName,
            description: item.description,
            transport: item.transport,
            endpoint: item.endpoint,
            command: item.command,
            args: item.args,
            workingDirectory: item.workingDirectory,
            authKind: item.authKind,
            headers: Object.fromEntries(
              item.headerKeys.map((key) => [key, '']),
            ),
            environment: Object.fromEntries(
              item.envKeys.map((key) => [key, '']),
            ),
          },
          item.originType,
        ),
      ),
    );
  }

  async listInstallations(userId: string) {
    const rows = await this.db.mcpInstallation.findMany({
      where: { userId, status: 'installed', removedAt: null },
      include: {
        server: true,
        credential: { select: { kind: true, maskedHint: true, storageLocation: true } },
        connectionStates: { orderBy: { updatedAt: 'desc' }, take: 1 },
        toolSnapshots: { where: { status: 'available' }, select: { id: true } },
      },
      orderBy: { installedAt: 'desc' },
    });
    const catalogDefinitions = await this.catalog.loadDefinitions();
    const catalogByStableKey = new Map(
      catalogDefinitions.map((definition) => [definition.stableKey, definition]),
    );
    const oauthServerIds = rows
      .filter((row: any) => row.server.authKind === 'oauth2')
      .map((row: any) => row.serverId);
    const oauthSessions = oauthServerIds.length > 0
      ? await this.db.mcpAuthSession.findMany({
          where: {
            userId,
            agentId: '',
            serverId: { in: oauthServerIds },
          },
          orderBy: { updatedAt: 'desc' },
        })
      : [];
    const oauthByServerId = new Map<string, any>();
    for (const session of oauthSessions) {
      if (!oauthByServerId.has(session.serverId)) {
        oauthByServerId.set(session.serverId, session);
      }
    }
    return rows.map((row: any) =>
      this.installationDto(
        row,
        oauthByServerId.get(row.serverId),
        row.server.stableKey
          ? catalogByStableKey.get(row.server.stableKey)
          : undefined,
      ),
    );
  }

  async install(userId: string, serverId: string) {
    const server = await this.mustAccessDefinition(userId, serverId);
    const existing = await this.db.mcpInstallation.findUnique({
      where: { userId_serverId: { userId, serverId } },
      include: { credential: true },
    });
    const oauthSession = server.authKind === 'oauth2'
      ? await this.db.mcpAuthSession.findUnique({
          where: {
            serverId_tenantId_userId_agentId: {
              serverId,
              tenantId: '',
              userId,
              agentId: '',
            },
          },
        })
      : null;
    const oauthAuthorized = Boolean(
      oauthSession && oauthSession.status === 'active',
    );
    const needsConfiguration = server.authKind === 'oauth2'
      ? !oauthAuthorized
      : server.authKind !== 'none' && !existing?.credential;
    const configurationState = server.authKind === 'oauth2' && needsConfiguration
      ? 'needs_authorization'
      : needsConfiguration
        ? 'needs_configuration'
        : 'ready';
    const row = await this.db.mcpInstallation.upsert({
      where: { userId_serverId: { userId, serverId } },
      create: {
        userId,
        serverId,
        enabled: true,
        status: 'installed',
        configurationState,
        removedAt: null,
      },
      update: {
        enabled: true,
        status: 'installed',
        removedAt: null,
        configurationState,
      },
      include: { server: true, credential: true, connectionStates: { orderBy: { updatedAt: 'desc' }, take: 1 }, toolSnapshots: true },
    });
    await this.writeAudit('mcp.installation.installed', userId, serverId, {
      installationId: row.id,
      configurationState: row.configurationState,
    });
    const catalogDefinition = row.server.stableKey
      ? await this.catalog.findByStableKey(row.server.stableKey)
      : null;
    if (row.configurationState === 'ready' && await this.globalMcpEnabled(userId)) {
      await this.runtime.startConnect(userId, row.id, false, { allowDesktopSetup: true }).catch(() => undefined);
      const refreshed = await this.listInstallations(userId);
      return refreshed.find((item: any) => item.id === row.id)
        ?? this.installationDto(row, oauthSession, catalogDefinition ?? undefined);
    }
    return this.installationDto(row, oauthSession, catalogDefinition ?? undefined);
  }

  async uninstall(userId: string, installationId: string) {
    const installation = await this.mustOwnInstallation(userId, installationId, true);
    await this.runtime.disconnectInstallation(installationId).catch(() => undefined);
    if (installation.credential?.storageLocation === 'DESKTOP_SAFE_STORAGE') {
      await this.desktop.invoke('mcp_delete_secret', { installationId }).catch(() => undefined);
    }
    await this.db.$transaction([
      this.db.mcpToolSnapshot.updateMany({ where: { installationId }, data: { status: 'disabled' } }),
      this.db.mcpConnectionState.updateMany({ where: { installationId }, data: { status: 'disconnected', lastDisconnectedAt: new Date() } }),
      this.db.mcpCredential.deleteMany({ where: { installationId } }),
      this.db.mcpAuthSession.deleteMany({ where: { serverId: installation.serverId, userId } }),
      this.db.mcpInstallation.update({
        where: { id: installation.id },
        data: {
          enabled: false,
          status: 'uninstalled',
          configurationState: installation.server.authKind === 'none'
            ? 'ready'
            : installation.server.authKind === 'oauth2'
              ? 'needs_authorization'
              : 'needs_configuration',
          removedAt: new Date(),
        },
      }),
    ]);
    await this.writeAudit(
      'mcp.installation.uninstalled',
      userId,
      installation.serverId,
      { installationId },
    );
    return { uninstalled: true };
  }

  async setEnabled(userId: string, installationId: string, enabled: boolean) {
    const installation = await this.mustOwnInstallation(userId, installationId, true);
    const row = await this.db.mcpInstallation.update({
      where: { id: installationId },
      data: { enabled },
    });

    if (!enabled) {
      await this.runtime.disconnectInstallation(installationId).catch(() => undefined);
      await this.db.mcpToolSnapshot.updateMany({
        where: { installationId },
        data: { status: 'unavailable' },
      });
      await this.db.mcpConnectionState.updateMany({
        where: { installationId },
        data: { status: 'disconnected', lastDisconnectedAt: new Date() },
      });
    } else if (
      installation.configurationState === 'ready'
      && await this.globalMcpEnabled(userId)
    ) {
      const latestState = await this.db.mcpConnectionState.findFirst({
        where: { installationId },
        orderBy: { updatedAt: 'desc' },
      });
      await this.runtime.startConnect(
        userId,
        installationId,
        latestState?.status === 'failed',
      ).catch(() => undefined);
    }

    await this.writeAudit(
      enabled ? 'mcp.installation.enabled' : 'mcp.installation.disabled',
      userId,
      installation.serverId,
      { installationId },
    );
    return { id: row.id, enabled: row.enabled };
  }

  async configureCredential(userId: string, installationId: string, values: Record<string, string>) {
    const installation = await this.mustOwnInstallation(userId, installationId, true);
    if (installation.server.authKind === 'none' || installation.server.authKind === 'oauth2') {
      throw new BadRequestException('MCP_CREDENTIAL_NOT_REQUIRED');
    }
    const clean = this.validateCredentialValues(installation.server, values);
    await this.runtime.disconnectInstallation(installationId).catch(() => undefined);
    if (installation.server.transport === 'stdio') {
      const result = await this.desktop.invoke<{ secretRef: string }>('mcp_store_secret', {
        installationId,
        values: clean,
      });
      await this.db.mcpCredential.upsert({
        where: { installationId },
        create: {
          installationId,
          userId,
          kind: installation.server.authKind,
          storageLocation: 'DESKTOP_SAFE_STORAGE',
          secretRef: result.secretRef,
          maskedHint: this.maskedHint(clean),
        },
        update: {
          kind: installation.server.authKind,
          storageLocation: 'DESKTOP_SAFE_STORAGE',
          secretRef: result.secretRef,
          encryptedPayload: null,
          encryptionIv: null,
          authTag: null,
          maskedHint: this.maskedHint(clean),
        },
      });
    } else {
      const encrypted = this.cipher.encrypt(clean);
      await this.db.mcpCredential.upsert({
        where: { installationId },
        create: {
          installationId,
          userId,
          kind: installation.server.authKind,
          storageLocation: 'BACKEND_ENCRYPTED',
          ...encrypted,
          maskedHint: this.maskedHint(clean),
        },
        update: {
          kind: installation.server.authKind,
          storageLocation: 'BACKEND_ENCRYPTED',
          ...encrypted,
          secretRef: null,
          maskedHint: this.maskedHint(clean),
        },
      });
    }
    await this.db.$transaction([
      this.db.mcpInstallation.update({
        where: { id: installationId },
        data: { configurationState: 'ready' },
      }),
      this.db.mcpToolSnapshot.updateMany({
        where: { installationId },
        data: { status: 'unavailable' },
      }),
      this.db.mcpConnectionState.updateMany({
        where: { installationId },
        data: {
          status: 'disconnected',
          failureCode: null,
          failureMessage: null,
          lastDisconnectedAt: new Date(),
        },
      }),
    ]);
    await this.writeAudit(
      'mcp.credential.configured',
      userId,
      installation.serverId,
      {
        installationId,
        authKind: installation.server.authKind,
        storageLocation:
          installation.server.transport === 'stdio'
            ? 'DESKTOP_SAFE_STORAGE'
            : 'BACKEND_ENCRYPTED',
      },
    );
    const connectionStarted = installation.enabled
      && await this.globalMcpEnabled(userId);
    if (connectionStarted) {
      await this.runtime.startConnect(userId, installationId, true).catch(() => undefined);
    }
    return {
      configured: true,
      reconnectRequired: !connectionStarted,
      connectionStarted,
      maskedHint: this.maskedHint(clean),
    };
  }

  async updateToolFilter(userId: string, installationId: string, allowedToolNames: string[], deniedToolNames: string[]) {
    await this.mustOwnInstallation(userId, installationId);
    const [allowed, denied] = await Promise.all([
      this.validateToolNames(installationId, allowedToolNames),
      this.validateToolNames(installationId, deniedToolNames),
    ]);
    if (allowed.some((name) => denied.includes(name))) {
      throw new BadRequestException('MCP_TOOL_FILTER_CONFLICT');
    }
    const installation = await this.db.mcpInstallation.update({
      where: { id: installationId },
      data: { allowedToolNames: allowed, deniedToolNames: denied },
    });
    await this.writeAudit('mcp.installation.tool_filter_updated', userId, installation.serverId, {
      installationId,
      allowedToolCount: allowed.length,
      deniedToolCount: denied.length,
    });
    return installation;
  }

  async chatState(userId: string) {
    const [globallyEnabled, installations] = await Promise.all([
      this.globalMcpEnabled(userId),
      this.listInstallations(userId),
    ]);
    const availableInstallations = installations.filter(
      (item: any) => item.configurationState === 'ready',
    );
    return {
      globallyEnabled,
      installations: availableInstallations.map((item: any) => ({
        id: item.id,
        installationId: item.installationId,
        serverId: item.serverId,
        stableKey: item.stableKey ?? null,
        name: item.name,
        displayName: item.displayName,
        description: item.description ?? '',
        iconKey: item.iconKey ?? null,
        enabled: item.enabled,
        configurationState: item.configurationState,
        connectionState: item.connectionStatus,
        connectionStatus: item.connectionStatus,
        connectionFailureCode: item.connectionFailureCode ?? null,
        connectionFailureMessage: item.connectionFailureMessage ?? null,
        transport: item.transport,
        toolCount: item.toolCount,
        availability: item.availability,
        configurationHint: item.configurationHint,
        actionState: item.actionState,
        usable: globallyEnabled
          && item.enabled
          && item.connectionStatus === 'connected'
          && item.toolCount > 0,
      })),
    };
  }

  async setGlobalMcpEnabled(userId: string, enabled: boolean) {
    const user = await this.db.user.update({
      where: { id: userId },
      data: { mcpGloballyEnabled: enabled },
      select: { mcpGloballyEnabled: true },
    });

    if (!enabled) {
      const installations = await this.db.mcpInstallation.findMany({
        where: {
          userId,
          enabled: true,
          status: 'installed',
          removedAt: null,
        },
        select: { id: true },
      });
      await Promise.allSettled(
        installations.map((item: any) => this.runtime.disconnect(userId, item.id)),
      );
    } else {
      await this.runtime.restoreEnabledConnections(userId, true);
    }

    return { globallyEnabled: user.mcpGloballyEnabled };
  }

  async mustOwnInstallation(userId: string, installationId: string, includeServer = false): Promise<any> {
    const row = await this.db.mcpInstallation.findFirst({
      where: { id: installationId, userId, status: 'installed', removedAt: null },
      include: includeServer ? { server: true, credential: true } : undefined,
    });
    if (!row) throw new NotFoundException('MCP_INSTALLATION_NOT_FOUND');
    return row;
  }


  private async globalMcpEnabled(userId: string): Promise<boolean> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { mcpGloballyEnabled: true },
    });
    return user?.mcpGloballyEnabled ?? true;
  }

  private writeAudit(
    eventType: string,
    userId: string,
    serverId: string,
    metadata: JsonObject = {},
    agentId?: string,
  ): Promise<void> {
    return this.audit.write({
      eventType,
      serverId,
      userId,
      agentId,
      severity: 'info',
      metadata,
      occurredAt: new Date(),
    });
  }

  private async mustAccessDefinition(userId: string, id: string): Promise<any> {
    const row = await this.db.mcpServerConfig.findFirst({
      where: {
        id,
        status: 'enabled',
        OR: [
          { source: 'SYSTEM', visibility: 'PUBLIC', reviewStatus: 'approved' },
          { source: 'USER', ownerUserId: userId },
        ],
      },
    });
    if (!row) throw new NotFoundException('MCP_DEFINITION_NOT_FOUND');
    return row;
  }

  private async mustOwnDefinition(userId: string, id: string): Promise<any> {
    const row = await this.db.mcpServerConfig.findFirst({
      where: { id, source: 'USER', ownerUserId: userId, status: { not: 'archived' } },
    });
    if (!row) throw new ForbiddenException('MCP_SYSTEM_DEFINITION_IMMUTABLE');
    return row;
  }

  private async validateDefinitionInput(input: CreateMcpDefinitionInput): Promise<CreateMcpDefinitionInput> {
    const displayName = this.cleanText(input.displayName, 200, 'MCP_DISPLAY_NAME_REQUIRED');
    const description = this.optionalText(input.description, 2_000, 'MCP_DESCRIPTION_INVALID');
    const transport = input.transport;
    const requestedAuthKind = input.authKind ?? 'none';
    if (!['stdio', 'streamable_http'].includes(transport)) {
      throw new BadRequestException('MCP_TRANSPORT_UNSUPPORTED');
    }
    if (!['none', 'bearer', 'api_key', 'custom_headers', 'environment', 'oauth2'].includes(requestedAuthKind)) {
      throw new BadRequestException('MCP_AUTH_KIND_UNSUPPORTED');
    }
    const timeoutMs = Math.min(300_000, Math.max(1_000, Number(input.timeoutMs ?? 30_000) || 30_000));
    const headers = this.validateDeclaredHeaders(input.headers ?? {});
    const environment = this.validateDeclaredEnvironment(input.environment ?? {});

    if (transport === 'stdio') {
      const command = this.cleanText(input.command, 1_024, 'MCP_COMMAND_REQUIRED');
      if (/[\0\r\n]/.test(command)) throw new BadRequestException('MCP_COMMAND_INVALID');
      const args = Array.isArray(input.args) ? input.args.map((item) => String(item)) : [];
      if (args.length > 128 || args.some((item) => item.length > 8_192 || /[\0\r\n]/.test(item))) {
        throw new BadRequestException('MCP_ARGS_INVALID');
      }
      const workingDirectory = this.optionalText(input.workingDirectory, 4_096, 'MCP_WORKING_DIRECTORY_INVALID');
      if (workingDirectory && /[\0\r\n]/.test(workingDirectory)) {
        throw new BadRequestException('MCP_WORKING_DIRECTORY_INVALID');
      }
      if (Object.keys(headers).length > 0) throw new BadRequestException('MCP_STDIO_HEADERS_NOT_ALLOWED');
      if (!['none', 'environment'].includes(requestedAuthKind)) {
        throw new BadRequestException('MCP_STDIO_AUTH_KIND_UNSUPPORTED');
      }
      const authKind = Object.keys(environment).length > 0
        ? 'environment'
        : requestedAuthKind;
      if (authKind === 'environment' && Object.keys(environment).length === 0) {
        throw new BadRequestException('MCP_ENVIRONMENT_DECLARATION_REQUIRED');
      }
      return {
        displayName,
        description,
        transport,
        command,
        args,
        workingDirectory,
        authKind,
        endpoint: undefined,
        headers: {},
        environment,
        timeoutMs,
      };
    }

    if (Object.keys(environment).length > 0) {
      throw new BadRequestException('MCP_REMOTE_ENVIRONMENT_NOT_ALLOWED');
    }
    if (requestedAuthKind === 'environment') {
      throw new BadRequestException('MCP_REMOTE_AUTH_KIND_UNSUPPORTED');
    }
    const authKind = requestedAuthKind;
    const endpointRaw = this.cleanText(input.endpoint, 4_096, 'MCP_ENDPOINT_REQUIRED');
    const endpoint = (await this.urls.assertAllowed(endpointRaw)).toString();
    return {
      displayName,
      description,
      transport,
      endpoint,
      command: undefined,
      args: [],
      workingDirectory: undefined,
      authKind,
      headers,
      environment: {},
      timeoutMs,
    };
  }

  private definitionDto(row: any, detail = false) {
    return {
      id: row.id,
      stableKey: row.stableKey,
      source: row.source,
      ownerUserId: row.ownerUserId,
      displayName: row.displayName ?? row.name,
      name: row.name,
      description: row.description ?? '',
      publisher: row.publisher,
      iconKey: row.iconKey,
      transport: row.transport,
      authKind: row.authKind,
      visibility: row.visibility,
      reviewStatus: row.reviewStatus,
      managedRuntime: row.managedRuntime,
      status: row.status,
      declaredHeaderKeys: this.stringArray(this.record(row.authConfig).declaredHeaderKeys),
      declaredEnvironmentKeys: this.stringArray(this.record(row.authConfig).declaredEnvironmentKeys),
      ...(detail && row.source === 'USER' ? {
        endpoint: row.endpoint,
        command: row.command,
        args: row.args,
        workingDirectory: row.workingDirectory,
        timeoutMs: row.timeoutMs,
      } : {}),
    };
  }

  private installationDto(
    row: any,
    oauthSession?: any,
    definition?: BuiltinMcpDefinition,
  ) {
    const connection = row.connectionStates?.[0];
    const connectionStatus = connection?.status ?? 'disconnected';
    const toolCount = Array.isArray(row.toolSnapshots) ? row.toolSnapshots.length : 0;
    const availability = this.installationAvailability(definition, row.server);
    const requiredConfigurationKeys = this.installationConfigurationKeys(row.server);
    return {
      id: row.id,
      installationId: row.id,
      serverId: row.serverId,
      stableKey: row.server.stableKey ?? null,
      enabled: row.enabled,
      status: row.status,
      configurationState: row.configurationState,
      installedAt: row.installedAt,
      source: row.server.source,
      owned: row.server.source === 'USER',
      displayName: row.server.displayName ?? row.server.name,
      name: row.server.name,
      description: row.server.description ?? '',
      publisher: row.server.publisher,
      iconKey: row.server.iconKey,
      transport: row.server.transport,
      authKind: row.server.authKind,
      availability,
      configurationHint: describeMcpConfiguration(
        availability,
        row.server.displayName ?? row.server.name,
      ).fallback,
      configurationHintPresentation: describeMcpConfiguration(
        availability,
        row.server.displayName ?? row.server.name,
      ),
      requiredConfigurationKeys,
      declaredHeaderKeys: this.stringArray(this.record(row.server.authConfig).declaredHeaderKeys),
      declaredEnvironmentKeys: this.stringArray(this.record(row.server.authConfig).declaredEnvironmentKeys),
      connectionStatus,
      connectionFailureCode: connection?.failureCode ?? null,
      connectionFailureMessage: connection?.failureMessage ?? null,
      protocolEra: connection?.protocolEra ?? null,
      protocolVersion: connection?.protocolVersion ?? null,
      toolCount,
      credential: row.credential ? {
        kind: row.credential.kind,
        storageLocation: row.credential.storageLocation,
        maskedHint: row.credential.maskedHint ?? null,
      } : null,
      oauthStatus: row.server.authKind !== 'oauth2'
        ? 'not_required'
        : !oauthSession
          ? 'authorization_required'
          : oauthSession.status === 'revoked'
            ? 'revoked'
            : oauthSession.status === 'expired'
              ? 'expired'
              : 'authorized',
      oauthExpiresAt: oauthSession?.expiresAt ?? null,
      actionState: resolveMcpInstallationActionState({
        installed: true,
        enabled: row.enabled,
        configurationState: row.configurationState,
        connectionStatus,
        availability,
      }),
    };
  }


  private installationAvailability(
    definition: BuiltinMcpDefinition | undefined,
    server: any,
  ): McpPresentationAvailability {
    if (definition?.availability) return definition.availability;
    if (server.authKind === 'oauth2') return 'oauth';
    if (server.authKind && server.authKind !== 'none') return 'credential';
    return 'ready';
  }


  private installationConfigurationKeys(server: any): string[] {
    const authConfig = this.record(server.authConfig);
    const raw = server.transport === 'stdio'
      ? authConfig.declaredEnvironmentKeys
      : authConfig.declaredHeaderKeys;
    return this.stringArray(raw);
  }

  private runtimeDefinitionChanged(
    existing: any,
    next: CreateMcpDefinitionInput,
    nextAuthConfig: Record<string, unknown>,
  ): boolean {
    const comparable = (value: unknown) => JSON.stringify(value ?? null);
    return existing.transport !== next.transport
      || String(existing.endpoint ?? '') !== String(next.endpoint ?? '')
      || String(existing.command ?? '') !== String(next.command ?? '')
      || comparable(existing.args ?? []) !== comparable(next.args ?? [])
      || String(existing.workingDirectory ?? '') !== String(next.workingDirectory ?? '')
      || String(existing.authKind ?? 'none') !== String(next.authKind ?? 'none')
      || Number(existing.timeoutMs ?? 30_000) !== Number(next.timeoutMs ?? 30_000)
      || comparable(this.record(existing.authConfig)) !== comparable(nextAuthConfig);
  }


  private hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  private declaredRecord(value: unknown): Record<string, string> {
    if (!Array.isArray(value)) return {};
    return Object.fromEntries(
      value.map(String).map((key) => key.trim()).filter(Boolean).map((key) => [key, '']),
    );
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private async validateToolNames(installationId: string, names: string[]): Promise<string[]> {
    const normalized = [...new Set((names ?? []).map(String).map((name) => name.trim()).filter(Boolean))];
    if (normalized.length > 1_000 || normalized.some((name) => name.length > 300 || /[\0\r\n]/.test(name))) {
      throw new BadRequestException('MCP_TOOL_FILTER_INVALID');
    }
    if (normalized.length === 0) return [];
    const existing = await this.db.mcpToolSnapshot.findMany({
      where: { installationId, toolName: { in: normalized } },
      select: { toolName: true },
    });
    const existingNames = new Set(existing.map((item: any) => item.toolName));
    if (normalized.some((name) => !existingNames.has(name))) {
      throw new BadRequestException('MCP_TOOL_FILTER_UNKNOWN_TOOL');
    }
    return normalized;
  }

  private authConfig(input: CreateMcpDefinitionInput): Record<string, unknown> {
    const declaredHeaderKeys = Object.keys(input.headers ?? {});
    const declaredEnvironmentKeys = Object.keys(input.environment ?? {});
    return {
      declaredHeaderKeys,
      declaredEnvironmentKeys,
      ...(input.authKind === 'oauth2' ? { mode: 'mcp_discovery' } : {}),
      ...(input.authKind === 'api_key' && declaredHeaderKeys[0]
        ? { headerName: declaredHeaderKeys[0] }
        : {}),
    };
  }

  private validateCredentialValues(server: any, values: Record<string, string>): Record<string, string> {
    const entries = Object.entries(values ?? {});
    if (entries.length === 0 || entries.length > MAX_SECRET_ENTRIES) {
      throw new BadRequestException('MCP_CREDENTIAL_VALUES_INVALID');
    }
    const authConfig = this.record(server.authConfig);
    const declared = server.transport === 'stdio'
      ? this.stringArray(authConfig.declaredEnvironmentKeys)
      : this.stringArray(authConfig.declaredHeaderKeys);
    const clean: Record<string, string> = {};
    for (const [rawKey, rawValue] of entries) {
      const key = String(rawKey ?? '').trim();
      const value = String(rawValue ?? '');
      const keyValid = server.transport === 'stdio'
        ? ENVIRONMENT_NAME_PATTERN.test(key)
        : HEADER_NAME_PATTERN.test(key) && !FORBIDDEN_REMOTE_HEADERS.has(key.toLowerCase());
      if (!keyValid || !value || Buffer.byteLength(value, 'utf8') > MAX_SECRET_VALUE_BYTES || /\0/.test(value)) {
        throw new BadRequestException('MCP_CREDENTIAL_VALUES_INVALID');
      }
      if (server.transport !== 'stdio' && /[\r\n]/.test(value)) {
        throw new BadRequestException('MCP_HEADER_VALUE_INVALID');
      }
      if (declared.length > 0 && !declared.includes(key)) {
        const syntheticKey = server.authKind === 'bearer' && ['token', 'bearerToken', 'accessToken'].includes(key);
        const apiKeyAlias = server.authKind === 'api_key' && key === 'apiKey';
        if (!syntheticKey && !apiKeyAlias) throw new BadRequestException('MCP_CREDENTIAL_KEY_NOT_DECLARED');
      }
      clean[key] = value;
    }
    if (server.authKind === 'bearer' && !['token', 'bearerToken', 'accessToken'].some((key) => clean[key])) {
      throw new BadRequestException('MCP_BEARER_TOKEN_REQUIRED');
    }
    if (server.authKind === 'api_key') {
      const headerName = String(authConfig.headerName ?? declared[0] ?? 'X-API-Key');
      if (!clean.apiKey && !clean[headerName]) throw new BadRequestException('MCP_API_KEY_REQUIRED');
    }
    if (['custom_headers', 'environment'].includes(server.authKind) && declared.length > 0) {
      const missing = declared.filter((key) => !clean[key]);
      if (missing.length > 0) throw new BadRequestException('MCP_CREDENTIAL_DECLARATION_INCOMPLETE');
    }
    return clean;
  }

  private validateDeclaredHeaders(values: Record<string, string>): Record<string, string> {
    const keys = Object.keys(values ?? {});
    if (keys.length > MAX_SECRET_ENTRIES) throw new BadRequestException('MCP_HEADER_DECLARATION_INVALID');
    const result: Record<string, string> = {};
    for (const rawKey of keys) {
      const key = String(rawKey).trim();
      if (!HEADER_NAME_PATTERN.test(key) || FORBIDDEN_REMOTE_HEADERS.has(key.toLowerCase())) {
        throw new BadRequestException('MCP_HEADER_DECLARATION_INVALID');
      }
      result[key] = '';
    }
    return result;
  }

  private validateDeclaredEnvironment(values: Record<string, string>): Record<string, string> {
    const keys = Object.keys(values ?? {});
    if (keys.length > MAX_SECRET_ENTRIES) throw new BadRequestException('MCP_ENVIRONMENT_DECLARATION_INVALID');
    const result: Record<string, string> = {};
    for (const rawKey of keys) {
      const key = String(rawKey).trim();
      if (!ENVIRONMENT_NAME_PATTERN.test(key)) {
        throw new BadRequestException('MCP_ENVIRONMENT_DECLARATION_INVALID');
      }
      result[key] = '';
    }
    return result;
  }

  private cleanText(value: unknown, maximum: number, code: string): string {
    const clean = String(value ?? '').trim();
    if (!clean || clean.length > maximum) throw new BadRequestException(code);
    return clean;
  }

  private optionalText(value: unknown, maximum: number, code: string): string | undefined {
    const clean = String(value ?? '').trim();
    if (!clean) return undefined;
    if (clean.length > maximum) throw new BadRequestException(code);
    return clean;
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.map(String).map((item) => item.trim()).filter(Boolean)
      : [];
  }

  private async uniqueName(userId: string, base: string): Promise<string> {
    let candidate = `user.${userId.slice(0, 8)}.${base}`;
    let counter = 1;
    while (await this.db.mcpServerConfig.findUnique({ where: { name: candidate }, select: { id: true } })) {
      counter += 1;
      candidate = `user.${userId.slice(0, 8)}.${base}-${counter}`;
    }
    return candidate;
  }

  private slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp';
  }

  private maskedHint(values: Record<string, string>): string | null {
    const first = Object.values(values).find(Boolean);
    if (!first) return null;
    return first.length <= 4 ? '••••' : `${first.slice(0, 2)}••••${first.slice(-2)}`;
  }
}