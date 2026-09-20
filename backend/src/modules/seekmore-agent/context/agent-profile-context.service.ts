import { Injectable, NotFoundException } from '@nestjs/common';
import { AgentVisibility } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { UserLlmConfigResolverService } from '../../llm-settings/application/user-llm-config-resolver.service';
import { KnowledgeRetrievalService } from '../../agent/knowledge/knowledge-retrieval.service';

@Injectable()
export class AgentProfileContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userLlm: UserLlmConfigResolverService,
    private readonly knowledge: KnowledgeRetrievalService,
  ) {}

  async load(input: {
    userId: string;
    agentId: string;
    requestedModel?: string | null;
  }) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: input.agentId,
        deletedAt: null,
        isActive: true,
        OR: [
          { userId: input.userId },
          { visibility: AgentVisibility.PUBLIC_FREE },
          { visibility: AgentVisibility.PUBLIC_PAID },
          { userAgents: { some: { userId: input.userId } } },
        ],
      },
    });

    if (!agent) throw new NotFoundException('AGENT_NOT_FOUND');

    const [route, knowledgeAvailable] = await Promise.all([
      this.userLlm.resolve({
        userId: input.userId,
        requestedModelKey: input.requestedModel,
      }),
      agent.knowledgeEnabled !== false
        ? this.knowledge.hasReadyKnowledge({
            userId: input.userId,
            agentId: input.agentId,
          }).catch(() => false)
        : Promise.resolve(false),
    ]);

    const extra = this.record(agent.llmExtra);
    const instructions = this.identityInstructions({
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      rolePrompt: agent.rolePrompt,
      isSystemAgent: agent.isSuper === true && agent.userId == null,
    });

    return {
      name: agent.name,
      description: agent.description,
      instructions,
      model: route.model,
      provider: route.provider,
      baseUrl: route.baseUrl,
      apiKey: route.apiKey,
      temperature: agent.llmTemperature ?? null,
      maxTokens: this.positiveNumber(extra.maxTokens),
      contextWindow: this.positiveNumber(extra.contextWindow ?? extra.contextLength),
      reasoningEffort: route.supportsReasoning
        ? String(extra.reasoningEffort ?? '').trim() || null
        : null,
      apiMode: route.apiMode,
      headers: route.headers,
      protocol: route.protocol,
      modelCapabilities: route.capabilities,
      modelConfig: route,
      fallbacks: [],
      toolEnabled: agent.toolEnabled !== false && route.supportsTools,
      capabilities: Array.isArray(agent.capabilities) ? agent.capabilities : [],
      knowledgeEnabled: agent.knowledgeEnabled !== false,
      knowledgeAvailable,
      memoryEnabled: agent.memoryEnabled !== false,
    };
  }

  private identityInstructions(input: {
    name: string;
    description?: string | null;
    systemPrompt?: string | null;
    rolePrompt?: string | null;
    isSystemAgent: boolean;
  }): string {
    const name = String(input.name ?? '').trim();
    const description = String(input.description ?? '').trim();
    const systemPrompt = String(input.systemPrompt ?? '').trim();
    const rolePrompt = String(input.rolePrompt ?? '').trim();
    const roleInstructions = input.isSystemAgent
      ? systemPrompt
      : rolePrompt || systemPrompt;

    return [
      '# Agent Identity',
      name ? `Name: ${name}` : '',
      description ? `Description: ${description}` : '',
      roleInstructions ? `# Role Instructions\n${roleInstructions}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private positiveNumber(value: unknown): number | null {
    const result = Number(value ?? 0);
    return Number.isFinite(result) && result > 0 ? result : null;
  }

  private record(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : {};
  }
}
