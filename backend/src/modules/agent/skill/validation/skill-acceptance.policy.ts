import { Injectable } from '@nestjs/common';
import type {
  SkillAcceptanceDecision,
  SkillCreationMethod,
  SkillDocumentDiagnostic,
  SkillDocumentValidationResult,
  SkillValidationMode,
} from '../domain/skill-document.types';

const isBlocking = (
  diagnostic: SkillDocumentDiagnostic,
): boolean =>
  diagnostic.severity === 'ERROR' ||
  diagnostic.severity === 'CRITICAL';

const isSafetyDiagnostic = (
  diagnostic: SkillDocumentDiagnostic,
): boolean => {
  const code = diagnostic.code;

  return (
    diagnostic.severity === 'CRITICAL' ||
    code === 'SKILL_NAME_UNSAFE' ||
    code === 'SKILL_MARKDOWN_SIZE_EXCEEDED' ||
    code.startsWith('SKILL_PATH_') ||
    code.startsWith('SKILL_RESOURCE_PATH_') ||
    code.startsWith('SKILL_PACKAGE_') ||
    code.startsWith('SKILL_FILE_COUNT_') ||
    code.startsWith('SKILL_FILE_SIZE_') ||
    code === 'SKILL_DUPLICATE_PATH'
  );
};

@Injectable()
export class SkillAcceptancePolicy {
  decide(input: {
    source: SkillCreationMethod;
    report: SkillDocumentValidationResult;
    securityDiagnostics: SkillDocumentDiagnostic[];
  }): SkillAcceptanceDecision {
    const mode = this.mode(input.source);
    const diagnostics = [
      ...input.report.diagnostics,
      ...input.securityDiagnostics,
    ];
    const blockingDiagnostics = diagnostics.filter(isBlocking);
    const safetyDiagnostics = diagnostics.filter(
      (diagnostic) =>
        isBlocking(diagnostic) &&
        isSafetyDiagnostic(diagnostic),
    );
    const safe = safetyDiagnostics.length === 0;

    const accepted =
      input.report.parseable &&
      input.report.runnable &&
      safe &&
      (mode !== 'STRICT' || input.report.specCompliant);

    const strictCompatibilityDiagnostics =
      mode === 'STRICT' &&
      !input.report.specCompliant &&
      blockingDiagnostics.length === 0
        ? input.report.diagnostics.filter(
            (item) => item.severity === 'WARNING',
          )
        : [];

    return {
      parseable: input.report.parseable,
      safe,
      runnable: input.report.runnable,
      specCompliant: input.report.specCompliant,
      accepted,
      mode,
      diagnostics,
      blockingDiagnostics: [
        ...blockingDiagnostics,
        ...strictCompatibilityDiagnostics,
      ],
    };
  }

  private mode(
    source: SkillCreationMethod,
  ): SkillValidationMode {
    if (source === 'AI_GENERATED') return 'STRICT';
    if (source === 'IMPORTED') return 'IMPORT_COMPATIBLE';
    return 'COMPATIBLE';
  }
}
