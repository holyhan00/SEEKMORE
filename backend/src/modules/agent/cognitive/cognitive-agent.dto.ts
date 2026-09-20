import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

function parseStringArray(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : value; } catch { return raw.split(',').map((item) => item.trim()).filter(Boolean); }
}

export class CreateCognitiveAgentDto {
  @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsString() @MinLength(1) @MaxLength(8000) rolePrompt!: string;
  @IsOptional() capabilities?: string | string[];
  @IsOptional() @IsString() @MaxLength(120) runtimeProfileId?: string;
}

export class UpdateCognitiveAgentDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(8000) rolePrompt?: string;
  @IsOptional() capabilities?: string | string[];
}

export class UploadCognitiveAgentKnowledgeDto {
  @IsOptional() knowledgeFileSpecs?: string | unknown[];
}

export class TestCognitiveAgentDto {
  @IsString() @MinLength(1) @MaxLength(4000) input!: string;
}
