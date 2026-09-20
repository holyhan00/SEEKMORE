import { IsBoolean } from 'class-validator';

export class UpdateToolEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}
