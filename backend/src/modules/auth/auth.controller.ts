import {
  Controller,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { authCookieConfig } from '../../common/config/security.config';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedRequest } from '../../common/http/authenticated-request';
import { readCookie } from '../../common/http/cookie.util';
import { AuthService } from './auth.service';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  @Public()
  @Post('local-session')
  localSession(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.createLocalSession(
      request.socket.remoteAddress,
      response,
    );
  }

  @Public()
  @Post('refresh')
  refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookie = authCookieConfig();
    const token = readCookie(
      request.headers.cookie,
      cookie.name,
    );

    return this.authService.refresh(
      token ?? '',
      response,
    );
  }
}
