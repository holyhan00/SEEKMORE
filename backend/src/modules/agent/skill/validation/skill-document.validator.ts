import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AGENT_SKILL_FRONTMATTER_FIELDS,
  AGENT_SKILL_NAME_PATTERN,
  type ParsedSkillDocument,
  type SkillDocumentDiagnostic,
  type SkillDocumentValidationResult,
  type SkillPackageResourceInput,
  type SkillRuntimeProjection,
} from '../domain/skill-document.types';
import { estimateTokens } from '../domain/skill-content.util';
import { SKILL_PACKAGE_LIMITS } from '../domain/skill-policy';
import { SkillDomainError } from '../domain/skill.errors';
import { SkillPathPolicy } from '../security/skill-path-policy';

const STANDARD_FIELDS = new Set<string>(
  AGENT_SKILL_FRONTMATTER_FIELDS,
);
const BLOCKING_SEVERITIES = new Set(['ERROR', 'CRITICAL']);
const SAFE_NAME_MAX_LENGTH = 64;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;

@Injectable()
export class SkillDocumentValidator {
  constructor(private readonly paths: SkillPathPolicy) {}

  validate(
    parsed: ParsedSkillDocument,
    options: {
      rootName?: string | null;
      existingName?: string | null;
      resources?: SkillPackageResourceInput[];
    } = {},
  ): SkillDocumentValidationResult {
    const diagnostics: SkillDocumentDiagnostic[] = [];
    const projection: SkillRuntimeProjection = {
      name: '',
      description: '',
    };

    const fieldLocation = (field: string) =>
      parsed.locations.fields[field];

    const issue = (
      code: string,
      severity: SkillDocumentDiagnostic['severity'],
      message: string,
      field?: string,
      path = 'SKILL.md',
      params?: Record<string, string | number | boolean | null>,
    ) => {
      const location = field
        ? fieldLocation(field)
        : undefined;
      diagnostics.push({
        code,
        severity,
        message,
        ...(params ? { params } : {}),
        path,
        field: field ?? null,
        line: location?.line ?? null,
        column: location?.column ?? null,
      });
    };

    for (const key of Object.keys(parsed.frontmatter)) {
      if (!STANDARD_FIELDS.has(key)) {
        issue(
          'SKILL_FRONTMATTER_EXTENSION_FIELD',
          'WARNING',
          `Non-standard top-level frontmatter field is preserved but ignored by the standard runtime projection: ${key}.`,
          key,
          'SKILL.md',
          { field: key },
        );
      }
    }

    const nameValue = parsed.frontmatter.name;
    if (
      typeof nameValue !== 'string' ||
      !nameValue.trim()
    ) {
      issue(
        'SKILL_NAME_REQUIRED',
        'ERROR',
        'name must be a non-empty string.',
        'name',
      );
    } else if (this.isDangerousName(nameValue)) {
      issue(
        'SKILL_NAME_UNSAFE',
        'ERROR',
        'name must not contain path separators, control characters, or path traversal values.',
        'name',
      );
    } else if (nameValue.length > SAFE_NAME_MAX_LENGTH) {
      issue(
        'SKILL_NAME_STORAGE_LIMIT_EXCEEDED',
        'ERROR',
        `name must not exceed ${SAFE_NAME_MAX_LENGTH} characters because it is the stable Skill and package identifier.`,
        'name',
        'SKILL.md',
        { maxLength: SAFE_NAME_MAX_LENGTH },
      );
    } else {
      projection.name = nameValue;

      if (
        !AGENT_SKILL_NAME_PATTERN.test(nameValue)
      ) {
        issue(
          'SKILL_NAME_NON_STANDARD',
          'WARNING',
          'name is usable in compatibility mode, but the Agent Skills specification recommends lowercase ASCII letters, digits, and single hyphens.',
          'name',
        );
      }

      if (
        options.rootName &&
        nameValue !== options.rootName
      ) {
        issue(
          'SKILL_ROOT_NAME_MISMATCH',
          'WARNING',
          `The package root name (${options.rootName}) differs from frontmatter name (${nameValue}). The frontmatter name will be used as the Skill identity.`,
          'name',
          'SKILL.md',
          { rootName: options.rootName, name: nameValue },
        );
      }

      if (
        options.existingName &&
        nameValue !== options.existingName
      ) {
        issue(
          'SKILL_NAME_IMMUTABLE',
          'ERROR',
          'An existing Skill cannot change its name. Create a new Skill instead.',
          'name',
        );
      }
    }

    const descriptionValue =
      parsed.frontmatter.description;
    if (
      typeof descriptionValue !== 'string' ||
      !descriptionValue.trim()
    ) {
      issue(
        'SKILL_DESCRIPTION_REQUIRED',
        'ERROR',
        'description must be a non-empty string.',
        'description',
      );
    } else if (descriptionValue.length > 1024) {
      issue(
        'SKILL_DESCRIPTION_STORAGE_LIMIT_EXCEEDED',
        'ERROR',
        'description must not exceed 1024 characters in this installation.',
        'description',
      );
    } else {
      projection.description = descriptionValue;
    }

    this.optionalString(
      parsed,
      diagnostics,
      projection,
      'license',
    );
    this.optionalString(
      parsed,
      diagnostics,
      projection,
      'compatibility',
      500,
    );

    const metadata = parsed.frontmatter.metadata;
    if (metadata !== undefined) {
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
      ) {
        issue(
          'SKILL_METADATA_NON_STANDARD',
          'WARNING',
          'metadata should be a mapping. The original value is preserved but ignored by the standard runtime projection.',
          'metadata',
        );
      } else {
        const standardMetadata: Record<string, string> = {};
        for (const [key, value] of Object.entries(metadata)) {
          if (typeof value !== 'string') {
            issue(
              'SKILL_METADATA_VALUE_NON_STANDARD',
              'WARNING',
              `metadata.${key} should be a string. The original value is preserved but ignored by the standard runtime projection.`,
              'metadata',
              'SKILL.md',
              { key },
            );
            continue;
          }
          standardMetadata[key] = value;
        }
        if (Object.keys(standardMetadata).length > 0) {
          projection.metadata = standardMetadata;
        }
      }
    }

