import { IsIn, IsNumberString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const OBJECT_ORIGIN_TYPES = ['user_upload', 'runtime_generated'] as const;

const OBJECT_KINDS = [
  'document', 'spreadsheet', 'presentation', 'pdf', 'html', 'markdown', 'text', 'image',
  'audio', 'video', 'archive', 'code', 'binary', 'unknown',
] as const;

export class ObjectPartitionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  agentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  conversationId!: string;
}

export class ObjectSearchDto extends ObjectPartitionDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  query?: string;

  @IsOptional()
  @IsIn(OBJECT_KINDS)
  objectKind?: typeof OBJECT_KINDS[number];

  @IsOptional()
  @IsIn(OBJECT_ORIGIN_TYPES)
  originType?: typeof OBJECT_ORIGIN_TYPES[number];

  @IsOptional()
  @IsString()
  @MaxLength(32)
  extension?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  cursor?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}
