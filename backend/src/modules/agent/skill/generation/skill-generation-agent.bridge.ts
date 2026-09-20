import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  AgentVisibility,
  SeekmoreEntityType,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../../prisma/prisma.service';
import type { AgentRuntimeTurnRequest } from '../../../seekmore-agent/contracts/agent-turn.types';
import { DEFAULT_LOCALE_CONTEXT } from '../../../localization/locale.types';

interface SelectedAgent {
  id: string;
  name: string;
}

@Injectable()
export class SkillGenerationAgentBridge {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaService,
  ) {}

  async run(input: {
    userId: string;
    prompt: string;
    agentId?: string | null;
  }): Promise<string> {
    const [runtimeModule, profileModule] = await Promise.all([
      import('../../../seekmore-agent/runtime/agent-runtime.service'),
      import('../../../seekmore-agent/context/agent-profile-context.service'),
    ]);
    const runtime = this.moduleRef.get(
      runtimeModule.AgentRuntimeService,
      { strict: false },
    );
    const profiles = this.moduleRef.get(
      profileModule.AgentProfileContextService,
      { strict: false },
    );
    const agent = await this.resolveAgent(
      input.userId,
      input.agentId,
    );
    const route = await profiles.load({
      userId: input.userId,
      agentId: agent.id,
    });
    const traceId = randomUUID();
    const conversationId = `skill-generation:${randomUUID()}`;
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const localization = DEFAULT_LOCALE_CONTEXT;

    const request: AgentRuntimeTurnRequest = {
      traceId,
      userId: input.userId,
      agentId: agent.id,
      conversationId,
      userMessageId,
      assistantMessageId,
      parentMessageId: null,
      branchId: userMessageId,
      input: input.prompt,
      localization,
      messages: [
        {
          id: userMessageId,
          role: 'user',
          content: input.prompt,
          parentMessageId: null,
        },
      ],
      agent: {
        name: `${agent.name} · Skill Builder`,
        instructions: [
          'Follow the Agent Skills open specification supplied in the user prompt exactly.',
          'Return only the complete SKILL.md content requested by the prompt.',
          'Do not ask follow-up questions. Use conservative defaults when information is missing.',
        ].join('\n'),
        model: route.model,
        provider: route.provider,
        baseUrl: route.baseUrl,
        apiKey: route.apiKey,
        temperature: route.temperature ?? 0.2,
        maxTokens: route.maxTokens ?? 8000,
        apiMode: route.apiMode,
        protocol: route.protocol,
        capabilities: route.modelCapabilities,
        contextWindow: route.contextWindow,
        reasoningEffort: route.reasoningEffort,
        headers: route.headers,
        fallbacks: route.fallbacks,
      },
      workspace: {
        workspaceId: null,
        rootPath: null,
        readAllowed: false,
        writeAllowed: false,
      },
      permissionMode: 'confirm_required',
      accessPolicyVersion: 1,
      tools: [],
      attachedObjects: [],
      maxIterations: 2,
      timeouts: {
        firstToken: this.seconds(
          'SKILL_GENERATION_FIRST_TOKEN_TIMEOUT_S',
          90,
          10,
          300,
        ),
        idle: this.seconds(
          'SKILL_GENERATION_IDLE_TIMEOUT_S',
          90,
          10,
          300,
        ),
        modelTotal: this.seconds(
          'SKILL_GENERATION_TOTAL_TIMEOUT_S',
          240,
          30,
          900,
        ),
        tool: 30,
      },
    };

    const result = await runtime.run(request, {});
    if (result.outcome.kind === 'paused') {
      throw new BadGatewayException({
        code: 'SKILL_GENERATION_PAUSED',
        message: 'SKILL_GENERATION_PAUSED',
        params: { reason: result.outcome.reason },
      });
    }
    if (
      result.outcome.status === 'failed' ||
      result.outcome.status === 'blocked' ||
      result.outcome.status === 'cancelled'
    ) {
      throw new BadGatewayException({
        code: 'SKILL_GENERATION_AGENT_FAILED',
        outcome: result.outcome.status,
        reasonCodes: result.reasonCodes,
        warnings: result.warnings,
      });
    }
    if (!result.content.trim()) {
      throw new BadGatewayException(
        'SKILL_GENERATION_EMPTY_RESULT',
      );
    }
    return result.content;
  }

  private async resolveAgent(
    userId: string,
    requestedAgentId?: string | null,
  ): Promise<SelectedAgent> {
    const baseWhere: Prisma.AgentWhereInput = {
      deletedAt: null,
      isActive: true,
      entityType: SeekmoreEntityType.COGNITIVE,
    };
    const select = {
      id: true,
      name: true,
    } as const;

    if (requestedAgentId) {
      const requested = await this.prisma.agent.findFirst({
        where: {
          AND: [
            baseWhere,
            { id: requestedAgentId },
            {
              OR: [
                { userId },
                {
                  userAgents: {
                    some: { userId },
                  },
                },
                {
                  visibility: {
                    in: [
                      AgentVisibility.PUBLIC_FREE,
                      AgentVisibility.PUBLIC_PAID,
                    ],
                  },
                },
              ],
            },
          ],
        },
        select,
      });
      if (!requested) {
        throw new NotFoundException(
          'SKILL_GENERATION_AGENT_NOT_FOUND',
        );
      }
      return requested;
    }

    const owned = await this.prisma.agent.findFirst({
      where: {
        ...baseWhere,
        userId,
      },
      select,
      orderBy: [
        { isSuper: 'desc' },
        { updatedAt: 'desc' },
      ],
    });
    if (owned) return owned;

    const installed = await this.prisma.agent.findFirst({
      where: {
        ...baseWhere,
        userAgents: {
          some: { userId },
        },
      },
      select,
      orderBy: [
        { isSuper: 'desc' },
        { updatedAt: 'desc' },
      ],
    });
    if (installed) return installed;

    const publicAgent = await this.prisma.agent.findFirst({
      where: {
        ...baseWhere,
        approved: true,
        visibility: {
          in: [
            AgentVisibility.PUBLIC_FREE,
            AgentVisibility.PUBLIC_PAID,
          ],
        },
      },
      select,
      orderBy: [
        { isSuper: 'desc' },
        { updatedAt: 'desc' },
      ],
    });

    if (!publicAgent) {
      throw new NotFoundException(
        'SKILL_GENERATION_AGENT_NOT_FOUND',
      );
    }
    return publicAgent;
  }

  private seconds(
    name: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const parsed = Number(
      process.env[name] ?? fallback,
    );
    return Number.isFinite(parsed)
      ? Math.max(min, Math.min(parsed, max))
      : fallback;
  }
}
