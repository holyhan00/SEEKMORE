import { randomUUID } from 'crypto';
import { isMap, parseDocument } from 'yaml';

import {
  AGENT_SKILL_NAME_PATTERN,
  type ParsedSkillDocument,
} from './skill-document.types';

const DISPLAY_NAME_MAX_LENGTH = 120;
const INTERNAL_NAME_MAX_LENGTH = 64;
const PLACEHOLDER_NAMES = new Set([
  'example-skill',
  'skill-draft',
  'new-skill',
]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;

export interface ResolvedSkillIdentity {
  displayName: string;
  internalName: string;
  skillMarkdown: string;
  rewritten: boolean;
}

export function createSkillInternalName(): string {
  return `skill-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function isStandardSkillInternalName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= INTERNAL_NAME_MAX_LENGTH &&
    AGENT_SKILL_NAME_PATTERN.test(value)
  );
}

export function normalizeSkillDisplayName(
  value: string,
  fallback: string,
): string {
  const normalized = String(value || fallback || '')
    .trim()
    .replace(/\s+/gu, ' ');

  if (!normalized) {
    throw new Error('SKILL_DISPLAY_NAME_REQUIRED');
  }

  if (
    normalized.length > DISPLAY_NAME_MAX_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error('SKILL_DISPLAY_NAME_INVALID');
  }

  return normalized;
}

export function deriveSkillDisplayName(
  parsed: ParsedSkillDocument,
  explicitDisplayName?: string | null,
): string {
  const originalName = String(parsed.manifest.name ?? '').trim();
  const heading = firstHeading(parsed.bodyRaw);

  return normalizeSkillDisplayName(
    explicitDisplayName ?? '',
    heading || originalName || 'Skill',
  );
}

export function resolveSkillIdentity(input: {
  parsed: ParsedSkillDocument;
  skillMarkdown: string;
  displayName?: string | null;
  preferredInternalName?: string | null;
}): ResolvedSkillIdentity {
  const originalName = String(input.parsed.manifest.name ?? '').trim();
  const displayName = deriveSkillDisplayName(
    input.parsed,
    input.displayName,
  );

  const preferredInternalName = String(
    input.preferredInternalName ?? '',
  ).trim();

  const internalName = isStandardSkillInternalName(preferredInternalName)
    ? preferredInternalName
    : isStandardSkillInternalName(originalName) &&
        !PLACEHOLDER_NAMES.has(originalName)
      ? originalName
      : createSkillInternalName();

  if (internalName === originalName) {
    return {
      displayName,
      internalName,
      skillMarkdown: input.skillMarkdown,
      rewritten: false,
    };
  }

  return {
    displayName,
    internalName,
    skillMarkdown: rewriteFrontmatterName(
      input.parsed,
      internalName,
    ),
    rewritten: true,
  };
}

function firstHeading(body: string): string {
  const match = /^\s*#\s+(.+?)\s*$/mu.exec(body);
  return String(match?.[1] ?? '')
    .replace(/[*_`~]/g, '')
    .trim();
}

function rewriteFrontmatterName(
  parsed: ParsedSkillDocument,
  internalName: string,
): string {
  const document = parseDocument(parsed.frontmatterRaw, {
    prettyErrors: false,
    uniqueKeys: true,
    strict: true,
    schema: 'core',
  });

  if (!isMap(document.contents)) {
    throw new Error('SKILL_FRONTMATTER_MAPPING_REQUIRED');
  }

  document.set('name', internalName);

  const newline = parsed.rawMarkdown.includes('\r\n') ? '\r\n' : '\n';
  const serialized = String(document).trimEnd();

  return [
    '---',
    serialized,
    '---',
    parsed.bodyRaw,
  ].join(newline);
}
