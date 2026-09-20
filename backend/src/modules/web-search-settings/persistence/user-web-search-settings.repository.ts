import { Injectable } from '@nestjs/common';
import type { LlmCredentialStatus } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class UserWebSearchSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  get(userId: string) {
    return this.prisma.userWebSearchSetting.findUnique({ where: { userId } });
  }

  save(input: {
    userId: string;
    providerKey: string;
    apiKey: string;
    keyHint: string;
    status: LlmCredentialStatus;
    verifiedAt: Date | null;
    lastValidationCode: string;
  }) {
    return this.prisma.userWebSearchSetting.upsert({
      where: { userId: input.userId },
      create: input,
      update: {
        providerKey: input.providerKey,
        apiKey: input.apiKey,
        keyHint: input.keyHint,
        status: input.status,
        verifiedAt: input.verifiedAt,
        lastValidationCode: input.lastValidationCode,
      },
    });
  }

  async remove(userId: string): Promise<void> {
    await this.prisma.userWebSearchSetting.deleteMany({ where: { userId } });
  }
}
