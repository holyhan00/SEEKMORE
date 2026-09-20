import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SkillQueryNormalizerService } from './skill-query-normalizer.service';

export type RoutableSkill = {
  id: string;
  name: string;
  slug: string;
  displayName: string;
  description: string;
  activationDescription: string;
  category: string | null;
  tags: string[];
  pinned: boolean;
  trustLevel: 'BUILTIN' | 'TRUSTED' | 'COMMUNITY' | 'USER';
  currentVersion: {
    id: string;
    versionLabel: string;
    routingProfile: Prisma.JsonValue;
  } | null;
};

@Injectable()
export class SkillKeywordRouterService {
  constructor(private readonly normalizer: SkillQueryNormalizerService) {}

  rank<T extends RoutableSkill>(query: string, skills: T[], limit: number): Array<T & { relevance: number }> {
    const normalizedQuery = this.normalizer.normalize(query);
    if (!normalizedQuery.normalized) return [];

    return skills
      .map((skill) => ({ ...skill, relevance: this.score(normalizedQuery, skill) }))
      .filter((skill) => skill.relevance > 0)
      .sort((left, right) =>
        right.relevance - left.relevance ||
        Number(right.pinned) - Number(left.pinned) ||
        left.displayName.localeCompare(right.displayName),
      )
      .slice(0, Math.max(0, limit));
  }

  private score(
    query: ReturnType<SkillQueryNormalizerService['normalize']>,
    skill: RoutableSkill,
  ): number {
    const name = this.normalizer.normalize(`${skill.name} ${skill.slug} ${skill.displayName}`);
    const description = this.normalizer.normalize(
      `${skill.description} ${skill.activationDescription} ${skill.category ?? ''} ${skill.tags.join(' ')}`,
    );
    const profile = this.profile(skill.currentVersion?.routingProfile);

    let score = 0;
    if (name.normalized && query.normalized.includes(name.normalized)) score += 1;
    if (name.phrases.some((phrase) => phrase.length > 1 && query.normalized.includes(phrase))) score += 0.8;

    const queryTokens = new Set(query.tokens);
    const nameHits = name.tokens.filter((token) => queryTokens.has(token)).length;
    const descriptionHits = description.tokens.filter((token) => queryTokens.has(token)).length;
    score += Math.min(0.8, nameHits * 0.18);
    score += Math.min(0.55, descriptionHits * 0.07);

    for (const alias of profile.aliases) {
      const term = this.normalizer.normalize(alias).normalized;
      if (!term) continue;
      if (query.normalized === term) score += 1;
      else if (query.normalized.includes(term)) score += 0.75;
    }
    for (const weighted of profile.positiveTerms) {
      const term = this.normalizer.normalize(weighted.term).normalized;
      if (term && query.normalized.includes(term)) score += this.weight(weighted.weight, 0.15, 1);
    }
    for (const weighted of profile.negativeTerms) {
      const term = this.normalizer.normalize(weighted.term).normalized;
      if (term && query.normalized.includes(term)) score -= this.weight(weighted.weight, 0.15, 1.2);
    }

    const extensionMatches = profile.fileExtensions.filter((extension) => {
      const normalized = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
      return query.normalized.includes(normalized);
    }).length;
    score += Math.min(0.5, extensionMatches * 0.25);

    const toolMatches = profile.toolNames.filter((nameValue) =>
      query.normalized.includes(String(nameValue).normalize('NFKC').toLowerCase()),
    ).length;
    score += Math.min(0.35, toolMatches * 0.18);

    if (skill.pinned) score += 0.04;
    return Math.max(0, Math.min(1, Number(score.toFixed(4))));
  }

  private profile(value: Prisma.JsonValue | undefined): {
    aliases: string[];
    positiveTerms: Array<{ term: string; weight: number }>;
    negativeTerms: Array<{ term: string; weight: number }>;
    toolNames: string[];
    fileExtensions: string[];
  } {
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const strings = (candidate: unknown) => Array.isArray(candidate)
      ? candidate.map(String).map((item) => item.trim()).filter(Boolean)
      : [];
    const weighted = (candidate: unknown) => Array.isArray(candidate)
      ? candidate.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const row = item as Record<string, unknown>;
          const term = String(row.term ?? '').trim();
          const weight = Number(row.weight ?? 0.7);
          return term ? [{ term, weight: Number.isFinite(weight) ? weight : 0.7 }] : [];
        })
      : [];
    return {
      aliases: strings(record.aliases),
      positiveTerms: weighted(record.positiveTerms),
      negativeTerms: weighted(record.negativeTerms),
      toolNames: strings(record.toolNames),
      fileExtensions: strings(record.fileExtensions),
    };
  }

  private weight(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0.7));
  }
}
