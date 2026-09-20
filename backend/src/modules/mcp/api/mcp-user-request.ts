import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

export type McpAuthenticatedRequest = Request & { user?: { userId?: string; id?: string; sub?: string } };

export function mcpUserId(request: McpAuthenticatedRequest): string {
  const id = String(request.user?.userId ?? request.user?.id ?? request.user?.sub ?? '').trim();
  if (!id) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
  return id;
}
