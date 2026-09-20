import type { SkillFileType, SkillSourceKind } from '@prisma/client';

export const AGENT_SKILL_NAME_PATTERN_SOURCE =
  '^[a-z0-9]+(?:-[a-z0-9]+)*$';
export const AGENT_SKILL_NAME_PATTERN = new RegExp(
  AGENT_SKILL_NAME_PATTERN_SOURCE,
);

export const AGENT_SKILL_FRONTMATTER_FIELDS = [
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
] as const;

export type AgentSkillFrontmatterField =
  (typeof AGENT_SKILL_FRONTMATTER_FIELDS)[number];

export type SkillCreationMethod =
  | 'USER_AUTHORED'
  | 'AI_GENERATED'
  | 'IMPORTED';

export type SkillValidationMode =
  | 'STRICT'
  | 'COMPATIBLE'
  | 'IMPORT_COMPATIBLE';

export type SkillDiagnosticSeverity =
  | 'INFO'
  | 'WARNING'
  | 'ERROR'
  | 'CRITICAL';

export interface SkillDocumentLocation {
  line: number;
  column: number;
}

export interface SkillDocumentLocations {
  frontmatterStartLine: number;
  frontmatterEndLine: number;
  bodyStartLine: number;
  fields: Partial<
    Record<
      AgentSkillFrontmatterField | string,
      SkillDocumentLocation
    >
  >;
}

export interface SkillRuntimeProjection {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
}

export type SkillDocumentFrontmatter = SkillRuntimeProjection;

export interface ParsedSkillDocument {
  rawMarkdown: string;
  frontmatterRaw: string;
  bodyRaw: string;
  body: string;
  frontmatter: Record<string, unknown>;
  raw: Record<string, unknown>;
  manifest: SkillRuntimeProjection;
  locations: SkillDocumentLocations;
}

export interface SkillDocumentDiagnostic {
  code: string;
  severity: SkillDiagnosticSeverity;
  message: string;
  params?: Record<string, string | number | boolean | null>;
  path: string | null;
  field?: string | null;
  line?: number | null;
  column?: number | null;
}

export interface SkillDocumentValidationResult {
  valid: boolean;
  parseable: boolean;
  runnable: boolean;
  specCompliant: boolean;
  projection: SkillRuntimeProjection | null;
  diagnostics: SkillDocumentDiagnostic[];
}

export interface SkillValidationSummary {
  parseable: boolean;
  safe: boolean;
  runnable: boolean;
  specCompliant: boolean;
  accepted: boolean;
  mode: SkillValidationMode;
  diagnostics: SkillDocumentDiagnostic[];
}

export interface SkillAcceptanceDecision
  extends SkillValidationSummary {
  blockingDiagnostics: SkillDocumentDiagnostic[];
}

export interface SkillPackageResourceInput {
  path: string;
  mimeType: string;
  buffer: Buffer;
  fileType?: SkillFileType;
}

export interface SkillPackageInput {
  source: SkillCreationMethod;
  displayName?: string | null;
  preferredInternalName?: string | null;
  sourceKind: SkillSourceKind;
  sourceRef?: string | null;
  sourceRevision?: string | null;
  rootName?: string | null;
  skillMarkdown: string;
  resources?: SkillPackageResourceInput[];
  provenance?: Record<string, unknown>;
  category?: string | null;
  tags?: string[];
  routingProfile?: Record<string, unknown>;
  growProvenance?: Record<string, unknown>;
}

export interface SkillImportInspectionTokenPayload {
  sourceKind: SkillSourceKind;
  sourceRef: string | null;
  sourceRevision: string | null;
  rootName: string;
  skillMarkdownChecksum: string;
  packageChecksum: string;
  expiresAt: string;
}
