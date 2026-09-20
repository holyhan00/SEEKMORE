                                                   
import { IsString, IsNotEmpty, IsUUID, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTitleDto {
  @IsUUID()
  @IsNotEmpty()
  agentId!: string;

  @IsString()
  @IsNotEmpty()
  firstMessage!: string;
}

export class RenameTitleDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

                    
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  titleVersion?: number;
}

export class ListByAgentQueryDto {
  @IsUUID()
  @IsNotEmpty()
  agentId!: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number;
}


export class SearchConversationQueryDto {
  @IsString()
  @IsNotEmpty()
  q!: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(50)
  limit?: number;
}

                                         
export class EnsureTitleDto {
  @IsUUID()
  @IsNotEmpty()
  conversationId!: string;
}