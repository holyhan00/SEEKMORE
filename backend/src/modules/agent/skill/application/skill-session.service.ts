import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SkillSecurityState, SkillStatus, SkillVersionStatus } from '@prisma/client';
import type { ReplaceConversationSkillsDto } from '../api/dto/skill.dto';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillAccessService } from './skill-access.service';

@Injectable()
export class SkillSessionService {
  constructor(private readonly repository: SkillRepository, private readonly access: SkillAccessService) {}

  async list(userId: string, conversationId: string) {
    await this.assertConversation(userId, conversationId);
    return this.repository.client().conversationSkillActivation.findMany({
      where: { conversationId },
      include: { skill: { include: { currentVersion: true } }, selectedVersion: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async replace(userId: string, conversationId: string, dto: ReplaceConversationSkillsDto) {
    await this.assertConversation(userId, conversationId);
    const unique = new Map(dto.activations.map((item) => [item.skillId, item]));
    if (unique.size !== dto.activations.length) throw new ForbiddenException('DUPLICATE_CONVERSATION_SKILL');
    for (const activation of dto.activations) {
      const skill = await this.access.readable(userId, activation.skillId);
      if (activation.enabled && (skill.status !== SkillStatus.ACTIVE || skill.securityState !== SkillSecurityState.CLEAR)) {
        throw new ForbiddenException({ code: 'ENABLED_SESSION_SKILL_MUST_BE_ACTIVE_AND_CLEAR', message: 'ENABLED_SESSION_SKILL_MUST_BE_ACTIVE_AND_CLEAR', params: { skillId: activation.skillId } });
      }
      if (activation.selectedVersionId) {
        const version = await this.repository.client().skillVersion.findFirst({
          where: {
            id: activation.selectedVersionId,
            skillId: activation.skillId,
            status: { in: [SkillVersionStatus.PUBLISHED, SkillVersionStatus.SUPERSEDED] },
          },
        });
        if (!version) throw new ForbiddenException({ code: 'SESSION_SKILL_VERSION_INVALID', message: 'SESSION_SKILL_VERSION_INVALID', params: { skillId: activation.skillId } });
      }
    }
    await this.repository.transaction(async (tx) => {
      const ids = [...unique.keys()];
      await tx.conversationSkillActivation.deleteMany({ where: { conversationId, skillId: { notIn: ids.length ? ids : ['__none__'] } } });
      for (const activation of dto.activations) {
        await tx.conversationSkillActivation.upsert({
          where: { conversationId_skillId: { conversationId, skillId: activation.skillId } },
          create: {
            conversationId,
            skillId: activation.skillId,
            activationMode: activation.activationMode,
            enabled: activation.enabled,
            priority: activation.priority ?? 0,
            selectedVersionId: activation.selectedVersionId ?? null,
            config: (activation.config ?? {}) as Prisma.InputJsonValue,
            createdByUserId: userId,
            expiresAt: activation.expiresAt ? new Date(activation.expiresAt) : null,
          },
          update: {
            activationMode: activation.activationMode,
            enabled: activation.enabled,
            priority: activation.priority ?? 0,
            selectedVersionId: activation.selectedVersionId ?? null,
            config: (activation.config ?? {}) as Prisma.InputJsonValue,
            expiresAt: activation.expiresAt ? new Date(activation.expiresAt) : null,
          },
        });
      }
    });
    return this.list(userId, conversationId);
  }

  private async assertConversation(userId: string, conversationId: string) {
    const conversation = await this.repository.client().conversation.findFirst({ where: { id: conversationId, userId, deletedAt: null } });
    if (!conversation) throw new NotFoundException('CONVERSATION_NOT_FOUND');
    return conversation;
  }
}
