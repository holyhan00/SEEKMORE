import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { AiSelectionRole } from '../contracts/llm-settings.types';

export class SaveLlmSettingsDto {
  @IsOptional()
  @IsIn(['primary', 'vision', 'image_generation', 'video_generation', 'audio_generation'])
  role?: AiSelectionRole;

  @IsString() @MinLength(1) @MaxLength(64)
  providerKey!: string;

  @IsOptional() @IsString() @MaxLength(160)
  modelKey?: string;

  @IsOptional() @IsString() @MaxLength(4096)
  apiKey?: string;
}
