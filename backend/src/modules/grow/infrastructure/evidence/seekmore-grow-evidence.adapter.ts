import { Injectable } from '@nestjs/common';
import {
  SkillUsageOutcome,
} from '@prisma/client';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { ExperienceBuilderService } from '../../../seekmore-agent/experience/experience-builder.service';
import { evaluateExperience } from '../../../seekmore-agent/experience/experience-eval';
import type {
  GrowArtifactSummary,
  GrowFailureSummary,
  GrowLoadedSkillSummary,
  GrowTerminalEvent,
  GrowTerminalStatus,
  GrowToolExecutionSummary,
  GrowTurnEvidence,
} from '../../domain/grow.types';
import type { GrowEvidencePort } from '../../ports/grow-evidence.port';
import { isGrowSyntheticRun } from '../../domain/grow-synthetic-run.util';

@Injectable()
export class SeekmoreGrowEvidenceAdapter implements GrowEvidencePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly experiences: ExperienceBuilderService,
  ) {}

  async loadTerminalEvidence(event: GrowTerminalEvent): Promise<GrowTurnEvidence | null> {
    const turn = await this.prisma.agentTurn.findUnique({
      where: { traceId: event.traceId },
    });
    if (!turn) throw new Error(`GROW_SOURCE_TURN_NOT_FOUND:${event.traceId}`);
    if (isGrowSyntheticRun({ traceId: turn.traceId, requestJson: turn.requestJson })) {
      return null;
    }
    return this.mapTurn(turn);
  }

  async loadRecentEvidence(input: {
    userId: string;
    agentId: string;
    conversationId: string;
    afterTurnId?: string | null;
    limit: number;
  }): Promise<GrowTurnEvidence[]> {
    const after = input.afterTurnId
      ? await this.prisma.agentTurn.findUnique({
          where: { id: input.afterTurnId },
          select: { startedAt: true },
        })
      : null;
    const rows = await this.prisma.agentTurn.findMany({
      where: {
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        completedAt: { not: null },
        ...(after?.startedAt ? { startedAt: { gt: after.startedAt } } : {}),
      },
      orderBy: { startedAt: 'desc' },
                                                                              
                                                                               
                              
      take: Math.max(1, Math.min(input.limit * 3, 60)),
    });
    const ordered = rows
      .reverse()
      .filter((row) => !isGrowSyntheticRun({
        traceId: row.traceId,
        requestJson: row.requestJson,
      }))
      .slice(-Math.max(1, input.limit));
    const output: GrowTurnEvidence[] = [];
    for (const row of ordered) output.push(await this.mapTurn(row));
    return output;
  }

  private async mapTurn(turn: any): Promise<GrowTurnEvidence> {
    const request = this.record(turn.requestJson);
    const result = this.record(turn.resultJson);
    const userNeed = this.text(request.input) || await this.messageText(turn.userMessageId);
    const finalResultSummary = this.text(result.content) || await this.messageText(turn.assistantMessageId);
    const episode = await this.experiences.build(turn.traceId);
    const evaluation = evaluateExperience(episode);
    const userInputs = [userNeed, ...episode.inputs.filter((row) => row.kind !== 'CONTEXT_INJECTION').map((row) => row.content)].join('\n');
    const supplements = episode.inputs.filter((row) => row.kind !== 'CONTEXT_INJECTION').map((row) => row.content).join('\n');
    const toolExecutions: GrowToolExecutionSummary[] = episode.toolActions.map((row) => ({
      toolName: row.canonicalName ?? row.call.name,
      status: row.result.status === 'requires_confirmation' ? 'blocked' : row.result.status,
      summary: row.result.status === 'completed' ? this.truncate(row.result.observation, 1500) : row.result.status === 'failed' ? row.result.message : row.result.reason,
      durationMs: row.durationMs,
      ...(row.result.status === 'failed' ? { errorCode: row.result.errorCode, retryable: row.result.retryable } : {}),
    }));
    const loadedSkills = await this.loadedSkills(turn.traceId);
    const terminalStatus = this.terminalStatus(turn.status);
    const failures = this.failures(turn, result, toolExecutions, terminalStatus);

    return {
      turnId: turn.id,
      traceId: turn.traceId,
      userId: turn.userId,
      agentId: turn.agentId,
      conversationId: turn.conversationId,
      userNeed: this.truncate(userNeed, 12_000),
      constraints: this.constraints(userInputs),
      finalResultSummary: this.truncate(finalResultSummary, 16_000),
      terminalStatus,
      toolIterations: new Set(episode.events.filter((event) => event.kind === 'tools.dispatched').map((event) => event.iteration)).size,
      evaluation,
      experienceRef: episode.turnId,
      toolExecutions,
      artifacts: this.artifacts(result.objects),
      loadedSkills,
      explicitPreferences: this.explicitPreferences(userInputs),
      corrections: this.corrections(supplements),
      acceptances: this.acceptances(supplements),
      rejections: this.rejections(supplements),
      failures,
      relevantMemories: [],
      explicitLearningRequested: this.explicitLearning([userNeed, ...episode.inputs.map((row) => row.content)].join('\n')),
      occurredAt: (turn.completedAt ?? turn.updatedAt ?? new Date()).toISOString(),
    };
  }

  private async loadedSkills(traceId: string): Promise<GrowLoadedSkillSummary[]> {
    const rows = await this.prisma.skillUsageEvent.findMany({
      where: { traceId, outcome: SkillUsageOutcome.LOADED },
      include: {
        skill: { include: { source: true } },
        version: true,
      },
      orderBy: { occurredAt: 'asc' },
    });
    const bySkill = new Map<string, GrowLoadedSkillSummary>();
    for (const row of rows) {
      bySkill.set(row.skillId, {
        skillId: row.skillId,
        versionId: row.skillVersionId,
        name: row.skill.name,
        description: row.skill.description,
        source: row.skill.source?.kind,
        locked: row.skill.growLocked,
        protected: !row.skill.growEnabled,
        usageResult: 'loaded',
      });
    }
    return [...bySkill.values()];
  }

  private artifacts(value: unknown): GrowArtifactSummary[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 20).map((item) => {
      const row = this.record(item);
      const metadata = this.record(row.metadata ?? row.meta);
      return {
        type: this.text(row.objectKind ?? row.kind ?? row.type) || 'runtime_object',
        name: this.text(row.displayName ?? row.name ?? row.originalName) || undefined,
        validationStatus: metadata.validationStatus === 'passed'
          ? 'passed'
          : metadata.validationStatus === 'failed'
            ? 'failed'
            : 'unknown',
        summary: this.truncate(
          this.text(row.contentSummary ?? row.summary ?? metadata.summary),
          1_500,
        ) || undefined,
      };
    });
  }

  private failures(
    turn: any,
    result: Record<string, unknown>,
    tools: GrowToolExecutionSummary[],
    status: GrowTerminalStatus,
  ): GrowFailureSummary[] {
    const output: GrowFailureSummary[] = [];
    const reasonCodes = Array.isArray(result.reasonCodes)
      ? result.reasonCodes.map(String)
      : [];
    const failedTools = tools.filter((item) => item.status === 'failed');
    if (status === 'blocked') {
      output.push({ type: 'policy_block', summary: 'The source turn was blocked by policy.' });
    } else if (status === 'failed' || failedTools.length) {
      const dependency = failedTools.some((item) =>
        /dependency|not_found|unavailable|not_configured/i.test(item.errorCode ?? ''),
      );
      const transient = failedTools.some((item) =>
        item.retryable || /timeout|rate_limit|network|temporar/i.test(item.errorCode ?? ''),
      );
      output.push({
        type: dependency
          ? 'dependency_missing'
          : transient
            ? 'transient_environment'
            : 'method_error',
        summary: this.truncate(
          [
            this.text(this.record(turn.errorJson).message),
            ...failedTools.map((item) => `${item.toolName}:${item.errorCode ?? 'failed'}`),
            ...reasonCodes,
          ].filter(Boolean).join('; '),
          3_000,
        ) || 'The source turn failed.',
      });
    }
    return output;
  }

  private terminalStatus(value: unknown): GrowTerminalStatus {
    const text = this.text(value).toLowerCase();
    return ['succeeded', 'partial', 'failed', 'blocked', 'cancelled'].includes(text)
      ? text as GrowTerminalStatus
      : 'failed';
  }


  private constraints(text: string): string[] {
    return text.split(/[\n。！？!?]/)
      .map((item) => item.trim())
      .filter((item) => /必须|严禁|不要|只能|保持|不得|需要|should|must|do not|only|preserve/i.test(item))
      .slice(0, 20);
  }


  private explicitPreferences(text: string): string[] {
    const parts = text.split(/[\n。！？!?]/).map((item) => item.trim()).filter(Boolean);
    return parts.filter((item) =>
      /以后|今后|从现在开始|一直|每次|默认|长期|始终|going forward|from now on|always|every time|by default/i.test(item),
    ).slice(0, 10);
  }


  private corrections(text: string): string[] {
    const parts = text.split(/[\n。！？!?]/).map((item) => item.trim()).filter(Boolean);
    return parts.filter((item) =>
      /不对|不是这样|应该是|改成|不要再|重新|你搞错|纠正|instead|not this|should be|do not repeat/i.test(item),
    ).slice(0, 10);
  }


  private acceptances(text: string): string[] {
    const parts = text.split(/[\n。！？!?]/).map((item) => item.trim()).filter(Boolean);
    return parts.filter((item) =>
      /^(好|可以|不错|对|正确|很好|ok|good|correct)(?:[,，\s]|$)/i.test(item),
    ).slice(0, 5);
  }


  private rejections(text: string): string[] {
    const parts = text.split(/[\n。！？!?]/).map((item) => item.trim()).filter(Boolean);
    return parts.filter((item) =>
      /不行|错误|太差|不满意|回退|撤销|wrong|bad|reject|rollback/i.test(item),
    ).slice(0, 5);
  }


  private explicitLearning(text: string): boolean {
    return /(?:做成|生成|沉淀|保存为|学习为|记成).{0,12}(?:skill|技能)|(?:skill|技能).{0,12}(?:生成|创建|保存|学习)|learn this (?:workflow|process|skill)/i.test(text);
  }






  private async messageText(id: string | null | undefined): Promise<string> {
    if (!id) return '';
    const row = await this.prisma.message.findUnique({
      where: { id },
      select: { content: true },
    }).catch(() => null);
    return row?.content ?? '';
  }

  private record(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : {};
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private number(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private truncate(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max)}…`;
  }
}
