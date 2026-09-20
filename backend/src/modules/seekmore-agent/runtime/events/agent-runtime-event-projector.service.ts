import { Injectable } from '@nestjs/common';
import { RuntimeAssistantTimelineBus } from '../../../chat/runtime-events/runtime-assistant-timeline.bus';
import type {
  RuntimePublicPresentation,
  RuntimePublicStepKind,
} from '../../../chat/runtime-events/runtime-assistant-timeline.types';
import type { AgentRuntimeEvent, AgentRuntimeTiming } from '../../contracts/agent-runtime-event.types';
import { hash, record, truncate } from '../util/runtime.util';

const SENSITIVE_KEYS = /authorization|cookie|set-cookie|token|password|secret|api[_-]?key|private[_-]?key|refresh[_-]?token|session|env/i;

@Injectable()
export class AgentRuntimeEventProjectorService {
  private readonly reasoning = new Map<string, string>();
  private readonly currentIteration = new Map<string, number>();
  private readonly stepVersions = new Map<string, number>();

  constructor(private readonly timeline: RuntimeAssistantTimelineBus) {}

  project(input: {
    userId: string;
    event: AgentRuntimeEvent;
  }): void {
    const { event } = input;
    if (event.type === 'model.started') {
      const iteration = Math.max(1, Number(event.detail.iteration ?? 1));
      this.currentIteration.set(event.traceId, iteration);
      this.reasoning.delete(this.reasoningKey(event.traceId, iteration));
      this.publishStep(
        input.userId,
        event,
        iteration,
        null,
        'analysis',
        'running',
        undefined,
        iteration <= 1
          ? { key: 'runtime.step.analysisFirst' }
          : { key: 'runtime.step.analysisNext', params: { round: iteration - 1 } },
      );
      return;
    }

    if (event.type === 'iteration.summary') {
      const iteration = Math.max(1, event.iteration);
      this.timeline.publishContent({
        userId: input.userId,
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        traceId: event.traceId,
        blockId: this.iterationSummaryId(event.traceId, iteration),
        role: 'commentary',
        markdown: truncate(event.content, 32_000),
        final: true,
        stepId: this.stepId(event.traceId, iteration),
      });
      return;
    }

    if (event.type === 'iteration.completed') {
      const iteration = Math.max(1, event.iteration);
      const reasoningKey = this.reasoningKey(event.traceId, iteration);
      const accumulatedReasoning = this.reasoning.get(reasoningKey);
      if (accumulatedReasoning) {
        this.timeline.publishReasoningSummary({
          userId: input.userId,
          conversationId: event.conversationId,
          assistantMessageId: event.assistantMessageId,
          traceId: event.traceId,
          summary: {
            summaryId: this.reasoningSummaryId(event.traceId, iteration),
            stepId: this.stepId(event.traceId, iteration),
            markdown: truncate(accumulatedReasoning, 32_000),
            status: 'completed',
          },
        });
        this.reasoning.delete(reasoningKey);
      }

      const failed = event.detail.failedCount > 0;
      this.publishStep(
        input.userId,
        event,
        iteration,
        null,
        'execution',
        failed ? 'failed' : 'succeeded',
        {
          startedAt: event.detail.startedAt,
          finishedAt: event.detail.finishedAt,
          timing: {
            startedAt: event.detail.startedAt,
            finishedAt: event.detail.finishedAt,
            durationMs: event.detail.durationMs,
          },
        },
      );
      return;
    }

    if (event.type === 'reasoning.delta') {
      const iteration = this.iteration(event);
      const key = this.reasoningKey(event.traceId, iteration);
      const accumulated = (this.reasoning.get(key) ?? '') + event.content;
      this.reasoning.set(key, accumulated);
      this.timeline.publishReasoningSummary({
        userId: input.userId,
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        traceId: event.traceId,
        summary: {
          summaryId: this.reasoningSummaryId(event.traceId, iteration),
          stepId: this.stepId(event.traceId, iteration),
          markdown: truncate(accumulated, 32_000),
          status: 'streaming',
        },
      });
      return;
    }

    if (event.type === 'turn.started') {
      const startedAt = event.detail.startedAt;
      this.publishStep(
        input.userId,
        event,
        0,
        null,
        'analysis',
        'running',
        {
          startedAt,
          finishedAt: null,
          timing: {
            startedAt,
            finishedAt: null,
            durationMs: null,
          },
        },
        { key: 'runtime.step.turnStart' },
      );
      return;
    }

    if (event.type === 'status') {
      return;
    }

    if (event.type === 'verification.required') {
      const iteration = this.iteration(event);
      this.publishStep(
        input.userId,
        event,
        iteration,
        null,
        'verification',
        'running',
        undefined,
        {
          key: 'runtime.step.verification',
        },
      );
      return;
    }

    if (
      event.type === 'tool.requested'
      || event.type === 'tool.started'
      || event.type === 'tool.completed'
      || event.type === 'tool.failed'
    ) {
      const iteration = this.iteration(event);
      const call = event.call;
      const canonicalName = this.canonicalToolName(call.name);
      const presentation = event.presentation ?? 'activity';
      if (presentation !== 'activity') return;

      const complete = event.type === 'tool.completed' || event.type === 'tool.failed';
      const failed = event.type === 'tool.failed';
      const requested = event.type === 'tool.requested';
      const result = 'result' in event ? event.result : null;
      const status = failed
        ? 'failed'
        : complete
          ? 'succeeded'
          : requested
            ? 'queued'
            : 'running';

      this.timeline.publishActivity({
        userId: input.userId,
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        traceId: event.traceId,
        activity: {
          activityId: `tool_${call.id}`,
          assistantMessageId: event.assistantMessageId,
          conversationId: event.conversationId,
          workflowId: null,
          stepId: this.stepId(event.traceId, iteration),
          parentActivityId: null,
          version: requested ? 1 : event.type === 'tool.started' ? 2 : 3,
          kind: 'tool',
          operation: canonicalName,
          target: { kind: 'tool', label: null, resourceId: canonicalName },
          status,
          title: canonicalName,
          presentation: {
            key: `runtime.tool.${status}`,
            params: { toolId: canonicalName },
          },
          summary: result ? this.resultSummary(result) : null,
          progress: null,
          evidenceRefs: [],
          startedAt: requested || event.type === 'tool.started' ? event.timestamp : null,
          finishedAt: complete ? event.timestamp : null,
          createdAt: event.timestamp,
          detail: this.redact({
            requestedName: call.name,
            canonicalName,
            toolCallId: call.id,
            arguments: call.arguments,
          }),
        },
      });
      return;
    }

    if (event.type === 'clarification') {
      const iteration = this.iteration(event);
      this.publishStep(
        input.userId,
        event,
        iteration,
        null,
        'analysis',
        'waiting',
        undefined,
        { key: 'runtime.clarification.waiting' },
      );
      this.timeline.publishActivity({
        userId: input.userId,
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        traceId: event.traceId,
        activity: {
          activityId: `clarification_${hash(event.traceId, 16)}`,
          assistantMessageId: event.assistantMessageId,
          conversationId: event.conversationId,
          workflowId: null,
          stepId: this.stepId(event.traceId, iteration),
          parentActivityId: null,
          version: 1,
          kind: 'clarification',
          operation: 'clarification',
          target: null,
          status: 'waiting',
          title: 'clarification',
          presentation: { key: 'runtime.clarification.title' },
          summary: event.content || null,
          progress: null,
          evidenceRefs: [],
          startedAt: event.timestamp,
          finishedAt: null,
          createdAt: event.timestamp,
          detail: { question: event.content },
        },
      });
      return;
    }

    if (event.type === 'turn.paused' || event.type === 'turn.completed' || event.type === 'turn.failed') {
      const iteration = this.iteration(event);
      const key = this.reasoningKey(event.traceId, iteration);
      const accumulated = this.reasoning.get(key);
      if (accumulated) {
        this.timeline.publishReasoningSummary({
          userId: input.userId,
          conversationId: event.conversationId,
          assistantMessageId: event.assistantMessageId,
          traceId: event.traceId,
          summary: {
            summaryId: this.reasoningSummaryId(event.traceId, iteration),
            stepId: this.stepId(event.traceId, iteration),
            markdown: truncate(accumulated, 32_000),
            status: 'completed',
          },
        });
      }

      const terminalStatus = event.type === 'turn.completed'
        ? 'succeeded'
        : event.type === 'turn.paused'
          ? 'waiting'
          : 'failed';
      const terminalPresentation: RuntimePublicPresentation = event.type === 'turn.completed'
        ? { key: 'runtime.step.completed' }
        : event.type === 'turn.paused'
          ? { key: 'runtime.step.waiting' }
          : { key: 'runtime.step.failed', params: { message: event.message } };

      this.publishStep(
        input.userId,
        event,
        iteration,
        event.type === 'turn.failed' ? event.message : null,
        event.type === 'turn.failed' ? 'recovery' : 'delivery',
        terminalStatus,
        undefined,
        terminalPresentation,
      );

      const timing = this.eventTiming(event);
      if (timing) {
        this.publishStep(
          input.userId,
          event,
          0,
          null,
          'analysis',
          terminalStatus,
          {
            startedAt: timing.startedAt,
            finishedAt: timing.finishedAt,
            timing,
          },
          { key: 'runtime.step.turnStart' },
        );
      }

      for (const mapKey of [...this.reasoning.keys()]) {
        if (mapKey.startsWith(`${event.traceId}:`)) this.reasoning.delete(mapKey);
      }
      this.currentIteration.delete(event.traceId);
    }
  }

