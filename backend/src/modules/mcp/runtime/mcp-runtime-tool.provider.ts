import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';
import { ToolError } from '../../../tools/toolstypes';
import type {
  Tool,
  ToolRiskLevel,
  ToolSideEffectClass,
} from '../../../tools/toolstypes';
import type {
  McpInvokeInput,
  McpInvokeOutput,
  McpPrincipal,
  McpRuntimeToolDefinition,
} from '../domain/mcp-runtime.types';
import { McpInstallationRuntimeService } from '../runtime/mcp-installation-runtime.service';

export const MCP_TOOLS_SEARCH_NAME = 'mcp.tools.search';
export const MCP_CALL_NAME = 'mcp.call';

const MCP_DISCOVERY_DEFAULT_TOOLS = 8;
const MCP_DISCOVERY_MAX_TOOLS = 12;
const MCP_DISCOVERY_MAX_DESCRIPTOR_CHARS = 12_000;

@Injectable()
export class McpRuntimeToolProvider {
  private readonly db: any;

  constructor(
    prisma: PrismaService,
    private readonly runtime: McpInstallationRuntimeService,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {
    this.db = prisma as any;
  }

  async listTools(input: {
    userId: string;
    agentId: string;
  }): Promise<Tool[]> {
    const snapshots = await this.listEligibleUserSnapshots(input);
    return snapshots.map(({ snapshot }) =>
      this.toAgentTool(snapshot, input),
    );
  }

  async resolveTool(input: {
    userId: string;
    agentId: string;
    name: string;
  }): Promise<Tool | null> {
    const requested = String(input.name ?? '').trim();
    if (!requested || !(await this.mcpGloballyEnabled(input.userId))) {
      return null;
    }

    const eligible = await this.listEligibleUserSnapshots(input, {
      runtimeToolIds: [requested],
    });
    const found = eligible.find(({ snapshot }) =>
      snapshot.runtimeToolId === requested,
    );
    return found
      ? this.toAgentTool(found.snapshot, input)
      : null;
  }

  async listDiscoveryTools(input: {
    userId: string;
    agentId: string;
  }): Promise<Tool[]> {
    const providers = await this.listProviderPreviews(input);
    if (!providers.length) return [];

    const providerKeys = providers.map((provider) => provider.providerKey);
    const providerSummary = providers
      .map((provider) =>
        `${provider.displayName} (${provider.providerKey})${provider.description ? ` — ${provider.description}` : ''}`,
      )
      .join('; ');

    const providerProperty = {
      type: 'string',
      enum: providerKeys,
      description: 'One currently available MCP provider key.',
    };

    const searchTool: Tool = {
      name: MCP_TOOLS_SEARCH_NAME,
      version: '1.0.0',
      runtimeOnly: true,
      displayName: 'Discover MCP Tools',
      description: [
        'Discover a small set of concrete tools from one currently available MCP provider.',
        'Use this only when the task needs that provider, then call the chosen concrete capability through mcp.call.',
        `Available MCP providers: ${providerSummary}.`,
      ].join(' '),
      providerKind: 'mcp',
      tags: ['mcp', 'mcp.discovery'],
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['providerKey', 'query'],
        properties: {
          providerKey: providerProperty,
          query: {
            type: 'string',
            minLength: 1,
            maxLength: 1000,
            description: 'Describe the concrete operation needed from this provider.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: MCP_DISCOVERY_MAX_TOOLS,
            default: MCP_DISCOVERY_DEFAULT_TOOLS,
          },
        },
      },
      sideEffectClass: 'read_only',
      riskLevel: 'low',
      requiresApproval: false,
      idempotency: 'optional',
      supportsAbort: true,
      requiredSurfaces: ['external'],
      parallelism: 'parallel_safe',
      presentation: 'hidden',
      latencyClass: 'short',
      maxOutputBytes: 128 * 1024,
      execute: async (args, context) => {
        const providerKey = this.requiredText(args.providerKey, 'MCP_PROVIDER_REQUIRED');
        const query = this.requiredText(args.query, 'MCP_TOOL_QUERY_REQUIRED');
        const limit = this.discoveryLimit(args.limit);
        const result = await this.searchProviderTools({
          ...input,
          providerKey,
          query,
          limit,
        });
        this.trace.event('mcp.discovery.search_done', {
          trace: context.traceId,
          userId: input.userId,
          agentId: input.agentId,
          providerKey,
          queryLength: query.length,
          returnedToolCount: result.tools.length,
          availableToolCount: result.availableToolCount,
        });
        return result;
      },
    };

    const callTool: Tool = {
      name: MCP_CALL_NAME,
      version: '1.0.0',
      runtimeOnly: true,
      displayName: 'Call MCP Tool',
      description: [
        'Execute one concrete tool from a currently available MCP provider.',
        'Use mcp.tools.search first when you do not already know the exact tool name and input schema.',
        `Available MCP providers: ${providers.map((provider) => `${provider.displayName} (${provider.providerKey})`).join('; ')}.`,
      ].join(' '),
      providerKind: 'mcp',
      tags: ['mcp', 'mcp.call'],
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['providerKey', 'toolName', 'arguments'],
        properties: {
          providerKey: providerProperty,
          toolName: {
            type: 'string',
            minLength: 1,
            maxLength: 512,
            description: 'Exact MCP tool name returned by mcp.tools.search.',
          },
          arguments: {
            type: 'object',
            additionalProperties: true,
            description: 'Arguments matching the concrete MCP tool input schema.',
          },
        },
      },
                                                                                
                                                                           
      sideEffectClass: 'external_effect',
      riskLevel: 'low',
      requiresApproval: false,
      idempotency: 'required',
      supportsAbort: true,
      requiredSurfaces: ['external'],
      parallelism: 'resource_serial',
      presentation: 'activity',
      latencyClass: 'long',
      maxOutputBytes: 2 * 1024 * 1024,
      assessRisk: async (args) => {
        const resolved = await this.resolveProviderSnapshot({
          ...input,
          providerKey: this.requiredText(args.providerKey, 'MCP_PROVIDER_REQUIRED'),
          toolName: this.requiredText(args.toolName, 'MCP_TOOL_NAME_REQUIRED'),
        });
        if (!resolved) {
          throw new ToolError('MCP_TOOL_NOT_AVAILABLE', 'MCP tool is not currently available');
        }
        const policy = this.policy(resolved.snapshot);
        return {
          riskLevel: policy.riskLevel,
          requiresApproval: policy.requiresApproval,
          reasonCodes: [
            'mcp:concrete_tool_policy',
            `mcp:provider:${this.providerKey(resolved.installation)}`,
            `mcp:tool:${resolved.snapshot.toolName}`,
          ],
          descriptor: {
            providerKey: this.providerKey(resolved.installation),
            toolName: resolved.snapshot.toolName,
            runtimeToolId: resolved.snapshot.runtimeToolId,
            sideEffectClass: policy.sideEffectClass,
          },
        };
      },
      execute: async (args, context, signal) => {
        const providerKey = this.requiredText(args.providerKey, 'MCP_PROVIDER_REQUIRED');
        const toolName = this.requiredText(args.toolName, 'MCP_TOOL_NAME_REQUIRED');
        const toolArguments = this.record(args.arguments);
        const resolved = await this.resolveProviderSnapshot({
          ...input,
          providerKey,
          toolName,
        });
        if (!resolved) {
          throw new ToolError('MCP_TOOL_NOT_AVAILABLE', 'MCP tool is not currently available');
        }

        this.trace.event('mcp.discovery.call_start', {
          trace: context.traceId,
          userId: input.userId,
          agentId: input.agentId,
          providerKey,
          toolName,
          runtimeToolId: resolved.snapshot.runtimeToolId,
        });
        const output = await this.runtime.invoke({
          userId: input.userId,
          agentId: input.agentId,
          installationId: resolved.snapshot.installationId,
          runtimeToolId: resolved.snapshot.runtimeToolId,
          arguments: toolArguments,
          traceId: context.traceId,
          conversationId: context.conversationId,
          turnId: String(context.metadata?.turnId ?? '') || undefined,
          workflowId: String(context.metadata?.workflowId ?? '') || undefined,
          stepId: String(context.metadata?.stepId ?? '') || undefined,
          requestId: context.requestId,
          signal,
        });
        if (output.result.isError) {
          throw Object.assign(new Error(this.errorText(output.result.content)), {
            code: 'MCP_TOOL_RETURNED_ERROR',
            detail: output.result,
          });
        }
        this.trace.event('mcp.discovery.call_done', {
          trace: context.traceId,
          providerKey,
          toolName,
          runtimeToolId: resolved.snapshot.runtimeToolId,
          invocationId: output.invocationId,
          truncated: output.result.truncated,
        });
        return output.result.structuredContent !== undefined
          ? output.result.structuredContent
          : {
              content: output.result.content,
              resources: output.result.resources,
              truncated: output.result.truncated,
            };
      },
    };

