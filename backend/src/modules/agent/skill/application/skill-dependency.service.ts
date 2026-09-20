import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ReplaceSkillDependenciesDto } from '../api/dto/skill.dto';
import { SkillAccessService } from './skill-access.service';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillAuditService } from '../usage/skill-audit.service';

@Injectable()
export class SkillDependencyService {
  constructor(private readonly repository: SkillRepository, private readonly access: SkillAccessService, private readonly audit: SkillAuditService) {}

  async get(userId: string, skillId: string, versionId: string) {
    await this.access.readable(userId, skillId);
    const version = await this.repository.client().skillVersion.findFirst({ where: { id: versionId, skillId }, include: { dependencies: { include: { dependencySkill: true } }, toolBindings: true, mcpBindings: true } });
    if (!version) throw new NotFoundException('SKILL_VERSION_NOT_FOUND');
    return { skillDependencies: version.dependencies, toolDependencies: version.toolBindings, mcpDependencies: version.mcpBindings };
  }

  async replace(userId: string, skillId: string, versionId: string, dto: ReplaceSkillDependenciesDto) {
    await this.access.manageable(userId, skillId);
    await this.repository.transaction(async (tx) => {
      const version = await tx.skillVersion.findFirst({ where: { id: versionId, skillId, status: 'DRAFT' } });
      if (!version) throw new NotFoundException('SKILL_DRAFT_VERSION_NOT_FOUND');
      const skillDeps = dto.skillDependencies ?? [];
      const keys = [...new Set(skillDeps.map((item) => item.key.trim()).filter(Boolean))];
      if (keys.length !== skillDeps.length) throw new BadRequestException('DUPLICATE_OR_EMPTY_SKILL_DEPENDENCY');
      if (keys.includes(skillId)) throw new BadRequestException('SKILL_SELF_DEPENDENCY_NOT_ALLOWED');
      const dependencySkills = keys.length ? await tx.skill.findMany({ where: { id: { in: keys }, deletedAt: null }, select: { id: true } }) : [];
      if (dependencySkills.length !== keys.length) throw new NotFoundException('SKILL_DEPENDENCY_NOT_FOUND');
      await this.assertNoCycle(tx, skillId, keys);
      await Promise.all([
        tx.skillDependency.deleteMany({ where: { skillVersionId: versionId } }),
        tx.skillToolBinding.deleteMany({ where: { skillVersionId: versionId } }),
        tx.skillMcpBinding.deleteMany({ where: { skillVersionId: versionId } }),
      ]);
      if (skillDeps.length) await tx.skillDependency.createMany({ data: skillDeps.map((item) => ({ skillVersionId: versionId, dependencySkillId: item.key, versionConstraint: item.versionConstraint ?? null, required: item.required ?? true, reason: item.reason ?? null })) });
      if (dto.toolDependencies?.length) await tx.skillToolBinding.createMany({ data: dto.toolDependencies.map((item) => ({ skillVersionId: versionId, toolName: item.key.trim(), versionConstraint: item.versionConstraint ?? null, required: item.required ?? true })) });
      if (dto.mcpDependencies?.length) await tx.skillMcpBinding.createMany({ data: dto.mcpDependencies.map((item) => { const [serverName, toolName] = item.key.split('/', 2).map((part) => part.trim()); if (!serverName) throw new BadRequestException('MCP_DEPENDENCY_SERVER_REQUIRED'); return { skillVersionId: versionId, serverName, toolName: toolName || null, required: item.required ?? true }; }) });
      await tx.skillVersion.update({ where: { id: versionId }, data: { revision: { increment: 1 } } });
      await this.audit.write({ skillId, skillVersionId: versionId, actorUserId: userId, eventType: 'skill.dependencies.replaced', afterData: dto }, tx);
    });
    return this.get(userId, skillId, versionId);
  }

  private async assertNoCycle(tx: Prisma.TransactionClient, rootSkillId: string, proposed: string[]): Promise<void> {
    const queue = [...proposed];
    const visited = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      if (current === rootSkillId) throw new BadRequestException('SKILL_DEPENDENCY_CYCLE');
      if (visited.has(current)) continue;
      visited.add(current);
      if (visited.size > 500) throw new BadRequestException('SKILL_DEPENDENCY_GRAPH_TOO_LARGE');
      const version = await tx.skill.findUnique({ where: { id: current }, select: { currentVersionId: true } });
      if (!version?.currentVersionId) continue;
      const children = await tx.skillDependency.findMany({ where: { skillVersionId: version.currentVersionId }, select: { dependencySkillId: true } });
      queue.push(...children.map((child) => child.dependencySkillId));
    }
  }
}
