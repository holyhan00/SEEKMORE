import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateConversationBranchDto {
  @IsString()
  @IsNotEmpty()
  fromMessageId!: string;

  @IsUUID()
  requestId!: string;
}
