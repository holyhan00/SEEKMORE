import type { SkillSourceKind } from '@prisma/client';
import type {
  SkillDocumentDiagnostic,
  SkillPackageResourceInput,
  SkillValidationSummary,
} from '../domain/skill-document.types';

export interface SkillGenerationInput {
  displayName: string;
  description: string;
  license?: string | null;
  compatibility?: string | null;
  metadata?: Record<string, string>;
  allowedTools?: string | null;
  agentId?: string | null;
}

export interface SkillGenerationResult {
  displayName: string;
  internalName: string;
  skillMarkdown: string;
  diagnostics: SkillDocumentDiagnostic[];
  validation: SkillValidationSummary;
  generationAttempts: number;
}

export interface SkillImportFileSummary {
  path: string;
  mimeType: string;
  sizeBytes: number;
  fileType:
    | 'REFERENCE'
    | 'SCRIPT'
    | 'ASSET'
    | 'LICENSE'
    | 'OTHER';
  executable: boolean;
}

export interface SkillImportPackage {
  sourceKind: SkillSourceKind;
  sourceRef: string | null;
  sourceRevision: string | null;
  detectedFormat: 'SKILL_MD' | 'ZIP' | 'GITHUB';
  rootName: string | null;
  skillMarkdown: string;
  resources: SkillPackageResourceInput[];
  notes: string[];
}

export interface SkillImportInspection {
  inspectionToken: string;
  sourceKind: SkillSourceKind;
  sourceRef: string | null;
  sourceRevision: string | null;
  detectedFormat: SkillImportPackage['detectedFormat'];
  rootName: string;
  name: string;
  displayName: string;
  description: string;
  skillMarkdown: string;
  files: SkillImportFileSummary[];
  diagnostics: SkillDocumentDiagnostic[];
  validation: SkillValidationSummary;
  security: {
    passed: boolean;
    diagnostics: SkillDocumentDiagnostic[];
  };
  notes: string[];
}

export interface SkillImportInspectResult {
  inspection: SkillImportInspection;
}
