import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { Response } from 'express';
import {
  authCookieConfig,
  jwtAccessConfig,
  jwtRefreshConfig,
  localIdentityConfig,
  REFRESH_TOKEN_LIFETIME_MS,
} from '../../common/config/security.config';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashPassword } from './utils/hash';
import { SystemAgentService } from '../agent/system/systemagent.service';

const LOCAL_ACCOUNT_KEY = 'primary';
const LOCAL_USER_EMAIL = 'local@seekmore.invalid';
const LOCAL_USER_NAME = 'SEEKMORE';

const LOOPBACK_ADDRESSES = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
]);

type AuthUser = {
  id: string;
  email: string;
  role: string;
};

type RefreshPayload = {
  sub: string;
  sid: string;
  typ: 'refresh';
  jti: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly systemAgentService: SystemAgentService,
  ) {}

  async createLocalSession(
    remoteAddress: string | undefined,
    response: Response,
  ) {
    this.assertLocalIdentityRequest(remoteAddress);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.localAccount.upsert({
        where: { key: LOCAL_ACCOUNT_KEY },
        create: { key: LOCAL_ACCOUNT_KEY },
        update: {},
      });

      await tx.$queryRaw`
        SELECT "key"
        FROM "local_account"
        WHERE "key" = ${LOCAL_ACCOUNT_KEY}
        FOR UPDATE
      `;

      const account = await tx.localAccount.findUnique({
        where: { key: LOCAL_ACCOUNT_KEY },
        include: { user: true },
      });

      if (!account) {
        throw new ConflictException({
          code: 'LOCAL_IDENTITY_UNAVAILABLE',
          message: 'LOCAL_IDENTITY_UNAVAILABLE',
        });
      }

      let user = account.user;

      if (!account.userId) {
        const existingUsers = await tx.user.findMany({
          orderBy: { createdAt: 'asc' },
          take: 2,
        });

        if (existingUsers.length > 1) {
          throw new ConflictException({
            code: 'LOCAL_IDENTITY_CONFLICT',
            message: 'LOCAL_IDENTITY_CONFLICT',
          });
        }

        if (existingUsers.length === 1) {
          user = existingUsers[0];
        } else {
          user = await tx.user.create({
            data: {
              email: LOCAL_USER_EMAIL,
              username: LOCAL_USER_NAME,
              passwordHash: await hashPassword(
                randomBytes(48).toString('base64url'),
              ),
            },
          });
        }
      }

      if (!user || !user.isActive || user.deletedAt) {
        throw new ConflictException({
          code: 'LOCAL_IDENTITY_UNAVAILABLE',
          message: 'LOCAL_IDENTITY_UNAVAILABLE',
        });
      }

      await this.systemAgentService.ensureDefaultSystemAgentForUser(
        user.id,
        tx,
      );

      const expiresAt = new Date(
        Date.now() + REFRESH_TOKEN_LIFETIME_MS,
      );
      const sessionId = randomUUID();
      const tokens = await this.createTokenPair(
        {
          id: user.id,
          email: user.email,
          role: String(user.role),
        },
        expiresAt,
        sessionId,
      );

      await tx.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          failedLoginAttempts: 0,
          accountLockedUntil: null,
        },
      });

      await tx.localAccount.update({
        where: { key: LOCAL_ACCOUNT_KEY },
        data: {
          userId: user.id,
          initializedAt: account.initializedAt ?? new Date(),
          sessionId,
          refreshTokenHash: this.hashRefreshToken(
            tokens.refreshToken,
          ),
          refreshTokenExpiresAt: expiresAt,
        },
      });

      return tokens;
    }, {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable,
    });

    this.setRefreshCookie(
      response,
      result.refreshToken,
      result.refreshExpiresAt,
    );

    return {
      access_token: result.accessToken,
    };
  }

  async refresh(
    refreshToken: string,
    response: Response,
  ) {
    const config = jwtRefreshConfig();
    let payload: RefreshPayload;

    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(
        refreshToken,
        {
          secret: config.secret,
          issuer: config.issuer,
          audience: config.audience,
        },
      );
    } catch {
      this.clearRefreshCookie(response);
      throw new ForbiddenException({
        code: 'AUTH_SESSION_EXPIRED',
        message: 'AUTH_SESSION_EXPIRED',
      });
    }

    if (
      payload.typ !== 'refresh'
      || !payload.sub
      || !payload.jti
    ) {
      this.clearRefreshCookie(response);
      throw new ForbiddenException({
        code: 'AUTH_SESSION_EXPIRED',
        message: 'AUTH_SESSION_EXPIRED',
      });
    }

    const account = await this.prisma.localAccount.findUnique({
      where: { key: LOCAL_ACCOUNT_KEY },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            deletedAt: true,
          },
        },
      },
    });

    const presentedHash = this.hashRefreshToken(refreshToken);
    const valid = account?.userId === payload.sub
      && account.sessionId === payload.sid
      && account.user?.isActive
      && !account.user.deletedAt
      && account.refreshTokenHash
      && this.safeHashEquals(
        account.refreshTokenHash,
        presentedHash,
      )
      && account.refreshTokenExpiresAt
      && account.refreshTokenExpiresAt.getTime() > Date.now();

    if (
      !valid
      || !account?.user
      || !account.refreshTokenExpiresAt
      || !account.sessionId
    ) {
      this.clearRefreshCookie(response);
      throw new ForbiddenException({
        code: 'AUTH_SESSION_EXPIRED',
        message: 'AUTH_SESSION_EXPIRED',
      });
    }

    const tokens = await this.createTokenPair(
      {
        id: account.user.id,
        email: account.user.email,
        role: String(account.user.role),
      },
      account.refreshTokenExpiresAt,
      account.sessionId,
    );

    const updated = await this.prisma.localAccount.updateMany({
      where: {
        key: LOCAL_ACCOUNT_KEY,
        userId: payload.sub,
        refreshTokenHash: presentedHash,
      },
      data: {
        refreshTokenHash: this.hashRefreshToken(
          tokens.refreshToken,
        ),
      },
    });

    if (updated.count !== 1) {
      this.clearRefreshCookie(response);
      throw new ForbiddenException({
        code: 'AUTH_SESSION_EXPIRED',
        message: 'AUTH_SESSION_EXPIRED',
      });
    }

    this.setRefreshCookie(
      response,
      tokens.refreshToken,
      account.refreshTokenExpiresAt,
    );

    return {
      access_token: tokens.accessToken,
    };
  }

  private assertLocalIdentityRequest(
    remoteAddress: string | undefined,
  ): void {
    if (!localIdentityConfig().enabled) {
      throw new ForbiddenException({
        code: 'LOCAL_IDENTITY_DISABLED',
        message: 'LOCAL_IDENTITY_DISABLED',
      });
    }

    if (!LOOPBACK_ADDRESSES.has(String(remoteAddress ?? '').trim())) {
      throw new ForbiddenException({
        code: 'LOCAL_IDENTITY_LOOPBACK_ONLY',
        message: 'LOCAL_IDENTITY_LOOPBACK_ONLY',
      });
    }
  }

  private async createTokenPair(
    user: AuthUser,
    refreshExpiresAt: Date,
    sessionId: string,
  ) {
    const accessToken = await this.signAccessToken(
      user,
      sessionId,
    );
    const refreshConfig = jwtRefreshConfig();
    const secondsRemaining = Math.max(
      1,
      Math.floor(
        (refreshExpiresAt.getTime() - Date.now()) / 1000,
      ),
    );
    const refreshToken = await this.jwt.signAsync<RefreshPayload>(
      {
        sub: user.id,
        sid: sessionId,
        typ: 'refresh',
        jti: randomUUID(),
      },
      {
        secret: refreshConfig.secret,
        issuer: refreshConfig.issuer,
        audience: refreshConfig.audience,
        expiresIn: secondsRemaining,
      },
    );

    return {
      accessToken,
      refreshToken,
      refreshExpiresAt,
    };
  }

  private async signAccessToken(
    user: AuthUser,
    sessionId: string,
  ): Promise<string> {
    const config = jwtAccessConfig();

    return this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      sid: sessionId,
      typ: 'access',
      jti: randomUUID(),
    }, {
      secret: config.secret,
      issuer: config.issuer,
      audience: config.audience,
      expiresIn: config.expiresIn as never,
    });
  }

  private setRefreshCookie(
    response: Response,
    token: string,
    expiresAt: Date,
  ): void {
    const cookie = authCookieConfig();

    response.cookie(cookie.name, token, {
      httpOnly: true,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      domain: cookie.domain,
      path: cookie.path,
      maxAge: Math.max(
        0,
        expiresAt.getTime() - Date.now(),
      ),
    });
  }

  private clearRefreshCookie(response: Response): void {
    const cookie = authCookieConfig();

    response.clearCookie(cookie.name, {
      httpOnly: true,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      domain: cookie.domain,
      path: cookie.path,
    });
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256')
      .update(token)
      .digest('hex');
  }

  private safeHashEquals(
    left: string,
    right: string,
  ): boolean {
    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');

    return leftBuffer.length === rightBuffer.length
      && timingSafeEqual(leftBuffer, rightBuffer);
  }
}
