import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRuntimeWorkspaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  rootPath!: string;

  @IsOptional()
  @IsString()
  source?: 'desktop_picker';
}

export class RegisterRuntimeWorkspaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  rootPath!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;
}

export class UpdateRuntimeWorkspaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

export class SetDefaultRuntimeWorkspaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  workspaceId!: string;
}
