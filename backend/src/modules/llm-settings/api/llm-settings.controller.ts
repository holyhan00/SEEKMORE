import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type RequestUser } from '../../../common/decorators/user.decorator';
import { LlmSettingsService } from '../application/llm-settings.service';
import { SaveLlmSettingsDto } from './llm-settings.dto';

@Controller('llm-settings')
export class LlmSettingsController {
  constructor(private readonly settings: LlmSettingsService) {}

  @Get('catalog')
  catalog() {
    return this.settings.catalogView();
  }

  @Get('me')
  get(@CurrentUser() user: RequestUser) {
    return this.settings.get(user.id);
  }

  @Put('me')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  save(@CurrentUser() user: RequestUser, @Body() body: SaveLlmSettingsDto) {
    return this.settings.save(user.id, body);
  }

  @Delete('me/roles/:role')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  clearRole(
    @CurrentUser() user: RequestUser,
    @Param('role') role: string,
  ) {
    if (role !== 'vision' && role !== 'image_generation' && role !== 'video_generation' && role !== 'audio_generation') {
      return this.settings.get(user.id);
    }
    return this.settings.clearRole(user.id, role);
  }

  @Delete('me/credentials/:providerKey')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async delete(@CurrentUser() user: RequestUser, @Param('providerKey') providerKey: string) {
    await this.settings.deleteCredential(user.id, providerKey);
    return { ok: true };
  }
}
