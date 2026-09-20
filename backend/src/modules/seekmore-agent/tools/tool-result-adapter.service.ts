import { Injectable } from '@nestjs/common';
import type { ToolResult } from '../../../tools/toolstypes';
import type { AgentToolResult } from '../contracts/agent-tool.types';

@Injectable()
export class ToolResultAdapterService {
  adapt(
    result: ToolResult,
    options: { captureCompletionText?: boolean } = {},
  ): AgentToolResult {
    if (!result.ok) {
      return {
        status: 'failed',
        errorCode: result.error?.code ?? 'TOOL_FAILED',
        message: result.error?.message ?? 'Tool execution failed',
        retryable: this.retryable(result.error?.code),
        metadata: {
          ...result.meta,
          details: result.error?.details,
        },
      };
    }

    const data = result.data;
    const record = this.record(data);
    const completionText = options.captureCompletionText
      ? typeof data === 'string'
        ? data.trim()
        : String(record.message ?? '').trim()
      : '';
    const objects = this.records(record.objects);
    const citations = this.records(record.citations);
    const objectObservations = this.objectObservations(record.objectObservations);

    return {
      status: 'completed',
      observation: this.observation(data),
      evidence: {
        source: 'tool_result',
        ...(typeof record.exitCode === 'number' ? { exitCode: record.exitCode } : {}),
        ...(typeof record.running === 'boolean' ? { running: record.running } : {}),
        ...(typeof record.sessionId === 'string' ? { sessionId: record.sessionId } : {}),
        ...(typeof record.path === 'string' ? { target: record.path } : {}),
        ...(typeof record.contentHash === 'string' ? { contentHash: record.contentHash } : {}),
        ...(objectObservations.length ? { objectObservations } : {}),
      },
      ...(completionText ? { completionText } : {}),
      ...(objects.length ? { objects } : {}),
      ...(citations.length ? { citations } : {}),
    };
  }

  private record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private records(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.record(item))
      .filter((item) => Object.keys(item).length > 0);
  }

  private objectObservations(value: unknown): Array<{ objectId: string; contentHash: string; versionNo: number }> {
    return this.records(value).flatMap((item) => {
      const objectId = String(item.objectId ?? '').trim();
      const contentHash = String(item.contentHash ?? '').trim();
      const versionNo = Number(item.versionNo);
      return objectId && contentHash && Number.isInteger(versionNo) && versionNo >= 0
        ? [{ objectId, contentHash, versionNo }]
        : [];
    });
  }

  private observation(value: unknown): string {
    if (typeof value === 'string') return this.truncate(value);
    const safe = sanitizeBinary(value);
    try {
      return this.truncate(JSON.stringify(safe, null, 2));
    } catch {
      return this.truncate(String(safe));
    }
  }

  private truncate(value: string): string {
    const maximum = Math.max(
      10_000,
      Number(process.env.SEEKMORE_AGENT_TOOL_OBSERVATION_MAX_CHARS ?? 100_000),
    );
    return value.length <= maximum
      ? value
      : `${value.slice(0, maximum)}\n...[truncated]`;
  }

  private retryable(code?: string): boolean {
    return Boolean(code && [
      'TOOL_TIMEOUT',
      'TOOL_QUEUE_FULL',
      'TOOL_QUEUE_TIMEOUT',
      'IDEMPOTENCY_IN_PROGRESS',
      'REMOTE_TOOL_TIMEOUT',
    ].includes(code));
  }
}

function sanitizeBinary(value: unknown, depth = 0): unknown {
  if (depth > 10 || value == null) return value;
  if (value instanceof Uint8Array) {
    return {
      type: 'uint8array',
      sizeBytes: value.byteLength,
      omitted: true,
    };
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeBinary(item, depth + 1));
  if (typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sanitizeBinary(item, depth + 1),
    ]),
  );
}