  private publishStep(
    userId: string,
    event: AgentRuntimeEvent,
    iteration: number,
    title: string | null,
    kind: RuntimePublicStepKind,
    status: 'running' | 'waiting' | 'succeeded' | 'failed',
    timing?: {
      startedAt: number;
      finishedAt: number | null;
      timing: AgentRuntimeTiming;
    },
    presentation?: RuntimePublicPresentation,
  ): void {
    const stepId = this.stepId(event.traceId, iteration);
    const version = (this.stepVersions.get(stepId) ?? 0) + 1;
    this.stepVersions.set(stepId, version);
    this.timeline.publishStep({
      userId,
      conversationId: event.conversationId,
      assistantMessageId: event.assistantMessageId,
      traceId: event.traceId,
      step: {
        stepId,
        parentStepId: null,
        kind,
        iteration: iteration || null,
        title,
        presentation: presentation ?? null,
        status,
        startedAt: timing?.startedAt ?? event.timestamp,
        finishedAt: timing
          ? timing.finishedAt
          : status === 'running' || status === 'waiting'
            ? null
            : event.timestamp,
        timing: timing?.timing ?? null,
      },
    });
  }

  private eventTiming(event: AgentRuntimeEvent): AgentRuntimeTiming | null {
    if (
      event.type !== 'turn.completed'
      && event.type !== 'turn.paused'
      && event.type !== 'turn.failed'
    ) return null;
    return event.detail.timing ?? null;
  }

