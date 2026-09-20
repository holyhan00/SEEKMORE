import { Injectable } from '@nestjs/common';
import { SkillCapabilityCatalogService } from './skill-capability-catalog.service';
import type {
  SkillCapabilityDefinition,
  SkillCapabilityPolicyInspection,
  SkillCapabilityResolution,
} from './skill-capability.types';

interface RawRequirement {
  capabilityId: string;
  required: boolean;
  reason: string;
  confirmationRequired: boolean;
}

@Injectable()
export class SkillCapabilityResolverService {
  constructor(private readonly catalog: SkillCapabilityCatalogService) {}

  resolveRequirements(value: unknown): {
    requirements: RawRequirement[];
    resolutions: SkillCapabilityResolution[];
  } {
    const rows = this.rawRequirements(value);
    const resolutions = rows.map((row) => this.resolve(row));
    const merged = new Map<string, RawRequirement>();

    for (const resolution of resolutions) {
      if (!resolution.capabilityId) continue;
      if (resolution.status !== 'EXACT' && resolution.status !== 'ALIAS') continue;
      const key = resolution.capabilityId.toLowerCase();
      const current = merged.get(key);
      const definition = this.catalog.find(resolution.capabilityId);
      const next: RawRequirement = {
        capabilityId: resolution.capabilityId,
        required: resolution.required || current?.required === true,
        reason: current?.reason || resolution.reason,
        confirmationRequired:
          resolution.confirmationRequired
          || current?.confirmationRequired === true
          || definition?.confirmationRequired === true,
      };
      merged.set(key, next);
    }

    return {
      requirements: [...merged.values()],
      resolutions,
    };
  }

  resolve(row: RawRequirement): SkillCapabilityResolution {
    const rawValue = row.capabilityId.trim();
    const exact = this.catalog.find(rawValue);
    if (exact) {
      return {
        rawValue,
        capabilityId: exact.id,
        status: rawValue === exact.id ? 'EXACT' : 'ALIAS',
        candidates: [],
        required: row.required,
        reason: row.reason,
        confirmationRequired:
          row.confirmationRequired || exact.confirmationRequired,
      };
    }

    const toolMatches = this.catalog.findByToolId(rawValue);
    if (toolMatches.length > 0) {
      return {
        rawValue,
        capabilityId: null,
        status: 'CONCRETE_TOOL',
        candidates: toolMatches.map((item) => item.id).slice(0, 8),
        required: row.required,
        reason: row.reason,
        confirmationRequired: row.confirmationRequired,
      };
    }

    const formattingMatches = this.formattingMatches(rawValue);
    if (formattingMatches.length === 1) {
      const definition = formattingMatches[0];
      return {
        rawValue,
        capabilityId: definition.id,
        status: 'ALIAS',
        candidates: [],
        required: row.required,
        reason: row.reason,
        confirmationRequired:
          row.confirmationRequired || definition.confirmationRequired,
      };
    }

    if (formattingMatches.length > 1) {
      return {
        rawValue,
        capabilityId: null,
        status: 'AMBIGUOUS',
        candidates: formattingMatches.map((item) => item.id).slice(0, 8),
        required: row.required,
        reason: row.reason,
        confirmationRequired: row.confirmationRequired,
      };
    }

    return {
      rawValue,
      capabilityId: null,
      status: 'UNRESOLVED',
      candidates: this.candidates(rawValue),
      required: row.required,
      reason: row.reason,
      confirmationRequired: row.confirmationRequired,
    };
  }