    const allowedTools =
      parsed.frontmatter['allowed-tools'];
    if (allowedTools !== undefined) {
      if (typeof allowedTools !== 'string') {
        issue(
          'SKILL_ALLOWED_TOOLS_NON_STANDARD',
          'WARNING',
          'allowed-tools should be a space-separated string. The original value is preserved and ignored as runtime permission authority.',
          'allowed-tools',
        );
      } else {
        projection.allowedTools = allowedTools;
        issue(
          'SKILL_ALLOWED_TOOLS_EXPERIMENTAL',
          'INFO',
          'allowed-tools is experimental and is not used as runtime permission authority.',
          'allowed-tools',
        );
      }
    }

    if (!parsed.bodyRaw.trim()) {
      diagnostics.push({
        code: 'SKILL_BODY_REQUIRED',
        severity: 'ERROR',
        message:
          'SKILL.md must contain a non-empty Markdown instruction body.',
        path: 'SKILL.md',
        field: 'body',
        line: parsed.locations.bodyStartLine,
        column: 1,
      });
    }

    const markdownBytes = Buffer.byteLength(
      parsed.rawMarkdown,
      'utf8',
    );
    if (
      markdownBytes >
      SKILL_PACKAGE_LIMITS.maxSkillMarkdownBytes
    ) {
      diagnostics.push({
        code: 'SKILL_MARKDOWN_SIZE_EXCEEDED',
        severity: 'ERROR',
        message:
          'SKILL.md exceeds the configured safety size limit.',
        params: { maxBytes: SKILL_PACKAGE_LIMITS.maxSkillMarkdownBytes },
        path: 'SKILL.md',
      });
    }

    const lineCount = parsed.rawMarkdown.split(
      /\r\n|\n|\r/,
    ).length;
    if (lineCount > 500) {
      diagnostics.push({
        code: 'SKILL_MARKDOWN_LINE_COUNT_HIGH',
        severity: 'INFO',
        message:
          'SKILL.md is over 500 lines; consider moving detailed material into references/.',
        path: 'SKILL.md',
      });
    }

    if (estimateTokens(parsed.bodyRaw) > 5000) {
      diagnostics.push({
        code: 'SKILL_MARKDOWN_TOKEN_ESTIMATE_HIGH',
        severity: 'INFO',
        message:
          'SKILL.md is estimated to exceed 5000 tokens; consider moving detailed material into references/.',
        path: 'SKILL.md',
      });
    }