    this.trace.event('mcp.discovery.preview_built', {
      userId: input.userId,
      agentId: input.agentId,
      providerCount: providers.length,
      providerKeys: providerKeys.join(','),
    });

    return [searchTool, callTool];
  }

  async listProviderPreviews(input: {
    userId: string;
    agentId: string;
  }): Promise<Array<{
    providerKey: string;
    displayName: string;
    description: string;
    toolCount: number;
  }>> {
    const eligible = await this.listEligibleUserSnapshots(input);
    const grouped = new Map<string, {
      providerKey: string;
      displayName: string;
      description: string;
      toolCount: number;
    }>();

    for (const { installation } of eligible) {
      const providerKey = this.providerKey(installation);
      const existing = grouped.get(providerKey);
      if (existing) {
        existing.toolCount += 1;
        continue;
      }
      const server = installation.server;
      grouped.set(providerKey, {
        providerKey,
        displayName: String(server.displayName ?? server.name ?? providerKey),
        description: this.previewDescription(server.description),
        toolCount: 1,
      });
    }

    return [...grouped.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }

  async listRequestedTools(input: {
    userId: string;
    agentId: string;
    runtimeToolNames: string[];
  }): Promise<Tool[]> {
    const runtimeToolIds = [...new Set(
      input.runtimeToolNames
        .map((name) => String(name ?? '').trim())
        .filter((name) => name.startsWith('rt_mcp_')),
    )];
    if (!runtimeToolIds.length) return [];
    const snapshots = await this.listEligibleUserSnapshots(input, { runtimeToolIds });
    return snapshots.map(({ snapshot }) =>
      this.toAgentTool(snapshot, input),
    );
  }

  async searchProviderTools(input: {
    userId: string;
    agentId: string;
    providerKey: string;
    query: string;
    limit?: number;
  }): Promise<{
    provider: { providerKey: string; displayName: string };
    availableToolCount: number;
    tools: Array<{
      name: string;
      title?: string;
      description?: string;
      inputSchema: object;
    }>;
  }> {
    const eligible = await this.listEligibleUserSnapshots(input);
    const providerRows = eligible.filter(({ installation }) =>
      this.providerKey(installation) === input.providerKey,
    );
    if (!providerRows.length) {
      throw new ToolError('MCP_PROVIDER_NOT_AVAILABLE', 'MCP provider is not currently available');
    }

    const limit = this.discoveryLimit(input.limit);
    const ranked = providerRows
      .map(({ snapshot }) => ({
        snapshot,
        score: this.searchScore(snapshot, input.query),
      }))
      .sort((a, b) => b.score - a.score ||
        String(a.snapshot.toolName).localeCompare(String(b.snapshot.toolName)),
      );
    const positive = ranked.filter((item) => item.score > 0);
    const selected = (positive.length ? positive : ranked).slice(0, limit);
    const tools: Array<{
      name: string;
      title?: string;
      description?: string;
      inputSchema: object;
    }> = [];
    let usedChars = 0;
    for (const { snapshot } of selected) {
      const item = {
        name: String(snapshot.toolName),
        ...(snapshot.title ? { title: String(snapshot.title) } : {}),
        ...(snapshot.description ? { description: String(snapshot.description) } : {}),
        inputSchema: this.objectSchema(snapshot.inputSchema),
      };
      const chars = JSON.stringify(item).length;
      if (tools.length > 0 && usedChars + chars > MCP_DISCOVERY_MAX_DESCRIPTOR_CHARS) {
        break;
      }
      tools.push(item);
      usedChars += chars;
    }

    const server = providerRows[0].installation.server;
    return {
      provider: {
        providerKey: input.providerKey,
        displayName: String(server.displayName ?? server.name ?? input.providerKey),
      },
      availableToolCount: providerRows.length,
      tools,
    };
  }

  private async resolveProviderSnapshot(input: {
    userId: string;
    agentId: string;
    providerKey: string;
    toolName: string;
  }): Promise<{ snapshot: any; installation: any } | null> {
    const eligible = await this.listEligibleUserSnapshots(input);
    return eligible.find(({ snapshot, installation }) =>
      this.providerKey(installation) === input.providerKey
      && snapshot.toolName === input.toolName,
    ) ?? null;
  }

  async listRuntimeTools(
    serverId: string,
    principal: McpPrincipal,
  ): Promise<McpRuntimeToolDefinition[]> {
    if (!(await this.mcpGloballyEnabled(principal.userId))) return [];

    await this.runtime.restoreEnabledConnections(principal.userId);
    const snapshots = await this.db.mcpToolSnapshot.findMany({
      where: {
        serverId,
        status: 'available',
        installationId: { not: null },
        installation: {
          enabled: true,
          status: 'installed',
          removedAt: null,
          configurationState: 'ready',
          connectionStates: { some: { status: 'connected' } },
          userId: principal.userId,
        },
      },
      include: {
        installation: {
          include: { server: true },
        },
      },
      orderBy: { toolName: 'asc' },
    });

    return snapshots
      .filter((snapshot: any) => this.allowed(snapshot))
      .map((snapshot: any) => this.toRuntimeTool(snapshot));
  }

  async listAllRuntimeTools(
    principal: McpPrincipal,
  ): Promise<McpRuntimeToolDefinition[]> {
    if (!(await this.mcpGloballyEnabled(principal.userId))) return [];

    await this.runtime.restoreEnabledConnections(principal.userId);
    await this.runtime.synchronizePendingChanges(principal.userId);
    const snapshots = await this.db.mcpToolSnapshot.findMany({
      where: {
        status: 'available',
        installationId: { not: null },
        installation: {
          userId: principal.userId,
          enabled: true,
          status: 'installed',
          removedAt: null,
          configurationState: 'ready',
          connectionStates: { some: { status: 'connected' } },
          server: {
            status: 'enabled',
            OR: [
              {
                source: 'SYSTEM',
                visibility: 'PUBLIC',
                reviewStatus: 'approved',
              },
              { source: 'USER', ownerUserId: principal.userId },
            ],
          },
        },
      },
      include: {
        installation: {
          include: { server: true },
        },
      },
      orderBy: [{ serverName: 'asc' }, { toolName: 'asc' }],
    });

    return snapshots
      .filter((snapshot: any) => this.allowed(snapshot))
      .map((snapshot: any) => this.toRuntimeTool(snapshot));
  }

  async invoke(input: McpInvokeInput): Promise<McpInvokeOutput> {
    const snapshot = await this.db.mcpToolSnapshot.findUnique({
      where: { runtimeToolId: input.runtimeToolId },
      select: { installationId: true },
    });
    if (!snapshot?.installationId) {
      throw new NotFoundException('MCP_TOOL_NOT_AVAILABLE');
    }

    const startedAt = Date.now();
    this.trace.event('mcp.runtime.invoke_start', {
      trace: input.principal.traceId,
      runtimeToolId: input.runtimeToolId,
      userId: input.principal.userId,
      agentId: input.principal.agentId ?? null,
      conversationId: input.context?.conversationId ?? null,
    });

    try {
      const output = await this.runtime.invoke({
        userId: input.principal.userId,
        agentId: input.principal.agentId,
        installationId: snapshot.installationId,
        runtimeToolId: input.runtimeToolId,
        arguments: input.arguments,
        traceId: input.principal.traceId,
        conversationId: input.context?.conversationId,
        turnId: input.context?.messageId,
        workflowId: input.context?.taskId,
        requestId: input.principal.requestId,
        signal: input.signal,
      });

      this.trace.event('mcp.runtime.invoke_done', {
        trace: input.principal.traceId,
        runtimeToolId: input.runtimeToolId,
        invocationId: output.invocationId,
        isError: output.result.isError,
        truncated: output.result.truncated,
        durationMs: Date.now() - startedAt,
      });
      return output;
    } catch (error) {
      this.trace.warn('mcp.runtime.invoke_failed', {
        trace: input.principal.traceId,
        runtimeToolId: input.runtimeToolId,
        userId: input.principal.userId,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private toAgentTool(
    snapshot: any,
    input: { userId: string; agentId: string },
  ): Tool {
    const policy = this.policy(snapshot);
    return {
      name: snapshot.runtimeToolId,
      version: snapshot.snapshotHash.slice(0, 12),
      runtimeOnly: true,
      displayName: snapshot.title ?? snapshot.toolName,
      description: snapshot.description ?? `MCP tool ${snapshot.toolName}`,
      providerKind: 'mcp',
      tags: ['mcp'],
      inputSchema:
        snapshot.inputSchema ?? {
          type: 'object',
          properties: {},
          additionalProperties: true,
        },
                                                                       
                                                           
      outputSchema: undefined,
      sideEffectClass: policy.sideEffectClass,
      riskLevel: policy.riskLevel,
      requiresApproval: policy.requiresApproval,
      idempotency: policy.idempotency,
      supportsAbort: true,
      maxOutputBytes: 2 * 1024 * 1024,
      requiredSurfaces:
        snapshot.installation.server.managedRuntime === 'DESKTOP'
          ? ['desktop']
          : ['external'],
      latencyClass: 'long',
      execute: async (args, context, signal) => {
        const output = await this.runtime.invoke({
          userId: input.userId,
          agentId: input.agentId,
          installationId: snapshot.installationId,
          runtimeToolId: snapshot.runtimeToolId,
          arguments: args,
          traceId: context.traceId,
          conversationId: context.conversationId,
          turnId: String(context.metadata?.turnId ?? '') || undefined,
          workflowId: String(context.metadata?.workflowId ?? '') || undefined,
          stepId: String(context.metadata?.stepId ?? '') || undefined,
          requestId: context.requestId,
          signal,
        });
        if (output.result.isError) {
          throw Object.assign(new Error(this.errorText(output.result.content)), {
            code: 'MCP_TOOL_RETURNED_ERROR',
            detail: output.result,
          });
        }
        return output.result.structuredContent !== undefined
          ? output.result.structuredContent
          : {
              content: output.result.content,
              resources: output.result.resources,
              truncated: output.result.truncated,
            };
      },
    };
  }

  private toRuntimeTool(snapshot: any): McpRuntimeToolDefinition {
    const policy = this.policy(snapshot);
    return {
      runtimeToolId: snapshot.runtimeToolId,
      name: snapshot.toolName,
      title: snapshot.title ?? undefined,
      description: snapshot.description ?? undefined,
      inputSchema:
        snapshot.inputSchema ?? {
          type: 'object',
          properties: {},
          additionalProperties: true,
        },
      outputSchema: snapshot.outputSchema ?? undefined,
      annotations: snapshot.annotations ?? undefined,
      serverId: snapshot.serverId,
      serverName: snapshot.serverName,
      capability: {
        capabilityKinds: ['mcp.tool'],
        safety: {
          level:
            policy.sideEffectClass === 'read_only'
              ? 'read'
              : policy.sideEffectClass === 'irreversible_write'
                ? 'destructive'
                : 'external',
          requiresConfirmation: policy.requiresApproval,
          reasons: ['MCP_TOOL_POLICY'],
        },
        tags: ['mcp'],
        source: snapshot.annotations ? 'annotations' : 'default',
        confidence: snapshot.annotations ? 1 : 0,
      },
    };
  }

  private allowed(snapshot: any): boolean {
    return this.passesToolFilter(
      snapshot.toolName,
      snapshot.installation?.server?.allowedToolNames,
      snapshot.installation?.server?.deniedToolNames,
    )
      && this.passesToolFilter(
        snapshot.toolName,
        snapshot.installation?.allowedToolNames,
        snapshot.installation?.deniedToolNames,
      );
  }

  private passesToolFilter(
    toolName: string,
    allowedValue: unknown,
    deniedValue: unknown,
  ): boolean {
    const allowed = this.stringArray(allowedValue);
    const denied = this.stringArray(deniedValue);
    if (denied.includes(toolName)) return false;
    return allowed.length === 0 || allowed.includes(toolName);
  }

  private async listEligibleUserSnapshots(
    input: { userId: string; agentId: string },
    filter: { runtimeToolIds?: string[] } = {},
  ): Promise<Array<{ snapshot: any; installation: any }>> {
    if (!(await this.mcpGloballyEnabled(input.userId))) return [];

    await this.runtime.restoreEnabledConnections(input.userId);
    await this.runtime.synchronizePendingChanges(input.userId);

    const runtimeToolIds = [...new Set(
      (filter.runtimeToolIds ?? [])
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    )];
    const snapshots = await this.db.mcpToolSnapshot.findMany({
      where: {
        status: 'available',
        ...(runtimeToolIds.length
          ? { runtimeToolId: { in: runtimeToolIds } }
          : {}),
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
              {
                source: 'SYSTEM',
                visibility: 'PUBLIC',
                reviewStatus: 'approved',
              },
              { source: 'USER', ownerUserId: input.userId },
            ],
          },
        },
      },
      include: {
        installation: { include: { server: true } },
      },
      orderBy: [{ serverName: 'asc' }, { toolName: 'asc' }],
    });

    return snapshots.flatMap((snapshot: any) =>
      this.allowed(snapshot)
        ? [{ snapshot, installation: snapshot.installation }]
        : [],
    );
  }

  private providerKey(installation: any): string {
    const server = installation?.server ?? {};
    return String(
      server.stableKey
      ?? server.name
      ?? `mcp-${server.id ?? installation?.id ?? 'provider'}`,
    );
  }

  private previewDescription(value: unknown): string {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    return text.length <= 180 ? text : `${text.slice(0, 177)}...`;
  }

  private searchScore(snapshot: any, query: string): number {
    const normalizedQuery = this.normalizeSearchText(query);
    if (!normalizedQuery) return 1;
    const terms = [...new Set(normalizedQuery.split(' ').filter(Boolean))];
    const name = this.normalizeSearchText(snapshot.toolName);
    const title = this.normalizeSearchText(snapshot.title);
    const description = this.normalizeSearchText(snapshot.description);
    const schemaKeys = this.normalizeSearchText(
      Object.keys(this.record(this.record(snapshot.inputSchema).properties)).join(' '),
    );
    const haystack = `${name} ${title} ${description} ${schemaKeys}`;
    let score = 0;
    if (name === normalizedQuery) score += 100;
    if (name.includes(normalizedQuery)) score += 40;
    for (const term of terms) {
      if (name.includes(term)) score += 12;
      if (title.includes(term)) score += 8;
      if (description.includes(term)) score += 4;
      if (schemaKeys.includes(term)) score += 3;
      if (haystack.includes(term)) score += 1;
    }
    return score;
  }

  private normalizeSearchText(value: unknown): string {
    return String(value ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_.:-]+/gu, ' ')
      .trim();
  }

  private discoveryLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return MCP_DISCOVERY_DEFAULT_TOOLS;
    return Math.max(1, Math.min(Math.trunc(parsed), MCP_DISCOVERY_MAX_TOOLS));
  }

  private requiredText(value: unknown, code: string): string {
    const text = String(value ?? '').trim();
    if (!text) throw new ToolError(code, code);
    return text;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private objectSchema(value: unknown): object {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as object
      : { type: 'object', properties: {}, additionalProperties: true };
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
      : [];
  }

  private policy(snapshot: any): {
    sideEffectClass: ToolSideEffectClass;
    riskLevel: ToolRiskLevel;
    requiresApproval: boolean;
    idempotency: 'optional' | 'required';
  } {
    const serverPolicy =
      snapshot.installation.server.toolPolicy &&
      typeof snapshot.installation.server.toolPolicy === 'object' &&
      !Array.isArray(snapshot.installation.server.toolPolicy)
        ? snapshot.installation.server.toolPolicy[snapshot.toolName]
        : undefined;
    const trustedPolicy =
      snapshot.installation.server.source === 'SYSTEM' &&
      snapshot.installation.server.reviewStatus === 'approved';
    const explicit =
      serverPolicy &&
      typeof serverPolicy === 'object' &&
      !Array.isArray(serverPolicy)
        ? (serverPolicy as Record<string, unknown>)
        : {};
    const explicitRisk = ['low', 'medium', 'high'].includes(
      String(explicit.riskLevel),
    )
      ? (String(explicit.riskLevel) as ToolRiskLevel)
      : null;
    const explicitSideEffect = [
      'none',
      'read_only',
      'reversible_write',
      'irreversible_write',
      'external_effect',
    ].includes(String(explicit.sideEffectClass))
      ? (String(explicit.sideEffectClass) as ToolSideEffectClass)
      : null;

    if (trustedPolicy && explicitRisk && explicitSideEffect) {
      return {
        sideEffectClass: explicitSideEffect,
        riskLevel: explicitRisk,
        requiresApproval: explicit.requiresApproval !== false,
        idempotency:
          explicit.idempotency === 'optional' ? 'optional' : 'required',
      };
    }

    const annotations =
      snapshot.annotations &&
      typeof snapshot.annotations === 'object' &&
      !Array.isArray(snapshot.annotations)
        ? (snapshot.annotations as Record<string, unknown>)
        : {};
    if (annotations.destructiveHint === true) {
      return {
        sideEffectClass: 'irreversible_write',
        riskLevel: 'high',
        requiresApproval: true,
        idempotency: 'required',
      };
    }
    if (annotations.readOnlyHint === true) {
      return {
        sideEffectClass: 'read_only',
        riskLevel: 'low',
        requiresApproval: false,
        idempotency: 'optional',
      };
    }
    return {
      sideEffectClass: 'external_effect',
      riskLevel: 'medium',
      requiresApproval: true,
      idempotency: 'required',
    };
  }

  private async mcpGloballyEnabled(userId: string): Promise<boolean> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { mcpGloballyEnabled: true },
    });
    return user?.mcpGloballyEnabled ?? true;
  }

  private errorText(content: unknown[]): string {
    for (const item of content) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const text = (item as Record<string, unknown>).text;
        if (typeof text === 'string' && text.trim()) return text.trim();
      }
    }
    return 'MCP tool returned an error.';
  }
}
