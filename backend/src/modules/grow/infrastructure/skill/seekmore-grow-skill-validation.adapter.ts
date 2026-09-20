import { Injectable } from '@nestjs/common';
import { SkillValidationService } from '../../../agent/skill/validation/skill-validation.service';
import type { GrowSkillValidationPort } from '../../ports/grow-skill-publication.port';

@Injectable()
export class SeekmoreGrowSkillValidationAdapter implements GrowSkillValidationPort {
  constructor(private readonly validation: SkillValidationService) {}

  async validate(input: Parameters<GrowSkillValidationPort['validate']>[0]) {
    const result = await this.validation.validate(input.userId, input.skillId, input.versionId);
    const issues = [
      ...result.structuralIssues,
      ...result.securityIssues,
      ...result.dependencyIssues,
      ...result.capabilityIssues,
    ].map((issue) => ({
      code: issue.code,
      severity: this.severity(issue.severity),
      message: issue.message,
      path: issue.path ?? undefined,
    }));
    return { passed: result.valid, issues, validationRunId: result.validationRunId };
  }

  private severity(value: string): 'info' | 'warning' | 'error' | 'critical' {
    const normalized = value.toLowerCase();
    if (normalized === 'critical') return 'critical';
    if (normalized === 'error') return 'error';
    if (normalized === 'warning') return 'warning';
    return 'info';
  }
}
