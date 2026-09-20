import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type RequestUser } from '../../../common/decorators/user.decorator';
import { WebSearchSettingsService } from '../application/web-search-settings.service';
import { SaveWebSearchSettingsDto } from './web-search-settings.dto';

@Controller('web-search-settings')
export class WebSearchSettingsController {
  constructor(private readonly settings: WebSearchSettingsService) {}

  @Get('catalog')
  catalog() {
    return this.settings.catalog();
  }

  @Get('me')
  current(@CurrentUser() user: RequestUser) {
    return this.settings.get(user.id);
  }

  @Put('me')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  save(@CurrentUser() user: RequestUser, @Body() body: SaveWebSearchSettingsDto) {
    return this.settings.save(user.id, body);
  }

  @Delete('me')
  remove(@CurrentUser() user: RequestUser) {
    return this.settings.remove(user.id);
  }
}
