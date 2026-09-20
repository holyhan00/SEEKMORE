import { Injectable } from '@nestjs/common';
import type {
  AgentToolExecutionRecord,
  AgentToolExecutionSnapshot,
} from '../../contracts/agent-tool.types';
import { hash, stableStringify } from '../util/runtime.util';

export interface AgentRuntimeDelivery {
  objects: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
  observedCitationCount: number;
  toolExecutions: AgentToolExecutionSnapshot[];
}

type ObservedCitation = Record<string, unknown> & {
  title: string | null;
  url: string;
  snippet: string | null;
  sourceTool: string;
  executionId: string;
  sourcePosition: number;
};

@Injectable()
export class AgentDeliveryCollector {
  private readonly maximumSelectedCitations = 8;
  private readonly maximumSelectedPerExecution = 2;

  collect(
    records: AgentToolExecutionRecord[],
    finalContent = '',
  ): AgentRuntimeDelivery {
    const objects: Array<Record<string, unknown>> = [];
    const observedCitations: ObservedCitation[] = [];

    for (const record of records) {
      if (record.result.status !== 'completed') {
        continue;
      }

      for (const value of record.result.objects ?? []) {
        const object = this.asRecord(value);
        const objectId = this.text(object.objectId);
        const role = this.text(object.role);

        if (!objectId || role !== 'assistant_output') {
          continue;
        }

        objects.push({
          ...object,
          objectId,
          role: 'assistant_output',
          sourceTool: record.call.name,
          executionId: record.call.id,
        });
      }

      const citations = record.result.citations ?? [];
      citations.forEach((value, sourcePosition) => {
        const citation = this.asRecord(value);
        const url = this.text(citation.url);

        if (!/^https?:\/\//i.test(url)) {
          return;
        }

        observedCitations.push({
          title: this.text(citation.title) || null,
          url,
          snippet: this.text(citation.snippet) || null,
          sourceTool: record.call.name,
          executionId: record.call.id,
          sourcePosition,
        });
      });
    }

    const dedupedObserved = this.dedupeCitations(observedCitations);

    return {
      objects: this.dedupeBy(objects, 'objectId'),
      citations: this.selectCitations(dedupedObserved, finalContent),
      observedCitationCount: dedupedObserved.length,
      toolExecutions: records.map((record) => this.executionSnapshot(record)),
    };
  }

  private executionSnapshot(
    record: AgentToolExecutionRecord,
  ): AgentToolExecutionSnapshot {
    const common = {
      executionId: this.reference(
        record.call.id || record.fingerprint,
        'tool_execution',
      ),
      toolCallId: this.reference(
        record.call.id || record.fingerprint,
        'tool_call',
      ),
      toolName: this.text(record.call.name) || 'tool',
      status: record.result.status,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      durationMs: record.durationMs,
    };

    if (record.result.status === 'completed') {
      return {
        ...common,
        status: 'completed',
        ok: true,
        summary: this.limit(record.result.observation, 1200),
        errorCode: null,
        retryable: null,
      };
    }

    if (record.result.status === 'failed') {
      return {
        ...common,
        status: 'failed',
        ok: false,
        summary: this.limit(
          `${record.result.errorCode}: ${record.result.message}`,
          1200,
        ),
        errorCode: record.result.errorCode,
        retryable: record.result.retryable,
      };
    }

    return {
      ...common,
      status: 'requires_confirmation',
      ok: null,
      summary: this.limit(record.result.reason, 1200),
      errorCode: null,
      retryable: null,
    };
  }

  private selectCitations(
    citations: ObservedCitation[],
    finalContent: string,
  ): Array<Record<string, unknown>> {
    if (!citations.length) return [];

    const content = finalContent.toLowerCase();
    const ranked = citations
      .map((citation, index) => ({
        citation,
        index,
        score: this.citationScore(citation, content),
      }))
      .sort((left, right) => (
        right.score - left.score
        || left.index - right.index
      ));

    const selected: ObservedCitation[] = [];
    const perExecution = new Map<string, number>();

    for (const entry of ranked) {
      if (selected.length >= this.maximumSelectedCitations) break;

      const count = perExecution.get(entry.citation.executionId) ?? 0;
      if (count >= this.maximumSelectedPerExecution) continue;

      selected.push(entry.citation);
      perExecution.set(entry.citation.executionId, count + 1);
    }

    return selected.map((citation) => ({
      title: citation.title,
      url: citation.url,
      snippet: citation.snippet,
      sourceTool: citation.sourceTool,
      executionId: citation.executionId,
    }));
  }

  private citationScore(
    citation: ObservedCitation,
    finalContent: string,
  ): number {
    let score = 0;
    const url = citation.url.toLowerCase();
    const host = this.hostname(citation.url);
    const title = (citation.title ?? '').toLowerCase();
    const normalizedTitle = title.replace(/\s+/g, ' ').trim();

    if (finalContent.includes(url)) score += 100;
    if (host && finalContent.includes(host)) score += 45;
    if (
      normalizedTitle.length >= 6
      && finalContent.includes(normalizedTitle)
    ) {
      score += 40;
    }

    if (/web(?:\.|__)read/i.test(citation.sourceTool)) score += 25;
    if (/web(?:\.|__)search/i.test(citation.sourceTool)) score += 10;

    score += Math.max(0, 5 - citation.sourcePosition);
    return score;
  }

  private dedupeCitations(
    citations: ObservedCitation[],
  ): ObservedCitation[] {
    const seen = new Set<string>();
    const output: ObservedCitation[] = [];

    for (const citation of citations) {
      const key = this.canonicalUrl(citation.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(citation);
    }

    return output;
  }

  private canonicalUrl(value: string): string {
    try {
      const url = new URL(value);
      url.hash = '';
      const trackingKeys: string[] = [];
      url.searchParams.forEach((_value, key) => {
        if (/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) {
          trackingKeys.push(key);
        }
      });
      for (const key of trackingKeys) {
        url.searchParams.delete(key);
      }
      url.hostname = url.hostname.toLowerCase();
      return url.toString();
    } catch {
      return value.trim();
    }
  }

  private hostname(value: string): string {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  private reference(value: string, namespace: string): string {
    const text = this.text(value);
    if (text && text.length <= 500) return text;
    return `${namespace}:${hash(text || namespace, 64)}`;
  }

  private limit(value: unknown, maximum: number): string {
    const text = typeof value === 'string'
      ? value
      : stableStringify(value);
    return text.length <= maximum
      ? text
      : `${text.slice(0, maximum - 16)}…[truncated]`;
  }

  private asRecord(
    value: unknown,
  ): Record<string, unknown> {
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
    ) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private text(value: unknown): string {
    return typeof value === 'string'
      ? value.trim()
      : '';
  }

  private dedupeBy(
    values: Array<Record<string, unknown>>,
    keyName: 'objectId',
  ): Array<Record<string, unknown>> {
    const seen = new Set<string>();
    const output: Array<Record<string, unknown>> = [];

    for (const value of values) {
      const key = this.text(value[keyName]);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(value);
    }

    return output;
  }
}
