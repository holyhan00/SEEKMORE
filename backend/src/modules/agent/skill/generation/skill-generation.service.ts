import { BadGatewayException, Injectable } from '@nestjs/common';
import type {
  SkillDocumentDiagnostic,
  SkillValidationSummary,
} from '../domain/skill-document.types';
import { SkillDomainError } from '../domain/skill.errors';
import { createSkillInternalName } from '../domain/skill-identity.util';
import type {
  SkillGenerationInput,
  SkillGenerationResult,
} from '../specification/skill-generation.types';
import { SkillPackageScannerService } from '../security/skill-package-scanner.service';
import { SkillAcceptancePolicy } from '../validation/skill-acceptance.policy';
import { SkillDocumentValidator } from '../validation/skill-document.validator';
import { SkillFrontmatterParser } from '../validation/skill-frontmatter.parser';
import { SkillGenerationAgentBridge } from './skill-generation-agent.bridge';
import { SkillGenerationPromptBuilder } from './skill-generation-prompt.builder';
import { SkillGenerationResultParser } from './skill-generation-result.parser';

const MAX_REPAIR_ATTEMPTS = 2;

interface CandidateValidation {
  validation: SkillValidationSummary;
  projectedName: string | null;
}

@Injectable()
export class SkillGenerationService {
  constructor(
    private readonly prompts: SkillGenerationPromptBuilder,
    private readonly agent: SkillGenerationAgentBridge,
    private readonly resultParser: SkillGenerationResultParser,
    private readonly documentParser: SkillFrontmatterParser,
    private readonly validator: SkillDocumentValidator,
    private readonly scanner: SkillPackageScannerService,
    private readonly acceptance: SkillAcceptancePolicy,
  ) {}

  async create(
    userId: string,
    input: SkillGenerationInput,
  ): Promise<SkillGenerationResult> {
    this.validator.assertGenerationInput(input);

    const internalName = createSkillInternalName();
    const generationInput = {
      ...input,
      internalName,
    };

    let content = await this.agent.run({
      userId,
      agentId: input.agentId,
      prompt: this.prompts.build(generationInput),
    });
    let skillMarkdown =
      this.resultParser.parse(content);
    let diagnostics: SkillDocumentDiagnostic[] = [];

    for (
      let attempt = 0;
      attempt <= MAX_REPAIR_ATTEMPTS;
      attempt += 1
    ) {
      const candidate = this.validateCandidate(
        skillMarkdown,
        internalName,
      );
      const validation = candidate.validation;
      diagnostics = validation.diagnostics;

      if (
        validation.accepted &&
        candidate.projectedName === internalName
      ) {
        return {
          displayName: input.displayName,
          internalName,
          skillMarkdown,
          diagnostics,
          validation,
          generationAttempts: attempt + 1,
        };
      }

      if (attempt === MAX_REPAIR_ATTEMPTS) {
        break;
      }

      content = await this.agent.run({
        userId,
        agentId: input.agentId,
        prompt: this.prompts.repair({
          original: generationInput,
          invalidOutput: skillMarkdown,
          diagnostics,
        }),
      });
      skillMarkdown =
        this.resultParser.parse(content);
    }

    throw new BadGatewayException({
      code: 'SKILL_AI_GENERATION_INVALID',
      message:
        'The model could not produce a fully standard-compliant SKILL.md.',
      attempts: MAX_REPAIR_ATTEMPTS + 1,
      issues: diagnostics,
    });
  }

  private validateCandidate(
    skillMarkdown: string,
    expectedName: string,
  ): CandidateValidation {
    try {
      const parsed =
        this.documentParser.parse(skillMarkdown);
      const report = this.validator.validate(parsed, {
        rootName: expectedName,
        resources: [],
      });
      const securityDiagnostics =
        this.scanner.scan(
          skillMarkdown,
          [],
        );
      const decision = this.acceptance.decide({
        source: 'AI_GENERATED',
        report,
        securityDiagnostics,
      });

      return {
        validation: decision,
        projectedName:
          report.projection?.name ?? null,
      };
    } catch (error) {
      const diagnostic =
        this.parseDiagnostic(error);

      return {
        validation: {
          parseable: false,
          safe: false,
          runnable: false,
          specCompliant: false,
          accepted: false,
          mode: 'STRICT',
          diagnostics: [diagnostic],
        },
        projectedName: null,
      };
    }
  }

  private parseDiagnostic(
    error: unknown,
  ): SkillDocumentDiagnostic {
    if (error instanceof SkillDomainError) {
      const details = this.location(
        error.details,
      );

      return {
        code: error.code,
        severity: 'ERROR',
        message: error.message,
        params: { detail: error.message },
        path: 'SKILL.md',
        line: details.line,
        column: details.column,
      };
    }

    return {
      code: 'SKILL_DOCUMENT_PARSE_FAILED',
      severity: 'ERROR',
      message:
        error instanceof Error
          ? error.message
          : 'SKILL.md parsing failed.',
      path: 'SKILL.md',
      line: null,
      column: null,
    };
  }

  private location(value: unknown): {
    line: number | null;
    column: number | null;
  } {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      return {
        line: null,
        column: null,
      };
    }

    const record =
      value as Record<string, unknown>;

    return {
      line:
        typeof record.line === 'number'
          ? record.line
          : null,
      column:
        typeof record.column === 'number'
          ? record.column
          : null,
    };
  }
}
