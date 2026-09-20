import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateUserProfileDto {
  @IsOptional()
  @IsString({ message: 'USER_USERNAME_INVALID' })
  @MinLength(1, { message: 'USER_USERNAME_REQUIRED' })
  @MaxLength(255, { message: 'USER_USERNAME_TOO_LONG' })
  username?: string;
}