  private iteration(event: AgentRuntimeEvent): number {
    return Math.max(
      1,
      Number(
        (event as any).iteration
        ?? (event as any).detail?.iteration
        ?? this.currentIteration.get(event.traceId)
        ?? 1,
      ),
    );
  }

  private stepId(traceId: string, iteration: number): string {
    return `agent_step_${hash(`${traceId}:${iteration}`, 18)}`;
  }

  private reasoningKey(traceId: string, iteration: number): string {
    return `${traceId}:${iteration}`;
  }

  private reasoningSummaryId(traceId: string, iteration: number): string {
    return `reasoning_${hash(`${traceId}:${iteration}`, 18)}`;
  }

  private iterationSummaryId(traceId: string, iteration: number): string {
    return `iteration_summary_${hash(`${traceId}:${iteration}`, 18)}`;
  }

  private canonicalToolName(name: string): string {
    return name.replace(/__+/g, '.').replace(/_[a-f0-9]{8,}$/i, '');
  }

  private resultSummary(result: unknown): string | null {
    const value = record(result);
    if (value.status === 'failed') {
      const text = String(value.message ?? value.errorCode ?? '').trim();
      return text ? text.slice(0, 240) : null;
    }
    if (value.status === 'completed') {
      const text = String(value.observation ?? value.message ?? '').trim();
      return text ? text.slice(0, 240) : null;
    }
    return null;
  }

  private redact(value: unknown, depth = 0): any {
    if (depth > 8) return '[truncated]';
    if (Array.isArray(value)) {
      return value.slice(0, 100).map((item) => this.redact(item, depth + 1));
    }
    if (!value || typeof value !== 'object') return value;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEYS.test(key)
        ? '[REDACTED]'
        : this.redact(item, depth + 1);
    }
    return output;
  }
}
