                                                                  
import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GenerateSkillDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  description!: string;

  @IsOptional()
  @IsString()
  license?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  compatibility?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;

  @IsOptional()
  @IsString()
  allowedTools?: string;

  @IsOptional()
  @IsString()
  agentId?: string;
}
