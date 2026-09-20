                                                          
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MemoryScopeDto {
  @IsOptional() @IsString() tenantId?: string | null;
  @IsOptional() @IsString() orgId?: string | null;
  @IsOptional() @IsString() groupId?: string | null;
  @IsOptional() @IsString() planId?: string | null;
  @IsOptional() @IsString() projectId?: string | null;
  @IsOptional() @IsString() agentId?: string | null;
  @IsOptional() @IsString() conversationId?: string | null;
}

export class BuildMemoryContextDto {
  @ValidateNested()
  @Type(() => MemoryScopeDto)
  scope!: MemoryScopeDto;

  @IsString()
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  maxItems?: number;
}

export class ConfirmedMemoryCandidateDto {
  @IsIn([
    'identity',
    'preference',
    'constraint',
    'project_state',
    'goal',
    'relationship',
    'workflow',
    'tool_preference',
    'event',
    'episode',
  ])
  kind!: string;

  @IsString()
  subject!: string;

  @IsString()
  predicate!: string;

  @IsObject()
  value!: Record<string, unknown>;

  @IsString()
  summary!: string;

  @IsIn(['user', 'agent', 'conversation', 'project', 'org', 'group', 'plan'])
  scopeLevel!: string;

  @IsIn(['long_term', 'session', 'ephemeral'])
  stability!: string;

  @IsIn(['normal', 'private', 'sensitive', 'restricted'])
  sensitivity!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class MemoryOperationActorDto {
  @IsOptional() @IsString() userId?: string | null;
  @IsOptional() @IsString() agentId?: string | null;
  @IsOptional() @IsString() role?: string | null;
}

export class WriteMemoryDto {
  @ValidateNested()
  @Type(() => MemoryScopeDto)
  scope!: MemoryScopeDto;

  @IsIn(['remember', 'forget', 'update', 'correct', 'restore', 'implicit_candidate', 'none'])
  intent!: 'remember' | 'forget' | 'update' | 'correct' | 'restore' | 'implicit_candidate' | 'none';

  @IsIn(['explicit', 'implicit'])
  explicitness!: 'explicit' | 'implicit';

  @IsOptional()
  @IsString()
  userText?: string | null;

  @IsOptional()
  @IsString()
  assistantText?: string | null;

  @IsOptional()
  @IsObject()
  source?: {
    conversationId?: string | null;
    userMessageId?: string | null;
    assistantMessageId?: string | null;
  };

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ConfirmedMemoryCandidateDto)
  confirmedCandidates?: ConfirmedMemoryCandidateDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetMemoryIds?: string[];

  @IsOptional()
  @IsIn(['conversation', 'management_ui', 'api', 'system'])
  operationSource?: 'conversation' | 'management_ui' | 'api' | 'system';

  @IsOptional()
  @ValidateNested()
  @Type(() => MemoryOperationActorDto)
  operationActor?: MemoryOperationActorDto;

  @IsOptional()
  @IsString()
  reason?: string | null;
}

export class ListMemoryQueryDto {
  @IsOptional() @IsString() tenantId?: string | null;
  @IsOptional() @IsString() orgId?: string | null;
  @IsOptional() @IsString() groupId?: string | null;
  @IsOptional() @IsString() planId?: string | null;
  @IsOptional() @IsString() projectId?: string | null;
  @IsOptional() @IsString() agentId?: string | null;
  @IsOptional() @IsString() conversationId?: string | null;
  @IsOptional() @IsString() cursor?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ListMemoryManagementQueryDto extends ListMemoryQueryDto {
  @IsOptional()
  @IsIn(['active', 'superseded', 'deleted', 'conflicted', 'pending_confirmation', 'all'])
  status?: 'active' | 'superseded' | 'deleted' | 'conflicted' | 'pending_confirmation' | 'all';

  @IsOptional()
  @IsIn(['user', 'agent', 'conversation', 'project', 'org', 'group', 'plan'])
  scopeLevel?: string;

  @IsOptional()
  @IsIn([
    'identity',
    'preference',
    'constraint',
    'project_state',
    'goal',
    'relationship',
    'workflow',
    'tool_preference',
    'event',
    'episode',
  ])
  kind?: string;

  @IsOptional()
  @IsIn(['normal', 'private', 'sensitive', 'restricted'])
  sensitivity?: string;

  @IsOptional()
  @IsString()
  keyword?: string | null;
}

export class MemoryIdParamDto {
  @IsString()
  memoryId!: string;
}

export class MemoryMutationDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => MemoryScopeDto)
  scope?: MemoryScopeDto;

  @IsOptional()
  @IsString()
  reason?: string | null;
}

export class ListMemoryAuditQueryDto extends ListMemoryQueryDto {
  @IsOptional()
  @IsString()
  memoryId?: string | null;
}