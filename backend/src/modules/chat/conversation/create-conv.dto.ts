                                                           
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateConversationDto {
  @IsString()
  @IsNotEmpty()
  agentId!: string;

  @IsString()
  @IsOptional()
  firstMessage?: string;
}