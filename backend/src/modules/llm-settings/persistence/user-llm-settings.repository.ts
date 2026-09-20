import { Injectable } from '@nestjs/common';
import type { LlmCredentialStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { AiSelectionRole } from '../contracts/llm-settings.types';

type UserLlmPreferenceRoleData = {
  providerKey?: string;
  modelKey?: string;
  visionProviderKey?: string | null;
  visionModelKey?: string | null;
  imageProviderKey?: string | null;
  imageModelKey?: string | null;
  audioProviderKey?: string | null;
  videoProviderKey?: string | null;
  videoModelKey?: string | null;
};

@Injectable()
export class UserLlmSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  preferences() {
    return this.prisma.userLlmPreference.findMany();
  }

  preference(userId: string) {
    return this.prisma.userLlmPreference.findUnique({ where: { userId } });
  }

  credential(userId: string, providerKey: string) {
    return this.prisma.userLlmCredential.findUnique({
      where: { userId_providerKey: { userId, providerKey } },
    });
  }

  credentials(userId: string) {
    return this.prisma.userLlmCredential.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async settings(userId: string) {
    const [preference, credentials] = await Promise.all([
      this.preference(userId),
      this.credentials(userId),
    ]);
    return { preference, credentials };
  }

  async saveRole(input: {
    userId: string;
    role: AiSelectionRole;
    providerKey: string;
    modelKey?: string;
    apiKey: string;
    keyHint: string;
    status: LlmCredentialStatus;
    verifiedAt: Date | null;
    lastValidationCode: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const credential = await tx.userLlmCredential.upsert({
        where: {
          userId_providerKey: {
            userId: input.userId,
            providerKey: input.providerKey,
          },
        },
        create: {
          userId: input.userId,
          providerKey: input.providerKey,
          apiKey: input.apiKey,
          keyHint: input.keyHint,
          status: input.status,
          verifiedAt: input.verifiedAt,
          lastValidationCode: input.lastValidationCode,
        },
        update: {
          apiKey: input.apiKey,
          keyHint: input.keyHint,
          status: input.status,
          verifiedAt: input.verifiedAt,
          lastValidationCode: input.lastValidationCode,
        },
      });

      const modelKey = String(input.modelKey ?? '');
      const roleData = this.roleData(input.role, input.providerKey, modelKey);
      const preference = await tx.userLlmPreference.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          providerKey: input.role === 'primary' ? input.providerKey : '',
          modelKey: input.role === 'primary' ? modelKey : '',
          ...roleData,
        },
        update: roleData,
      });

      return { preference, credential };
    });
  }

  async selectRoleWithExistingCredential(input: {
    userId: string;
    role: AiSelectionRole;
    providerKey: string;
    modelKey?: string;
  }) {
    const modelKey = String(input.modelKey ?? '');
    const roleData = this.roleData(input.role, input.providerKey, modelKey);
    return this.prisma.userLlmPreference.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        providerKey: input.role === 'primary' ? input.providerKey : '',
        modelKey: input.role === 'primary' ? modelKey : '',
        ...roleData,
      },
      update: roleData,
    });
  }

  async clearRole(userId: string, role: Exclude<AiSelectionRole, 'primary'>) {
    const data = role === 'vision'
      ? { visionProviderKey: null, visionModelKey: null }
      : role === 'image_generation'
        ? { imageProviderKey: null, imageModelKey: null }
        : role === 'video_generation'
          ? { videoProviderKey: null, videoModelKey: null }
          : { audioProviderKey: null };
    return this.prisma.userLlmPreference.updateMany({ where: { userId }, data });
  }

  async updateValidation(input: {
    userId: string;
    providerKey: string;
    status: LlmCredentialStatus;
    verifiedAt: Date | null;
    lastValidationCode: string;
  }) {
    return this.prisma.userLlmCredential.update({
      where: {
        userId_providerKey: {
          userId: input.userId,
          providerKey: input.providerKey,
        },
      },
      data: {
        status: input.status,
        verifiedAt: input.verifiedAt,
        lastValidationCode: input.lastValidationCode,
      },
    });
  }

  async deleteCredential(userId: string, providerKey: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const preference = await tx.userLlmPreference.findUnique({ where: { userId } });
      if (preference) {
        const data: Prisma.UserLlmPreferenceUpdateInput = {};
        if (preference.visionProviderKey === providerKey) {
          data.visionProviderKey = null;
          data.visionModelKey = null;
        }
        if (preference.imageProviderKey === providerKey) {
          data.imageProviderKey = null;
          data.imageModelKey = null;
        }
        if (preference.audioProviderKey === providerKey) {
          data.audioProviderKey = null;
        }
        if (preference.videoProviderKey === providerKey) {
          data.videoProviderKey = null;
          data.videoModelKey = null;
        }
        if (preference.providerKey === providerKey) {
          await tx.userLlmPreference.delete({ where: { userId } });
        } else if (Object.keys(data).length > 0) {
          await tx.userLlmPreference.update({ where: { userId }, data });
        }
      }
      await tx.userLlmCredential.deleteMany({ where: { userId, providerKey } });
    });
  }

  private roleData(
    role: AiSelectionRole,
    providerKey: string,
    modelKey: string,
  ): UserLlmPreferenceRoleData {
    if (role === 'vision') {
      return { visionProviderKey: providerKey, visionModelKey: modelKey };
    }
    if (role === 'image_generation') {
      return { imageProviderKey: providerKey, imageModelKey: modelKey };
    }
    if (role === 'video_generation') {
      return { videoProviderKey: providerKey, videoModelKey: modelKey };
    }
    if (role === 'audio_generation') {
      return { audioProviderKey: providerKey };
    }
    return { providerKey, modelKey };
  }
}
