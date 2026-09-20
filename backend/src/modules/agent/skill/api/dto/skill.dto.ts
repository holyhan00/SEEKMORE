                                                       
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { SkillActivationMode, SkillFileType, SkillPermissionAction, SkillPrincipalType, SkillSchemaKind, SkillSourceKind, SkillVersionPolicy, SkillVisibility } from '@prisma/client';
import {
  AGENT_SKILL_ACTIVATION_MODES,
  AGENT_SKILL_EFFECTIVE_ACTIVATION_MODES,
  type AgentSkillActivationMode,
  type EffectiveAgentSkillActivationMode,
} from '../../domain/agent-skill-activation';

export class CreateSkillDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500_000)
  skillMarkdown!: string;
}

export class UpdateSkillDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) displayName?: string;
  @IsOptional() @IsEnum(SkillVisibility) visibility?: SkillVisibility;
  @IsOptional() @IsEnum(SkillActivationMode) defaultActivationMode?: SkillActivationMode;
  @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
}

export class CreateSkillVersionDto {
  @IsString() @MinLength(1) @MaxLength(500_000) skillMarkdown!: string;
  @IsOptional() @IsString() @MaxLength(10_000) changeLog?: string;
  @IsOptional() @IsObject() validationPolicy?: Record<string, unknown>;
  @IsOptional() @IsObject() failurePolicy?: Record<string, unknown>;
  @IsOptional() @IsObject() executionPolicy?: Record<string, unknown>;
}

export class UpdateSkillVersionDto extends CreateSkillVersionDto {
  @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) displayName?: string;
  @IsOptional() @IsInt() @Min(1) expectedSkillRevision?: number;
}

export class SkillListQueryDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(['mine', 'drafts', 'archived', 'deleted']) scope?: 'mine' | 'drafts' | 'archived' | 'deleted';
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() sourceKind?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class SkillFileMetadataDto {
  @IsString() @MinLength(1) @MaxLength(500) path!: string;
  @IsOptional() @IsEnum(SkillFileType) fileType?: SkillFileType;
}

export class BatchSkillFileMetadataDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => SkillFileMetadataDto)
  entries!: SkillFileMetadataDto[];
}

export class DeleteSkillFilesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  fileIds!: string[];
}

export class SkillDependencyInputDto {
  @IsString() @MinLength(1) key!: string;
  @IsOptional() @IsString() versionConstraint?: string | null;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsString() reason?: string | null;
}

export class ReplaceSkillDependenciesDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SkillDependencyInputDto) skillDependencies?: SkillDependencyInputDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SkillDependencyInputDto) toolDependencies?: SkillDependencyInputDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SkillDependencyInputDto) mcpDependencies?: SkillDependencyInputDto[];
}

export class AgentSkillBindingDto {
  @IsString() skillId!: string;
  @IsIn([...AGENT_SKILL_ACTIVATION_MODES]) activationMode!: AgentSkillActivationMode;
  @IsInt() @Min(1) @Max(1000) priority!: number;
  @IsBoolean() enabled!: boolean;
  @IsEnum(SkillVersionPolicy) versionPolicy!: SkillVersionPolicy;
  @IsOptional() @IsString() versionConstraint?: string | null;
  @IsOptional() @IsString() pinnedVersionId?: string | null;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsObject() permissionOverrides?: Record<string, unknown>;
}

export class ReplaceAgentSkillBindingsDto {
  @IsInt() @Min(0) expectedRevision!: number;
  @IsIn([...AGENT_SKILL_EFFECTIVE_ACTIVATION_MODES]) defaultActivationMode!: EffectiveAgentSkillActivationMode;
  @IsOptional() @IsInt() @Min(1) @Max(200) maxCatalogEntries?: number;
  @IsOptional() @IsInt() @Min(1000) @Max(50000) catalogCharBudget?: number;
  @IsOptional() @IsInt() @Min(500) @Max(50000) instructionTokenBudget?: number;
  @IsOptional() @IsInt() @Min(500) @Max(100000) resourceTokenBudget?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) maxAutomaticSkills?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxResourceFiles?: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => AgentSkillBindingDto) bindings!: AgentSkillBindingDto[];
}

export class ConversationSkillActivationDto {
  @IsString() skillId!: string;
  @IsEnum(SkillActivationMode) activationMode!: SkillActivationMode;
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsInt() @Min(-1000) @Max(1000) priority?: number;
  @IsOptional() @IsString() selectedVersionId?: string | null;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsString() expiresAt?: string | null;
}

export class ReplaceConversationSkillsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ConversationSkillActivationDto) activations!: ConversationSkillActivationDto[];
}

export class TestSkillDto {
  @IsString() @MinLength(1) @MaxLength(4000) input!: string;
  @IsOptional() @IsString() versionId?: string;
}


export class SkillSchemaEntryDto {
  @IsEnum(SkillSchemaKind) kind!: SkillSchemaKind;
  @IsObject() schema!: Record<string, unknown>;
}

export class ReplaceSkillSchemasDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SkillSchemaEntryDto) schemas!: SkillSchemaEntryDto[];
}

export class SkillAclEntryDto {
  @IsEnum(SkillPrincipalType) principalType!: SkillPrincipalType;
  @IsString() @MinLength(1) @MaxLength(240) principalId!: string;
  @IsArray() @IsEnum(SkillPermissionAction, { each: true }) permissions!: SkillPermissionAction[];
}

export class ReplaceSkillAclDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SkillAclEntryDto) entries!: SkillAclEntryDto[];
}

export class QuarantineSkillDto {
  @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}

export class UpdateSkillSourceDto {
  @IsEnum(SkillSourceKind) kind!: SkillSourceKind;
  @IsOptional() @IsString() @MaxLength(1000) sourceRef?: string | null;
  @IsOptional() @IsString() @MaxLength(240) sourceRevision?: string | null;
  @IsOptional() @IsObject() provenance?: Record<string, unknown>;
  @IsOptional() @IsObject() lockData?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(128) checksum?: string | null;
}
