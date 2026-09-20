import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class UserVoiceAssetRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    userId: string;
    providerKey: string;
    externalVoiceId: string;
    displayName: string;
    sourceObjectId: string;
    consentVersion: string;
    requiresVerification: boolean;
    status: 'ready' | 'verification_required';
    statusReason?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const metadata = (input.metadata ?? {}) as Prisma.InputJsonValue;
    return this.prisma.userVoiceAsset.upsert({
      where: {
        userId_providerKey_externalVoiceId: {
          userId: input.userId,
          providerKey: input.providerKey,
          externalVoiceId: input.externalVoiceId,
        },
      },
      create: {
        userId: input.userId,
        providerKey: input.providerKey,
        externalVoiceId: input.externalVoiceId,
        displayName: input.displayName,
        sourceObjectId: input.sourceObjectId,
        consentVersion: input.consentVersion,
        requiresVerification: input.requiresVerification,
        status: input.status,
        statusReason: input.statusReason ?? null,
        metadata,
      },
      update: {
        displayName: input.displayName,
        sourceObjectId: input.sourceObjectId,
        consentVersion: input.consentVersion,
        requiresVerification: input.requiresVerification,
        status: input.status,
        statusReason: input.statusReason ?? null,
        metadata,
        deletedAt: null,
      },
    });
  }

  async resolveUsableExternalVoiceId(userId: string, providerKey: string, value: string): Promise<string> {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '';
    const asset = await this.prisma.userVoiceAsset.findFirst({
      where: {
        userId,
        providerKey,
        deletedAt: null,
        OR: [{ id: normalized }, { externalVoiceId: normalized }],
      },
    });
    if (!asset) return normalized;
    if (asset.status !== 'ready') {
      throw new BadRequestException(asset.statusReason || 'VOICE_ASSET_NOT_READY');
    }
    return asset.externalVoiceId;
  }

  list(userId: string, providerKey?: string) {
    return this.prisma.userVoiceAsset.findMany({
      where: { userId, deletedAt: null, ...(providerKey ? { providerKey } : {}) },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async softDelete(userId: string, id: string) {
    return this.prisma.userVoiceAsset.updateMany({
      where: { userId, id, deletedAt: null },
      data: { deletedAt: new Date(), status: 'deleted', statusReason: 'USER_DELETED' },
    });
  }
}
