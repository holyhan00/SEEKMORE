import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { AgentExperienceEpisode, ExperienceEvent } from './experience.types';
import type { ModelUsage } from '../runtime/model/model.types';
import { evaluateExperience } from './experience-eval';

@Injectable()
export class ExperienceBuilderService {
  constructor(private readonly prisma: PrismaService) {}
  async build(traceId: string): Promise<AgentExperienceEpisode> {
    const turn = await this.prisma.agentTurn.findUniqueOrThrow({ where: { traceId }, include: { approvals: { select: { approvalId: true, status: true, decision: true, decidedAt: true } }, inputs: { orderBy: { sequence: 'asc' } }, events: { orderBy: { sequence: 'asc' } } } });
    const request = record(turn.requestJson);
    const events: ExperienceEvent[] = turn.events.map((event) => ({ id: event.id, sequence: event.sequence, kind: event.kind, iteration: event.iteration, payload: record(event.payloadJson), occurredAt: event.createdAt.toISOString() }));
    const worlds = events.filter((event) => event.kind === 'world.observed');
    const model = events.filter((event) => event.kind === 'model.decision');
    const usage: ModelUsage = {};
    for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'totalTokens'] as const) {
      const values = model.map((event) => event.payload.usage?.[key]);
      if (values.length && values.every((value) => typeof value === 'number')) usage[key] = values.reduce((a, b) => a + b, 0);
    }
    return { turnId: turn.id, traceId, goal: String(request.input ?? ''),
      goalRevisions: turn.inputs.filter((row) => row.kind !== 'CONTEXT_INJECTION').map((row) => ({ inputId: row.id, content: row.content, kind: row.kind })),
      initialWorldState: worlds.length ? worlds[0].payload as any : null,
      relevantWorldChanges: worlds.slice(1).map((event) => ({ eventId: event.id, revision: String(event.payload.revision) })),
      inputs: turn.inputs.map((row) => ({ id: row.id, kind: row.kind, content: row.content, consumedAt: row.consumedAt?.toISOString() ?? null })),
      events, toolActions: events.filter((event) => event.kind === 'tools.observed').flatMap((event) => event.payload.records ?? []),
      outcome: { runtimeStatus: turn.status, completionDecision: [...events].reverse().find((event) => event.kind === 'completion.decided')?.payload ?? null },
      usage: Object.keys(usage).length ? usage : null, startedAt: turn.startedAt.toISOString(), completedAt: turn.completedAt?.toISOString() ?? null,
      approvals: turn.approvals.map((row) => ({ ...row, decidedAt: row.decidedAt?.toISOString() ?? null })),
      costs: null, userFeedback: null, availability: { journal: events.length > 0, environmentEvaluator: false, feedback: false, cost: false } };
  }
  async evaluate(traceId: string) { return evaluateExperience(await this.build(traceId)); }
}
function record(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
