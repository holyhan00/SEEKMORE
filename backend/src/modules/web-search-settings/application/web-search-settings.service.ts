import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WEB_SEARCH_PROVIDER_CATALOG } from '../contracts/web-search-provider.catalog';
import type {
  ResolvedWebSearchConfig,
  WebSearchCatalogProvider,
  WebSearchValidationResult,
} from '../contracts/web-search-settings.types';
import { UserWebSearchSettingsRepository } from '../persistence/user-web-search-settings.repository';

@Injectable()
export class WebSearchSettingsService {
  constructor(private readonly repository: UserWebSearchSettingsRepository) {}

  catalog() {
    return { providers: WEB_SEARCH_PROVIDER_CATALOG.filter((item) => item.enabled) };
  }

  async get(userId: string) {
    const row = await this.repository.get(userId);
    return {
      providerKey: row?.providerKey ?? null,
      credential: {
        configured: Boolean(row),
        keyHint: row?.keyHint ?? null,
        status: row?.status ?? null,
        verifiedAt: row?.verifiedAt?.toISOString() ?? null,
        lastValidationCode: row?.lastValidationCode ?? null,
      },
    };
  }

  async save(userId: string, input: { providerKey: string; apiKey?: string }) {
    const provider = this.provider(input.providerKey);
    if (!provider) throw new NotFoundException('WEB_SEARCH_PROVIDER_NOT_FOUND');
    const existing = await this.repository.get(userId);
    const apiKey = String(input.apiKey ?? '').trim() || String(existing?.apiKey ?? '').trim();
    if (!apiKey) throw new BadRequestException('WEB_SEARCH_API_KEY_REQUIRED');

    const validation = await this.validate(provider, apiKey);
    if (validation.status === 'INVALID') throw new BadRequestException(validation.code);
    await this.repository.save({
      userId,
      providerKey: provider.providerKey,
      apiKey,
      keyHint: apiKey.length <= 4 ? apiKey : apiKey.slice(-4),
      status: validation.status,
      verifiedAt: validation.verifiedAt,
      lastValidationCode: validation.code,
    });
    return this.get(userId);
  }

  async remove(userId: string) {
    await this.repository.remove(userId);
    return this.get(userId);
  }

  async resolveOptional(userId: string): Promise<ResolvedWebSearchConfig | null> {
    const row = await this.repository.get(String(userId ?? '').trim());
    if (!row?.apiKey) return null;
    const provider = this.provider(row.providerKey);
    if (!provider) return null;
    return {
      providerKey: provider.providerKey,
      baseUrl: provider.baseUrl,
      apiKey: row.apiKey,
    };
  }

  private provider(providerKey: string): WebSearchCatalogProvider | null {
    return WEB_SEARCH_PROVIDER_CATALOG.find(
      (item) => item.providerKey === String(providerKey ?? '').trim() && item.enabled,
    ) ?? null;
  }

  private async validate(
    provider: WebSearchCatalogProvider,
    apiKey: string,
  ): Promise<WebSearchValidationResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    (timer as unknown as { unref?: () => void }).unref?.();
    try {
      const response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ q: 'Seekmore', num: 1 }),
        signal: controller.signal,
      });
      if (response.ok) {
        return { status: 'VALID', code: 'WEB_SEARCH_CONNECTION_OK', verifiedAt: new Date() };
      }
      if (response.status === 401 || response.status === 403) {
        return { status: 'INVALID', code: 'WEB_SEARCH_API_KEY_INVALID', verifiedAt: null };
      }
      if (response.status === 429) {
        return { status: 'RATE_LIMITED', code: 'WEB_SEARCH_RATE_LIMITED', verifiedAt: new Date() };
      }
      return { status: 'UNAVAILABLE', code: 'WEB_SEARCH_PROVIDER_UNAVAILABLE', verifiedAt: null };
    } catch (error) {
      return {
        status: 'UNAVAILABLE',
        code: error instanceof Error && error.name === 'AbortError'
          ? 'WEB_SEARCH_VALIDATION_TIMEOUT'
          : 'WEB_SEARCH_PROVIDER_UNAVAILABLE',
        verifiedAt: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
