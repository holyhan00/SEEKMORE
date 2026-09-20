import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SaveWebSearchSettingsDto {
  @IsString() @MinLength(1) @MaxLength(64)
  providerKey!: string;

  @IsOptional() @IsString() @MaxLength(4096)
  apiKey?: string;
}
