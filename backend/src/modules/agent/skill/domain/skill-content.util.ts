import { createHash } from 'crypto';

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function skillPackageChecksum(
  skillMarkdown: string,
  resources: Array<{ path: string; checksum: string }>,
): string {
  return sha256([
    `SKILL.md:${sha256(skillMarkdown)}`,
    ...[...resources]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((resource) => `${resource.path}:${resource.checksum}`),
  ].join('\n'));
}

export function estimateTokens(value: string): number {
  const text = String(value ?? '');
  const chinese = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const rest = Math.max(0, text.length - chinese);
  return Math.max(1, Math.ceil(chinese * 1.2 + rest / 4));
}
