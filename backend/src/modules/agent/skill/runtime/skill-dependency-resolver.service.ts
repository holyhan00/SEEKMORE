import { Injectable } from '@nestjs/common';
import { SkillStatus, SkillVersionStatus } from '@prisma/client';
import { ToolsRegistry } from '../../../../tools/toolsregistry';
import { SkillRepository } from '../persistence/skill.repository';
import type { SkillDependencyItemStatus, SkillDependencyStatus } from '../domain/skill.types';

@Injectable()
export class SkillDependencyResolverService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly tools: ToolsRegistry,
  ) {}

  async resolve(versionId: string, context?: {
    userId?: string;
  }): Promise<SkillDependencyStatus> {
    const version = await this.repository.client().skillVersion.findUnique({
      where: { id: versionId },
      include: {
        dependencies: { include: { dependencySkill: { include: { currentVersion: true } } } },
        toolBindings: true,
        mcpBindings: true,
      },
    });
    if (!version) {
      return {
        satisfied: false,
        items: [{
          kind: 'SKILL',
          key: versionId,
          required: true,
          available: false,
          permitted: false,
          reason: 'VERSION_NOT_FOUND',
        }],
      };
    }

    const toolNames = new Set(
      this.tools.list({ enabledOnly: true }).map((tool) => tool.name),
    );
    const user = context?.userId
      ? await this.repository.client().user.findUnique({
          where: { id: context.userId },
          select: { mcpGloballyEnabled: true },
        })
      : null;
    const globallyEnabled = user?.mcpGloballyEnabled ?? true;
    const items: SkillDependencyItemStatus[] = [];

    for (const dependency of version.dependencies) {
      const available = dependency.dependencySkill.status === SkillStatus.ACTIVE
        && dependency.dependencySkill.currentVersion?.status === SkillVersionStatus.PUBLISHED;
      items.push({
        kind: 'SKILL',
        key: dependency.dependencySkillId,
        required: dependency.required,
        available,
        permitted: available,
        reason: available ? null : 'DEPENDENCY_SKILL_UNAVAILABLE',
      });
    }

    for (const dependency of version.toolBindings) {
      const available = toolNames.has(dependency.toolName);
      items.push({
        kind: 'TOOL',
        key: dependency.toolName,
        required: dependency.required,
        available,
        permitted: available,
        reason: available ? null : 'TOOL_UNAVAILABLE',
      });
    }

    for (const dependency of version.mcpBindings) {
      const server = dependency.mcpServerId
        ? await this.repository.client().mcpServerConfig.findUnique({
            where: { id: dependency.mcpServerId },
          })
        : await this.repository.client().mcpServerConfig.findFirst({
            where: {
              OR: [
                { stableKey: dependency.serverName },
                { name: dependency.serverName },
              ],
            },
          });
      const key = `${dependency.serverName}${dependency.toolName ? `/${dependency.toolName}` : ''}`;
      if (!server || !context?.userId) {
        items.push({
          kind: 'MCP',
          key,
          required: dependency.required,
          available: false,
          permitted: false,
          reason: 'MCP_NOT_INSTALLED',
        });
        continue;
      }

      const installation = await this.repository.client().mcpInstallation.findFirst({
        where: {
          userId: context.userId,
          serverId: server.id,
          status: 'installed',
          removedAt: null,
        },
        include: {
          connectionStates: { orderBy: { updatedAt: 'desc' }, take: 1 },
          toolSnapshots: dependency.toolName
            ? { where: { toolName: dependency.toolName, status: 'available' }, take: 1 }
            : { where: { status: 'available' }, take: 1 },
        },
      });

      let reason: string | null = null;
      if (!globallyEnabled) reason = 'MCP_GLOBALLY_DISABLED';
      else if (!installation) reason = 'MCP_NOT_INSTALLED';
      else if (!installation.enabled) reason = 'MCP_DISABLED';
      else if (installation.configurationState !== 'ready') reason = 'MCP_NOT_AUTHENTICATED';
      else if (installation.connectionStates[0]?.status !== 'connected') reason = 'MCP_NOT_CONNECTED';
      else if (dependency.toolName && installation.toolSnapshots.length === 0) reason = 'MCP_TOOL_NOT_FOUND';

      const available = reason === null;
      items.push({
        kind: 'MCP',
        key,
        required: dependency.required,
        available,
        permitted: available,
        reason,
      });
    }

    return {
      satisfied: items.every(
        (item) => !item.required || (item.available && item.permitted),
      ),
      items,
    };
  }
}
