import { Injectable } from '@nestjs/common';
import { SkillVersionPolicy, SkillVersionStatus } from '@prisma/client';
import { SkillRepository } from '../persistence/skill.repository';

interface ParsedVersion { major: number; minor: number; patch: number; }

@Injectable()
export class SkillVersionResolverService {
  constructor(private readonly repository: SkillRepository) {}

  async forBinding(binding: { skillId: string; versionPolicy: SkillVersionPolicy; pinnedVersionId: string | null; versionConstraint: string | null }, currentVersionId: string | null) {
    if (binding.versionPolicy === SkillVersionPolicy.PINNED && binding.pinnedVersionId) {
      return this.repository.client().skillVersion.findFirst({ where: { id: binding.pinnedVersionId, skillId: binding.skillId, status: { in: [SkillVersionStatus.PUBLISHED, SkillVersionStatus.SUPERSEDED] } } });
    }
    if (binding.versionPolicy === SkillVersionPolicy.CONSTRAINT && binding.versionConstraint) {
      const versions = await this.repository.client().skillVersion.findMany({ where: { skillId: binding.skillId, status: { in: [SkillVersionStatus.PUBLISHED, SkillVersionStatus.SUPERSEDED] } }, orderBy: { versionNumber: 'desc' } });
      return versions.find((version) => this.matches(version.versionLabel, binding.versionConstraint!)) ?? null;
    }
    return currentVersionId ? this.repository.client().skillVersion.findFirst({ where: { id: currentVersionId, status: SkillVersionStatus.PUBLISHED } }) : null;
  }

  private matches(versionLabel: string, rawConstraint: string): boolean {
    const version = this.parse(versionLabel);
    const constraint = rawConstraint.trim();
    const operator = constraint.match(/^(>=|<=|>|<|\^|~|=)?/)?.[0] ?? '';
    const wanted = this.parse(constraint.slice(operator.length));
    if (!version || !wanted) return versionLabel === rawConstraint;
    const comparison = this.compare(version, wanted);
    if (operator === '>=') return comparison >= 0;
    if (operator === '>') return comparison > 0;
    if (operator === '<=') return comparison <= 0;
    if (operator === '<') return comparison < 0;
    if (operator === '^') return version.major === wanted.major && comparison >= 0;
    if (operator === '~') return version.major === wanted.major && version.minor === wanted.minor && comparison >= 0;
    return comparison === 0;
  }

  private parse(value: string): ParsedVersion | null {
    const match = value.trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return null;
    return { major: Number(match[1]), minor: Number(match[2] ?? 0), patch: Number(match[3] ?? 0) };
  }

  private compare(left: ParsedVersion, right: ParsedVersion): number {
    return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
  }
}
