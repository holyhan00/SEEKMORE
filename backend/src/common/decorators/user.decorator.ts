import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedPrincipal, AuthenticatedRequest } from '../http/authenticated-request';

export type RequestUser = AuthenticatedPrincipal;

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user as RequestUser;
  },
);
