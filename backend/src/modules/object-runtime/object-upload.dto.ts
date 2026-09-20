import { IsString, MaxLength, MinLength } from 'class-validator';

export class ObjectUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  agentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  conversationId!: string;
}
