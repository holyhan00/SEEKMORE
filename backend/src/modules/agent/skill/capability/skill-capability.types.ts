                                                               

import type {
  ToolRequiredSurface,
  ToolRiskLevel,
  ToolSideEffectClass,
} from '../../../../tools/toolstypes';

export type SkillCapabilityRiskLevel = ToolRiskLevel;

export interface SkillCapabilityProvider {
  toolId: string;
  version: string | null;
  displayName: string;
  providerKind: string | null;
  enabled: boolean;
}

export interface SkillCapabilityDefinition {
  id: string;
  description: string;
  riskLevel: SkillCapabilityRiskLevel;
  confirmationRequired: boolean;
  sideEffectClasses: ToolSideEffectClass[];
  requiredSurfaces: ToolRequiredSurface[];
  sourceTypes: string[];
  providers: SkillCapabilityProvider[];
  supported: boolean;
  available: boolean;
  generationEligible: boolean;
}

export type SkillCapabilityResolutionStatus =
  | 'EXACT'
  | 'ALIAS'
  | 'CONCRETE_TOOL'
  | 'AMBIGUOUS'
  | 'UNRESOLVED';

export interface SkillCapabilityResolution {
  rawValue: string;
  capabilityId: string | null;
  status: SkillCapabilityResolutionStatus;
  candidates: string[];
  required: boolean;
  reason: string;
  confirmationRequired: boolean;
}

export interface SkillCapabilityPolicyIssue {
  code: string;
  severity: 'WARNING' | 'ERROR';
  capabilityId: string | null;
  rawValue: string | null;
  message: string;
  params?: Record<string, string | number | boolean | null>;
}

export interface SkillCapabilityPolicyInspection {
  ready: boolean;
  requirements: Array<{
    capabilityId: string;
    required: boolean;
    reason: string;
    confirmationRequired: boolean;
  }>;
  resolutions: SkillCapabilityResolution[];
  issues: SkillCapabilityPolicyIssue[];
}