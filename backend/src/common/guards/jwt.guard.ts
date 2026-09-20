import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { jwtAccessConfig } from '../config/security.config';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { appError } from '../errors/app-error';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(appError('AUTHORIZATION_HEADER_INVALID'));
    }

    const token = authHeader.slice(7).trim();
    if (!token) throw new UnauthorizedException(appError('ACCESS_TOKEN_REQUIRED'));

    try {
      const config = jwtAccessConfig();
      const payload = await this.jwtService.verifyAsync<{
        sub?: string;
        email?: string;
        role?: string;
        typ?: string;
        jti?: string;
        sid?: string;
      }>(token, {
        secret: config.secret,
        issuer: config.issuer,
        audience: config.audience,
      });
      const userId = String(payload.sub ?? '').trim();
      const role = String(payload.role ?? '').trim();
      const sessionId = String(payload.sid ?? '').trim();
      if (!userId || !role || !sessionId || payload.typ !== 'access') {
        throw new Error('Invalid access-token claims');
      }
      const account = await this.prisma.localAccount.findFirst({
        where: {
          key: 'primary',
          userId,
          sessionId,
          user: { isActive: true, deletedAt: null },
        },
        select: { userId: true },
      });
      if (!account) throw new Error('Token does not belong to this installation');
      (request as Request & { user?: unknown }).user = {
        id: userId,
        email: payload.email ?? null,
        role,
        roles: [role],
        tokenId: payload.jti ?? null,
      };
      return true;
    } catch {
      throw new UnauthorizedException(appError('ACCESS_TOKEN_INVALID'));
    }
  }
}
