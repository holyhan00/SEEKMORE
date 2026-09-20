import { Injectable } from '@nestjs/common';
import type { SkillDocumentDiagnostic } from '../domain/skill-document.types';
import type { SkillGenerationInput } from '../specification/skill-generation.types';

type ResolvedGenerationInput = SkillGenerationInput & {
  internalName: string;
};

@Injectable()
export class SkillGenerationPromptBuilder {
  build(input: ResolvedGenerationInput): string {
    return [
      'Create one reusable Agent Skill that follows the Agent Skills open specification.',
      '',
      'OUTPUT CONTRACT',
      '- Output only the complete contents of SKILL.md.',
      '- Do not output JSON, commentary, or an outer Markdown code fence.',
      '- The document must begin with YAML frontmatter and continue with a non-empty Markdown instruction body.',
      '- Keep the supplied internal name unchanged. It is a hidden stable identifier, not the user-facing title.',
      '- Use only these top-level frontmatter fields: name, description, license, compatibility, metadata, allowed-tools.',
      '- metadata must contain only string keys and string values.',
      '- allowed-tools is experimental; include it only when supplied.',
      '- Do not add product-specific or private frontmatter fields.',
      '- Do not invent tools, MCP servers, scripts, references, assets, packages, permissions, or environment capabilities.',
      '- Do not write a one-time answer. Write reusable instructions for an agent capability.',
      '- Do not use keyword-trigger rules or site-specific routing logic.',
      '- Keep instructions portable, precise, actionable, and no longer than necessary.',
      '- Write the Markdown body in the same language as the user-facing title and description.',
      `- Use "# ${input.displayName}" as the first Markdown heading.`,
      '',
      'STANDARD FIELDS',
      `name: ${input.internalName}`,
      `description: ${input.description}`,
      `license: ${input.license?.trim() || '(omit)'}`,
      `compatibility: ${input.compatibility?.trim() || '(omit)'}`,
      `metadata: ${JSON.stringify(input.metadata ?? {})}`,
      `allowed-tools: ${input.allowedTools?.trim() || '(omit)'}`,
      '',
      'USER-FACING TITLE',
      input.displayName,
    ].join('\n');
  }

  repair(input: {
    original: ResolvedGenerationInput;
    invalidOutput: string;
    diagnostics: SkillDocumentDiagnostic[];
  }): string {
    return [
      'Repair the following invalid Agent Skill document.',
      'Return only the complete corrected SKILL.md, with no commentary or outer code fence.',
      'Fix only format and specification violations. Preserve the requested capability and keep the supplied internal name unchanged.',
      '',
      `REQUIRED INTERNAL NAME: ${input.original.internalName}`,
      `REQUIRED USER-FACING TITLE: ${input.original.displayName}`,
      `REQUIRED DESCRIPTION INTENT: ${input.original.description}`,
      '',
      'VALIDATION DIAGNOSTICS',
      ...input.diagnostics.map(
        (item) => `- ${item.code}: ${item.message}${item.line ? ` (line ${item.line})` : ''}`,
      ),
      '',
      'INVALID OUTPUT',
      input.invalidOutput,
    ].join('\n');
  }
}
