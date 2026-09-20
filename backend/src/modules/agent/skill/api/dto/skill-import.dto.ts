import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class InspectSkillImportDto {
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  repositoryUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  content?: string;
}

export class CommitSkillImportDto extends InspectSkillImportDto {
  @IsString()
  @MinLength(64)
  @MaxLength(128)
  packageChecksum!: string;
}
