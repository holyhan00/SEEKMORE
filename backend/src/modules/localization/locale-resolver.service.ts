import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  normalizeLanguageTag,
  normalizeTimeZone,
} from './locale-normalizer';
import {
  DEFAULT_FORMAT_LOCALE,
  DEFAULT_TIME_ZONE,
  type ClientLocaleSnapshot,
  type ResolvedLocaleContext,
} from './locale.types';

@Injectable()
export class LocaleResolverService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async resolveForTurn(input: {
    userId: string;
    conversationId: string;
    client?: ClientLocaleSnapshot | null;
  }): Promise<ResolvedLocaleContext> {
    const client = input.client ?? null;

    const language =
      normalizeLanguageTag(client?.language);

    const formatLocale =
      normalizeLanguageTag(client?.formatLocale)
      ?? DEFAULT_FORMAT_LOCALE;

    const timeZone =
      normalizeTimeZone(client?.timeZone)
      ?? DEFAULT_TIME_ZONE;

    await this.rememberConversationLocale({
      userId: input.userId,
      conversationId: input.conversationId,
      formatLocale,
      timeZone,
    });

    return {
      language,
      formatLocale,
      timeZone,
    };
  }

  async resolveForBackground(input: {
    conversationId: string;
    timeZone?: string | null;
  }): Promise<ResolvedLocaleContext> {
    const conversationSettings =
      await this.conversationLocale(input.conversationId);

    const formatLocale =
      normalizeLanguageTag(conversationSettings?.formatLocale)
      ?? DEFAULT_FORMAT_LOCALE;

    const timeZone =
      normalizeTimeZone(input.timeZone)
      ?? normalizeTimeZone(conversationSettings?.timeZone)
      ?? DEFAULT_TIME_ZONE;

    return {
      language: null,
      formatLocale,
      timeZone,
    };
  }


  private conversationLocale(conversationId: string) {
    return this.prisma.conversationRuntimeSetting.findUnique({
      where: { conversationId },
      select: {
        formatLocale: true,
        timeZone: true,
      },
    });
  }

  private async rememberConversationLocale(input: {
    userId: string;
    conversationId: string;
    formatLocale: string;
    timeZone: string;
  }): Promise<void> {
    const formatLocale = normalizeLanguageTag(input.formatLocale);
    const timeZone = normalizeTimeZone(input.timeZone);
    if (!formatLocale || !timeZone) return;

    await this.prisma.conversationRuntimeSetting.upsert({
      where: {
        conversationId: input.conversationId,
      },
      create: {
        conversationId: input.conversationId,
        userId: input.userId,
        formatLocale,
        timeZone,
      },
      update: {
        formatLocale,
        timeZone,
      },
    });
  }
}
