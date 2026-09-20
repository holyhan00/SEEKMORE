                                              

import {
  Body,
  Controller,
  Get,
  Patch,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { UpdateUserProfileDto } from './user.dto';
import { UserService } from './user.service';

interface UpdateLocalizationPreferencesBody {
  preferredLanguage?: string | null;
}

const USER_AVATAR_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
};

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(JwtGuard)
  @Get('me')
  getMe(@CurrentUserId() userId: string) {
    return this.userService.getUserProfile(userId);
  }

  @UseGuards(JwtGuard)
  @Get('avatar')
  async getAvatar(@CurrentUserId() userId: string) {
    const image = await this.userService.getUserAvatar(userId);

    return new StreamableFile(image.buffer, {
      type: image.mimeType,
      disposition: 'inline',
    });
  }

  @UseGuards(JwtGuard)
  @Patch('profile')
  @UseInterceptors(
    FileInterceptor('avatarFile', USER_AVATAR_UPLOAD_OPTIONS),
  )
  updateProfile(
    @CurrentUserId() userId: string,
    @Body() body: UpdateUserProfileDto,
    @UploadedFile() avatarFile?: Express.Multer.File,
  ) {
    return this.userService.updateUserProfile(
      userId,
      body ?? {},
      avatarFile ?? null,
    );
  }

  @UseGuards(JwtGuard)
  @Patch('preferences/localization')
  updateLocalizationPreferences(
    @CurrentUserId() userId: string,
    @Body() body: UpdateLocalizationPreferencesBody,
  ) {
    return this.userService.updateLocalizationPreferences(
      userId,
      body ?? {},
    );
  }

}
