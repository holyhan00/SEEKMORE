import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AgentVisibility } from '@prisma/client';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../../../common/http/authenticated-request';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { McpPrincipal } from '../domain/mcp-runtime.types';

@Injectable()
export class McpPrincipalFactory {
  constructor(private readonly prisma: PrismaService) {}

  async fromRequest(request: Request, requestedAgentId?: string): Promise<McpPrincipal> {
    const principal = (request as AuthenticatedRequest).user;
    const userId = String(principal?.id ?? '').trim();
    if (!userId) throw new UnauthorizedException({ code: 'MCP_AUTHENTICATED_PRINCIPAL_REQUIRED', message: 'Authenticated MCP principal is required' });

    const agentId = String(requestedAgentId ?? request.headers['x-seekmore-agent-id'] ?? '').trim() || undefined;
    if (agentId && !principal?.roles?.includes('ADMIN')) {
      const accessible = await this.prisma.agent.findFirst({
        where: {
          id: agentId,
          deletedAt: null,
          isActive: true,
          OR: [
            { userId },
            { userAgents: { some: { userId, deletedAt: null } } },
            { visibility: { in: [AgentVisibility.PUBLIC_FREE, AgentVisibility.PUBLIC_PAID] }, approved: true },
          ],
        },
        select: { id: true },
      });
      if (!accessible) throw new ForbiddenException({ code: 'MCP_AGENT_ACCESS_DENIED', message: 'Agent is not accessible to the authenticated user' });
    }

    return {
      userId,
      agentId,
      roleIds: Array.from(new Set(principal?.roles ?? [principal?.role ?? 'USER'])),
      requestId: header(request.headers['x-request-id']),
      traceId: header(request.headers['x-seekmore-trace-id']),
    };
  }
}

function header(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? '').trim() || undefined;
}
