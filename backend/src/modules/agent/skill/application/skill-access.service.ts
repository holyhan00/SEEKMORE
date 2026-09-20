import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SeekmoreEntityType, Prisma } from '@prisma/client';
import { SkillRepository, type SkillDbClient } from '../persistence/skill.repository';

@Injectable()
export class SkillAccessService {
  constructor(private readonly repository: SkillRepository) {}

  async readable(userId: string, skillId: string, client?: SkillDbClient) {
    const skill = await this.repository.findAccessibleSkill(userId, skillId, client);
    if (!skill) throw new NotFoundException('SKILL_NOT_FOUND_OR_INACCESSIBLE');
    return skill;
  }

  async manageable(userId: string, skillId: string, client?: SkillDbClient) {
    const skill = await this.repository.findManageableSkill(userId, skillId, client);
    if (!skill) throw new ForbiddenException('SKILL_MANAGE_PERMISSION_REQUIRED');
    return skill;
  }

  async deletedOwner(userId: string, skillId: string, client?: SkillDbClient) {
    const skill = await this.repository.findDeletedOwnedSkill(userId, skillId, client);
    if (!skill) throw new NotFoundException('SKILL_DELETED_NOT_FOUND_OR_EXPIRED');
    return skill;
  }

  async cognitiveOwner(userId: string, agentId: string, client: SkillDbClient = this.repository.client()) {
    const agent = await client.agent.findFirst({
      where: { id: agentId, entityType: SeekmoreEntityType.COGNITIVE, deletedAt: null },
      include: { userAgents: { where: { userId, deletedAt: null }, select: { accessLevel: true } } },
    });
    if (!agent) throw new NotFoundException('COGNITIVE_AGENT_NOT_FOUND');
    const owner = agent.userId === userId || agent.userAgents.some((item) => item.accessLevel === 'OWNER');
    if (!owner) throw new ForbiddenException('COGNITIVE_AGENT_OWNER_REQUIRED');
    return agent;
  }

  async cognitiveReadable(userId: string, agentId: string) {
    const agent = await this.repository.client().agent.findFirst({
      where: {
        id: agentId,
        entityType: SeekmoreEntityType.COGNITIVE,
        deletedAt: null,
        OR: [{ userId }, { userAgents: { some: { userId, deletedAt: null } } }],
      },
    });
    if (!agent) throw new NotFoundException('COGNITIVE_AGENT_NOT_FOUND_OR_INACCESSIBLE');
    return agent;
  }

  json(value: unknown): Prisma.InputJsonValue {
    if (!value || typeof value !== 'object') return {};
    return value as Prisma.InputJsonValue;
  }
}
