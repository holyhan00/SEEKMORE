import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';
import { BuiltinMcpCatalogService } from '../catalog/builtin-mcp-catalog.service';
import type {
  BuiltinMcpCatalogSyncResult,
  BuiltinMcpDefinition,
} from '../catalog/builtin-mcp-definition';

@Injectable()
export class McpSystemCatalogBootstrapService
  implements OnApplicationBootstrap
{
  private readonly db: any;
  private syncPromise: Promise<BuiltinMcpCatalogSyncResult[]> | null = null;

  constructor(
    prisma: PrismaService,
    private readonly catalog: BuiltinMcpCatalogService,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {
    this.db = prisma as any;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.sync();
  }

  sync(): Promise<BuiltinMcpCatalogSyncResult[]> {
    this.syncPromise ??= this.performSync().catch((error) => {
      this.syncPromise = null;
      throw error;
    });
    return this.syncPromise;
  }

  private async performSync(): Promise<BuiltinMcpCatalogSyncResult[]> {
    const startedAt = Date.now();
    const definitions = await this.catalog.loadDefinitions();

    this.trace.event('mcp.catalog.sync_started', {
      definitionCount: definitions.length,
    });

    const results: BuiltinMcpCatalogSyncResult[] = [];
    for (const definition of definitions) {
      results.push(await this.upsertDefinition(definition));
    }

    const archivedCount = await this.archiveRemovedDefinitions(
      definitions.map((definition) => definition.stableKey),
    );

    this.trace.event('mcp.catalog.sync_completed', {
      definitionCount: definitions.length,
      createdCount: results.filter((item) => item.created).length,
      updatedCount: results.filter((item) => item.updated).length,
      archivedCount,
      durationMs: Date.now() - startedAt,
    });

    return results;
  }

  private async upsertDefinition(
    definition: BuiltinMcpDefinition,
  ): Promise<BuiltinMcpCatalogSyncResult> {
    const startedAt = Date.now();
    let existing = await this.db.mcpServerConfig.findUnique({
      where: { stableKey: definition.stableKey },
      select: { id: true, source: true },
    });

    if (!existing) {
      const previousSystemDefinition =
        await this.db.mcpServerConfig.findUnique({
          where: { name: definition.name },
          select: { id: true, source: true, stableKey: true },
        });

      if (previousSystemDefinition && previousSystemDefinition.source !== 'SYSTEM') {
        const error = new Error(
          `MCP_SYSTEM_NAME_OWNED_BY_USER:${definition.name}`,
        );
        this.trace.error('mcp.catalog.definition_conflict', {
          stableKey: definition.stableKey,
          name: definition.name,
          existingServerId: previousSystemDefinition.id,
          existingSource: previousSystemDefinition.source,
        });
        throw error;
      }

      if (previousSystemDefinition?.source === 'SYSTEM') {
        await this.db.mcpServerConfig.update({
          where: { id: previousSystemDefinition.id },
          data: {
            stableKey: definition.stableKey,
            updatedBy: 'system',
          },
        });
        existing = {
          id: previousSystemDefinition.id,
          source: previousSystemDefinition.source,
        };
        this.trace.event('mcp.catalog.stable_key_migrated', {
          serverId: previousSystemDefinition.id,
          name: definition.name,
          previousStableKey: previousSystemDefinition.stableKey,
          stableKey: definition.stableKey,
        });
      }
    }

    if (existing && existing.source !== 'SYSTEM') {
      const error = new Error(
        `MCP_SYSTEM_STABLE_KEY_OWNED_BY_USER:${definition.stableKey}`,
      );
      this.trace.error('mcp.catalog.definition_conflict', {
        stableKey: definition.stableKey,
        existingServerId: existing.id,
        existingSource: existing.source,
      });
      throw error;
    }

    const row = await this.db.mcpServerConfig.upsert({
      where: { stableKey: definition.stableKey },
      create: this.createData(definition),
      update: this.updateData(definition),
      select: { id: true },
    });

    const result: BuiltinMcpCatalogSyncResult = {
      stableKey: definition.stableKey,
      name: definition.name,
      serverId: row.id,
      created: !existing,
      updated: Boolean(existing),
    };

    this.trace.event('mcp.catalog.definition_synced', {
      stableKey: definition.stableKey,
      name: definition.name,
      serverId: row.id,
      visibility: definition.visibility,
      managedRuntime: definition.managedRuntime,
      transport: definition.transport,
      created: result.created,
      updated: result.updated,
      durationMs: Date.now() - startedAt,
    });

    return result;
  }

  private async archiveRemovedDefinitions(
    activeStableKeys: string[],
  ): Promise<number> {
    const stale = await this.db.mcpServerConfig.findMany({
      where: {
        source: 'SYSTEM',
        status: { not: 'archived' },
        OR: [
          { stableKey: null },
          { stableKey: { notIn: activeStableKeys } },
        ],
      },
      select: { id: true },
    });
    const serverIds = stale.map((item: { id: string }) => item.id);
    if (serverIds.length === 0) return 0;

    const removedAt = new Date();
    await this.db.$transaction([
      this.db.mcpServerConfig.updateMany({
        where: { id: { in: serverIds } },
        data: { status: 'archived', updatedBy: 'system' },
      }),
      this.db.mcpInstallation.updateMany({
        where: { serverId: { in: serverIds }, removedAt: null },
        data: {
          enabled: false,
          status: 'uninstalled',
          removedAt,
        },
      }),
      this.db.mcpToolSnapshot.updateMany({
        where: { serverId: { in: serverIds } },
        data: { status: 'disabled' },
      }),
      this.db.mcpConnectionState.updateMany({
        where: { serverId: { in: serverIds } },
        data: {
          status: 'disconnected',
          lastDisconnectedAt: removedAt,
        },
      }),
    ]);

    return serverIds.length;
  }

  private createData(definition: BuiltinMcpDefinition): Record<string, unknown> {
    return {
      ...this.sharedData(definition),
      createdBy: 'system',
      updatedBy: 'system',
    };
  }

  private updateData(definition: BuiltinMcpDefinition): Record<string, unknown> {
    return {
      ...this.sharedData(definition),
      updatedBy: 'system',
    };
  }

  private sharedData(definition: BuiltinMcpDefinition): Record<string, unknown> {
    return {
      name: definition.name,
      stableKey: definition.stableKey,
      source: 'SYSTEM',
      ownerUserId: null,
      displayName: definition.displayName,
      description: definition.description,
      publisher: definition.publisher ?? null,
      iconKey: definition.iconKey ?? null,
      visibility: definition.visibility,
      reviewStatus: 'approved',
      originType: definition.originType,
      registryIdentifier: definition.registryIdentifier ?? null,
      registryVersion: definition.registryVersion ?? null,
      repository: definition.repository ?? null,
      lastSyncedAt: new Date(),
      protocolPreference: definition.protocolPreference ?? 'legacy',
      managedRuntime: definition.managedRuntime,
      transport: definition.transport,
      status: definition.enabled === false ? 'archived' : 'enabled',
      trustLevel: definition.trustLevel,
      scope: definition.scope ?? 'app',
      endpoint:
        definition.transport === 'streamable_http'
          ? definition.endpoint ?? null
          : null,
      command:
        definition.transport === 'stdio'
          ? definition.command ?? null
          : null,
      args: definition.transport === 'stdio' ? definition.args ?? [] : [],
      workingDirectory:
        definition.transport === 'stdio'
          ? definition.workingDirectory ?? null
          : null,
      env: definition.environment ?? {},
      headers: definition.headers ?? {},
      authKind: definition.authKind ?? 'none',
      authConfig: definition.authConfig ?? {},
      allowedDomains: definition.allowedDomains ?? [],
      deniedDomains: definition.deniedDomains ?? [],
      allowedRoles: definition.allowedRoles ?? [],
      allowedToolNames: definition.allowedToolNames ?? [],
      deniedToolNames: definition.deniedToolNames ?? [],
      toolPolicy: definition.toolPolicy ?? {},
      requestScoped: definition.requestScoped ?? false,
      timeoutMs: definition.timeoutMs ?? 60_000,
      tenantId: null,
    };
  }
}