    for (const resource of options.resources ?? []) {
      try {
        const normalized = this.paths.normalize(
          resource.path,
        );
        if (
          normalized !==
          resource.path.replace(/\\/g, '/')
        ) {
          diagnostics.push({
            code: 'SKILL_RESOURCE_PATH_NOT_CANONICAL',
            severity: 'ERROR',
            message:
              'Skill resource paths must be canonical paths relative to the Skill root.',
            path: resource.path,
          });
        }
      } catch (error) {
        diagnostics.push({
          code:
            error instanceof SkillDomainError
              ? error.code
              : 'SKILL_RESOURCE_PATH_INVALID',
          severity: 'ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Skill resource path is invalid.',
          params: {
            detail: error instanceof Error
              ? error.message
              : 'Skill resource path is invalid.',
          },
          path: resource.path,
        });
      }
    }

    this.validateReferencedPaths(
      parsed.bodyRaw,
      diagnostics,
      options.resources ?? [],
    );

    const runnable = !diagnostics.some((item) =>
      BLOCKING_SEVERITIES.has(item.severity),
    );
    const specCompliant =
      runnable &&
      !diagnostics.some(
        (item) => item.severity === 'WARNING',
      );

    return {
      valid: runnable,
      parseable: true,
      runnable,
      specCompliant,
      projection: runnable ? projection : null,
      diagnostics,
    };
  }

     
                                                                              
                                               
     
  assertValid(
    parsed: ParsedSkillDocument,
    options: {
      rootName?: string | null;
      existingName?: string | null;
      resources?: SkillPackageResourceInput[];
    } = {},
  ): SkillDocumentValidationResult {
    const result = this.validate(parsed, options);
    if (!result.runnable) {
      throw new BadRequestException({
        code: 'SKILL_DOCUMENT_INVALID',
        message: 'SKILL.md cannot be safely created or run.',
        issues: result.diagnostics,
      });
    }
    return result;
  }

  validateGenerationInput(input: {
    displayName: unknown;
    description: unknown;
    license?: unknown;
    compatibility?: unknown;
    metadata?: unknown;
    allowedTools?: unknown;
  }): SkillDocumentValidationResult {
    const diagnostics: SkillDocumentDiagnostic[] = [];
    const push = (
      code: string,
      message: string,
      field: string,
    ) =>
      diagnostics.push({
        code,
        severity: 'ERROR',
        message,
        path: null,
        field,
        line: null,
        column: null,
      });

    if (
      typeof input.displayName !== 'string' ||
      !input.displayName.trim()
    ) {
      push(
        'SKILL_DISPLAY_NAME_REQUIRED',
        'Skill display name is required.',
        'displayName',
      );
    } else if (
      input.displayName.length > 120 ||
      CONTROL_CHARACTER_PATTERN.test(input.displayName)
    ) {
      push(
        'SKILL_DISPLAY_NAME_INVALID',
        'Skill display name must not exceed 120 characters or contain control characters.',
        'displayName',
      );
    }

    if (
      typeof input.description !== 'string' ||
      !input.description.trim()
    ) {
      push(
        'SKILL_DESCRIPTION_REQUIRED',
        'description must not be empty.',
        'description',
      );
    } else if (input.description.length > 1024) {
      push(
        'SKILL_DESCRIPTION_TOO_LONG',
        'description must not exceed 1024 characters.',
        'description',
      );
    }

    for (const [field, value, max] of [
      ['license', input.license, null],
      ['compatibility', input.compatibility, 500],
      ['allowedTools', input.allowedTools, null],
    ] as const) {
      if (
        value === undefined ||
        value === null ||
        value === ''
      ) {
        continue;
      }
      if (typeof value !== 'string') {
        push(
          `SKILL_${field.toUpperCase()}_INVALID`,
          `${field} must be a string.`,
          field,
        );
      } else if (max && value.length > max) {
        push(
          `SKILL_${field.toUpperCase()}_TOO_LONG`,
          `${field} must not exceed ${max} characters.`,
          field,
        );
      }
    }

    if (
      input.metadata !== undefined &&
      input.metadata !== null
    ) {
      if (
        typeof input.metadata !== 'object' ||
        Array.isArray(input.metadata)
      ) {
        push(
          'SKILL_METADATA_MAPPING_REQUIRED',
          'metadata must be a mapping of string keys to string values.',
          'metadata',
        );
      } else {
        for (const [key, value] of Object.entries(
          input.metadata,
        )) {
          if (typeof value !== 'string') {
            push(
              'SKILL_METADATA_VALUE_INVALID',
              `metadata.${key} must be a string.`,
              'metadata',
            );
          }
        }
      }
    }

    const runnable = diagnostics.length === 0;
    return {
      valid: runnable,
      parseable: true,
      runnable,
      specCompliant: runnable,
      projection: null,
      diagnostics,
    };
  }

  assertGenerationInput(input: {
    displayName: unknown;
    description: unknown;
    license?: unknown;
    compatibility?: unknown;
    metadata?: unknown;
    allowedTools?: unknown;
  }): void {
    const result = this.validateGenerationInput(input);
    if (!result.runnable) {
      throw new BadRequestException({
        code: 'SKILL_GENERATION_INPUT_INVALID',
        message:
          'Skill generation input validation failed.',
        issues: result.diagnostics,
      });
    }
  }

  private optionalString(
    parsed: ParsedSkillDocument,
    diagnostics: SkillDocumentDiagnostic[],
    projection: SkillRuntimeProjection,
    field: 'license' | 'compatibility',
    maxLength?: number,
  ): void {
    const value = parsed.frontmatter[field];
    if (value === undefined) return;

    const location = parsed.locations.fields[field];
    if (typeof value !== 'string') {
      diagnostics.push({
        code: `SKILL_${field.toUpperCase()}_NON_STANDARD`,
        severity: 'WARNING',
        message: `${field} should be a string. The original value is preserved but ignored by the standard runtime projection.`,
        params: { field },
        path: 'SKILL.md',
        field,
        line: location?.line ?? null,
        column: location?.column ?? null,
      });
      return;
    }

    if (maxLength && value.length > maxLength) {
      diagnostics.push({
        code: `SKILL_${field.toUpperCase()}_NON_STANDARD`,
        severity: 'WARNING',
        message: `${field} exceeds the recommended ${maxLength} character compatibility limit and is ignored by the standard runtime projection.`,
        params: { field, maxLength },
        path: 'SKILL.md',
        field,
        line: location?.line ?? null,
        column: location?.column ?? null,
      });
      return;
    }

    projection[field] = value;
  }

  private isDangerousName(value: string): boolean {
    return (
      value === '.' ||
      value === '..' ||
      value.includes('/') ||
      value.includes('\\') ||
      CONTROL_CHARACTER_PATTERN.test(value)
    );
  }

  private validateReferencedPaths(
    body: string,
    diagnostics: SkillDocumentDiagnostic[],
    resources: SkillPackageResourceInput[],
  ): void {
    const references = new Set<string>();
    const markdownLink = /\]\(([^)]+)\)/g;
    const inlinePath =
      /`((?:scripts|references|assets)\/[^`]+)`/g;

    for (const pattern of [
      markdownLink,
      inlinePath,
    ]) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(body))) {
        references.add(match[1].trim());
      }
    }

    for (const reference of references) {
      if (
        !reference ||
        /^(?:https?:|mailto:|#)/i.test(reference)
      ) {
        continue;
      }

      const clean = reference.split(/[?#]/, 1)[0];
      if (!clean) continue;

      try {
        const normalized = this.paths.normalize(clean);
        if (
          /^(?:scripts|references|assets)\//.test(
            normalized,
          )
        ) {
          const available = resources.some(
            (resource) =>
              resource.path === normalized,
          );
          if (!available) {
            diagnostics.push({
              code: 'SKILL_RESOURCE_REFERENCE_MISSING',
              severity: 'WARNING',
              message: `Referenced Skill resource is not present in this package: ${normalized}. The Skill remains runnable, but reading this resource may fail at runtime.`,
              params: { path: normalized },
              path: 'SKILL.md',
              field: 'body',
            });
          }
        }
      } catch {
        diagnostics.push({
          code: 'SKILL_RESOURCE_REFERENCE_NON_STANDARD',
          severity: 'WARNING',
          message:
            'A bundled resource reference is not a safe Skill-root-relative path. The reference is preserved and runtime path policy will reject unsafe reads.',
          path: 'SKILL.md',
          field: 'body',
        });
      }
    }
  }
}