  inspectPolicy(value: unknown): SkillCapabilityPolicyInspection {
    const policy = this.record(value);
    const requirementsValue = policy.capabilityRequirements;
    const resolved = this.resolveRequirements(requirementsValue);
    const persistedResolutions = this.resolutions(policy.capabilityResolutions);
    const resolutions = persistedResolutions.length > 0
      ? persistedResolutions
      : resolved.resolutions;
    const issues: SkillCapabilityPolicyInspection['issues'] = [];

    for (const requirement of resolved.requirements) {
      const definition = this.catalog.find(requirement.capabilityId);
      if (!definition) {
        issues.push({
          code: 'SKILL_CAPABILITY_UNSUPPORTED',
          severity: requirement.required ? 'ERROR' : 'WARNING',
          capabilityId: requirement.capabilityId,
          rawValue: requirement.capabilityId,
          message: `Capability is not present in the system catalog: ${requirement.capabilityId}`,
          params: { capabilityId: requirement.capabilityId },
        });
        continue;
      }
      if (!definition.available) {
        issues.push({
          code: 'SKILL_CAPABILITY_UNAVAILABLE',
          severity: requirement.required ? 'ERROR' : 'WARNING',
          capabilityId: definition.id,
          rawValue: requirement.capabilityId,
          message: `No available Tool currently provides this capability: ${definition.id}`,
          params: { capabilityId: definition.id },
        });
      }
      if (definition.confirmationRequired && !requirement.confirmationRequired) {
        issues.push({
          code: 'SKILL_CAPABILITY_CONFIRMATION_REQUIRED',
          severity: 'ERROR',
          capabilityId: definition.id,
          rawValue: requirement.capabilityId,
          message: `This capability requires user confirmation: ${definition.id}`,
          params: { capabilityId: definition.id },
        });
      }
    }

    for (const resolution of resolutions) {
      if (resolution.status === 'EXACT' || resolution.status === 'ALIAS') continue;
      issues.push({
        code: `SKILL_CAPABILITY_${resolution.status}`,
        severity: resolution.required ? 'ERROR' : 'WARNING',
        capabilityId: null,
        rawValue: resolution.rawValue,
        message: this.resolutionMessage(resolution),
        params: {
          rawValue: resolution.rawValue,
          candidates: resolution.candidates.join(', '),
        },
      });
    }

    return {
      ready: !issues.some((issue) => issue.severity === 'ERROR'),
      requirements: resolved.requirements,
      resolutions,
      issues,
    };
  }

  private rawRequirements(value: unknown): RawRequirement[] {
    if (!Array.isArray(value)) return [];
    const output: RawRequirement[] = [];

    for (const item of value) {
      const row = this.record(item);
      const capabilityId = this.text(row.capabilityId)
        || this.text(row.capability)
        || '';
      if (!capabilityId) continue;
      output.push({
        capabilityId,
        required: row.required === true,
        reason: (this.text(row.reason) || 'This capability may be required at runtime.').slice(0, 500),
        confirmationRequired: row.confirmationRequired === true,
      });
    }

    return output.slice(0, 40);
  }

  private resolutions(value: unknown): SkillCapabilityResolution[] {
    if (!Array.isArray(value)) return [];
    const output: SkillCapabilityResolution[] = [];
    for (const item of value) {
      const row = this.record(item);
      const rawValue = this.text(row.rawValue);
      const status = this.text(row.status);
      if (!rawValue || !status) continue;
      if (!['EXACT', 'ALIAS', 'CONCRETE_TOOL', 'AMBIGUOUS', 'UNRESOLVED'].includes(status)) continue;
      output.push({
        rawValue,
        capabilityId: this.text(row.capabilityId),
        status: status as SkillCapabilityResolution['status'],
        candidates: Array.isArray(row.candidates)
          ? row.candidates.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 8)
          : [],
        required: row.required === true,
        reason: this.text(row.reason) || 'This capability may be required at runtime.',
        confirmationRequired: row.confirmationRequired === true,
      });
    }
    return output;
  }

  private formattingMatches(rawValue: string): SkillCapabilityDefinition[] {
    const signature = this.signature(rawValue);
    if (!signature) return [];
    return this.catalog.list().filter((item) => this.signature(item.id) === signature);
  }

  private candidates(rawValue: string): string[] {
    const queryTokens = this.tokens(rawValue);
    if (queryTokens.length === 0) return [];
    return this.catalog.list({ generationEligibleOnly: true })
      .map((item) => ({
        id: item.id,
        score: this.score(queryTokens, this.tokens(item.id)),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, 5)
      .map((item) => item.id);
  }

  private score(left: string[], right: string[]): number {
    const rightSet = new Set(right);
    let score = 0;
    for (const token of left) {
      if (rightSet.has(token)) score += token.length + 2;
    }
    return score;
  }

  private signature(value: string): string {
    return this.tokens(value).join('.');
  }

  private tokens(value: string): string[] {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .split(/[\s._:/\\-]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private resolutionMessage(resolution: SkillCapabilityResolution): string {
    const candidates = resolution.candidates.length
      ? ` Candidates: ${resolution.candidates.join(', ')}.`
      : '';
    if (resolution.status === 'CONCRETE_TOOL') {
      return `A concrete Tool id cannot be used as a Skill capability: ${resolution.rawValue}.${candidates}`;
    }
    if (resolution.status === 'AMBIGUOUS') {
      return `Capability name is ambiguous: ${resolution.rawValue}.${candidates}`;
    }
    return `Capability is not recognized by the system catalog: ${resolution.rawValue}.${candidates}`;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private text(value: unknown): string | null {
    const result = typeof value === 'string' ? value.trim() : '';
    return result || null;
  }
}
