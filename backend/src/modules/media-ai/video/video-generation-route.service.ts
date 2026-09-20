import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { VIDEO_GENERATION_PROVIDER_CATALOG } from './video-provider.catalog';
import type {
  VideoGenerationAvailability,
  VideoProviderCredential,
} from './video-generation.types';

const VIDEO_PROVIDER_KEYS = new Set<string>(
  VIDEO_GENERATION_PROVIDER_CATALOG
    .filter((provider) => provider.enabled)
    .map((provider) => provider.providerKey),
);

@Injectable()
export class VideoGenerationRouteService {
  constructor(private readonly prisma: PrismaService) {}

  async availability(userId: string): Promise<VideoGenerationAvailability> {
    const selection = await this.selection(userId);
    if (!selection) {
      return {
        status: 'unavailable',
        providerKeys: [],
        reasonCode: 'VIDEO_GENERATION_MODEL_NOT_CONFIGURED',
      };
    }

    const credentials = await this.credentials(userId, selection.providerKey);
    return credentials.length > 0
      ? {
          status: 'available',
          providerKeys: [selection.providerKey],
        }
      : {
          status: 'unavailable',
          providerKeys: [],
          reasonCode: 'VIDEO_GENERATION_PROVIDER_NOT_CONFIGURED',
        };
  }

  async selection(userId: string): Promise<{
    providerKey: VideoProviderCredential['providerKey'];
    modelKey: string;
  } | null> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) return null;

    const preference = await this.prisma.userLlmPreference.findUnique({
      where: { userId: normalizedUserId },
    });
    const providerKey = String(preference?.videoProviderKey ?? '').trim();
    const modelKey = String(preference?.videoModelKey ?? '').trim();
    if (!VIDEO_PROVIDER_KEYS.has(providerKey) || !modelKey) return null;

    const provider = VIDEO_GENERATION_PROVIDER_CATALOG.find(
      (item) => item.enabled && item.providerKey === providerKey,
    );
    const model = provider?.models.find(
      (item) => item.enabled && item.modelKey === modelKey,
    );
    if (!provider || !model) return null;

    return {
      providerKey: provider.providerKey,
      modelKey: model.modelKey,
    };
  }

  async credentials(
    userId: string,
    requestedProviderKey?: string | null,
  ): Promise<VideoProviderCredential[]> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) return [];

    const requested = String(requestedProviderKey ?? '').trim();
    const selected = requested ? null : await this.selection(normalizedUserId);
    const providerKey = requested || selected?.providerKey || '';
    if (!VIDEO_PROVIDER_KEYS.has(providerKey)) return [];

    const row = await this.prisma.userLlmCredential.findUnique({
      where: {
        userId_providerKey: {
          userId: normalizedUserId,
          providerKey,
        },
      },
    });
    if (!row) return [];
    const apiKey = String(row.apiKey ?? '').trim();
    if (!apiKey || String(row.status ?? '').toUpperCase() === 'INVALID') return [];

    return [{
      providerKey: providerKey as VideoProviderCredential['providerKey'],
      apiKey,
    }];
  }
}
