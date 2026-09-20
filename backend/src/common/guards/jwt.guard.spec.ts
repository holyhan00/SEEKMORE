import { UnauthorizedException } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';

function contextFor(request: Record<string, unknown>) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as any;
}

describe('JwtGuard', () => {
  it('publishes the canonical authenticated principal', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };
    const jwtService = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: 'user-1',
        email: 'user@example.com',
        role: 'USER',
        typ: 'access',
        sid: 'session-1',
        jti: 'token-1',
      }),
    };
    const prisma = {
      localAccount: {
        findFirst: jest.fn().mockResolvedValue({ userId: 'user-1' }),
      },
    };
    const request: Record<string, any> = {
      headers: { authorization: 'Bearer token' },
    };
    const guard = new JwtGuard(reflector as any, jwtService as any, prisma as any);

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      email: 'user@example.com',
      role: 'USER',
      roles: ['USER'],
      tokenId: 'token-1',
    });
    expect(request.user.userId).toBeUndefined();
    expect(request.user.sub).toBeUndefined();
  });

  it('rejects requests before controller execution when authorization is missing', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };
    const guard = new JwtGuard(
      reflector as any,
      { verifyAsync: jest.fn() } as any,
      { localAccount: { findFirst: jest.fn() } } as any,
    );

    await expect(
      guard.canActivate(contextFor({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
