                               
import type {
  SkillDocumentDiagnostic,
} from '../types/skill.types';

export type SkillCreateMode =
  | 'STANDARD'
  | 'IMPORT';

export type SkillCreateAction =
  | 'AI'
  | 'SAVE_DRAFT'
  | 'USE_DIRECTLY'
  | 'IMPORT_SAVE_DRAFT'
  | 'IMPORT_USE_DIRECTLY';

export type SkillImportRecognitionState =
  | 'IDLE'
  | 'WAITING'
  | 'INSPECTING'
  | 'ACCEPTED_STANDARD'
  | 'ACCEPTED_COMPATIBLE'
  | 'REJECTED';

export interface SkillMetadataEntry {
  id: string;
  key: string;
  value: string;
}

export interface SkillCreateValidationState {
  diagnostics: SkillDocumentDiagnostic[];
}