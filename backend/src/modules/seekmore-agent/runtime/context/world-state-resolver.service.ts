import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { TerminalSessionStore } from '../../../../tools/terminal/terminal-session.store';
import type { AgentRuntimeTurnRequest } from '../../contracts/agent-turn.types';
import type { AgentToolExecutionRecord } from '../../contracts/agent-tool.types';
import type { WorldSection, WorldSnapshot } from './world-state.types';
import { stableStringify } from '../util/runtime.util';

export function worldRevision(value: unknown): string {
  return createHash('sha256').update(stableStringify(JSON.parse(JSON.stringify(value)))).digest('hex');
}

@Injectable()
export class WorldStateResolverService {
  constructor(private readonly prisma: PrismaService, private readonly terminal: TerminalSessionStore) {}

  async resolve(request: AgentRuntimeTurnRequest, evidence: AgentToolExecutionRecord[]): Promise<WorldSnapshot> {
    const capturedAt = new Date().toISOString();
    const sections: Record<string, WorldSection> = {};
    const put = (name: string, source: string, value: unknown, observedAt: string | null, current = false) => {
      const status = value == null ? 'unknown' : 'observed';
      sections[name] = { source, value: value == null ? 'unknown' : JSON.parse(JSON.stringify(value)), status, observedAt,
        freshness: status === 'unknown' || !observedAt ? 'unknown' : current ? 'current' : 'stale',
        revision: worldRevision({ source, value, observedAt: current ? undefined : observedAt }) };
    };
    const [workspace, objects, pending] = await Promise.allSettled([
      request.workspace.readAllowed && request.workspace.rootPath ? stat(request.workspace.rootPath).then((s) => ({
        workspaceId: request.workspace.workspaceId, rootPath: request.workspace.rootPath,
        exists: true, directory: s.isDirectory(), modifiedAt: s.mtime.toISOString(),
      })) : Promise.resolve(null),
      this.prisma.runtimeObject.findMany({
        where: { id: { in: request.branchObjectIds ?? [] }, userId: request.userId, agentId: request.agentId, conversationId: request.conversationId, deletedAt: null },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 24,
        select: { id: true, originalName: true, displayName: true, objectKind: true, originType: true, extension: true, mimeType: true, status: true, contentHash: true, versionNo: true, metadata: true, updatedAt: true },
      }),
      this.prisma.agentApproval.findMany({ where: { traceId: request.traceId, userId: request.userId, status: 'pending' },
        select: { approvalId: true, toolName: true, createdAt: true }, take: 12 }),
    ]);
    put('workspace' , 'workspace/filesystem.stat', workspace.status === 'fulfilled' ? workspace.value : null, capturedAt, true);
    const objectObservations = latestObjectObservations(evidence);
    const projectedObjects = objects.status === 'fulfilled'
      ? objects.value.map((object) => {
          const metadata = record(object.metadata);
          const generation = record(metadata.generation);
          const observation = objectObservations.get(object.id);
          const observationMatchesCurrent = Boolean(
            observation
            && observation.contentHash === object.contentHash
            && observation.versionNo === object.versionNo,
          );
          return {
            id: object.id,
            originalName: object.originalName,
            displayName: object.displayName,
            objectKind: object.objectKind,
            originType: object.originType,
            extension: object.extension,
            mimeType: object.mimeType,
            status: object.status,
            contentHash: object.contentHash,
            versionNo: object.versionNo,
            updatedAt: object.updatedAt.toISOString(),
            contentSummary: text(metadata.contentSummary),
            generationIntent: text(generation.revisedPrompt) ?? text(generation.prompt),
            contentObservation: observationMatchesCurrent
              ? { status: 'observed', toolCallId: observation!.toolCallId, tool: observation!.tool, observedAt: observation!.observedAt }
              : { status: 'not_observed_in_turn' },
          };
        })
      : null;
    put('objects', 'RuntimeObject/catalog', projectedObjects, capturedAt, true);
    put('processes', 'TerminalSessionStore/live', this.terminal.peekScope(request.userId, request.conversationId, request.workspace.workspaceId), capturedAt, true);
    // Tool results are historical observations. Never present their text as current world truth.
    put('evidence', 'AgentTurnEvent/tools.observed', evidence.slice(-12).map((row) => ({
      toolCallId: row.call.id, tool: row.call.name, status: row.result.status,
      observedAt: new Date(row.finishedAt).toISOString(),
      evidence: row.result.status === 'completed' ? row.result.evidence ?? null : null,
    })), evidence.length ? new Date(evidence[evidence.length - 1].finishedAt).toISOString() : null);
    put('pendingWork', 'AgentApproval/pending', pending.status === 'fulfilled' ? pending.value : null, capturedAt, true);
    put('application', 'application/live-observation', null, null);
    put('mcpResources', 'mcp/resource-observation', null, null);
    return freezeWorld({ capturedAt, revision: worldRevision(Object.fromEntries(Object.entries(sections).map(([key, section]) => [key, section.revision]))), sections });
  }
}

function latestObjectObservations(records: AgentToolExecutionRecord[]): Map<string, {
  contentHash: string;
  versionNo: number;
  toolCallId: string;
  tool: string;
  observedAt: string;
}> {
  const output = new Map<string, { contentHash: string; versionNo: number; toolCallId: string; tool: string; observedAt: string }>();
  for (const row of records) {
    if (row.result.status !== 'completed') continue;
    for (const observation of row.result.evidence?.objectObservations ?? []) {
      output.set(observation.objectId, {
        contentHash: observation.contentHash,
        versionNo: observation.versionNo,
        toolCallId: row.call.id,
        tool: row.canonicalName ?? row.call.name,
        observedAt: observation.observedAt ?? new Date(row.finishedAt).toISOString(),
      });
    }
  }
  return output;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  const output = String(value ?? '').trim();
  return output || null;
}

function freezeWorld<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeWorld(child);
    Object.freeze(value);
  }
  return value;
}
