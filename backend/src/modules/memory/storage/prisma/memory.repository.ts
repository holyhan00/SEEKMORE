                                                                 

import { Injectable } from '@nestjs/common';
import type { MemoryFact, Prisma } from '@prisma/client';

import { PrismaService } from '../../../../../prisma/prisma.service';
import type {
  MemoryCandidate,
  MemoryFactRecord,
  MemoryNamespace,
  MemoryRetrievalItem,
  MemorySourceRef,
} from '../../kernel/memory.types';
import type {
  MemoryEvidenceSource,
  MemoryKind,
  MemoryScopeLevel,
  MemorySensitivity,
  MemoryStability,
  MemoryStatus,
} from '../../kernel/memory.constants';
import {
  memoryKindGroup,
  memoryLexicalTokens,
  normalizeMemoryText,
} from '../../shared/memory-primitives';

function clean(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Number(value) : fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

const MEMORY_SCOPE_LEVELS = new Set<MemoryScopeLevel>([
  'user',
  'agent',
  'conversation',
  'project',
  'group',
  'org',
  'plan',
]);

const MEMORY_KINDS = new Set<MemoryKind>([
  'identity',
  'preference',
  'constraint',
  'project_state',
  'goal',
  'relationship',
  'workflow',
  'tool_preference',
  'event',
  'episode',
]);

const MEMORY_STATUSES = new Set<MemoryStatus>([
  'active',
  'superseded',
  'deleted',
  'conflicted',
  'pending_confirmation',
]);

const MEMORY_STABILITIES = new Set<MemoryStability>([
  'long_term',
  'session',
  'ephemeral',
]);

const MEMORY_SENSITIVITIES = new Set<MemorySensitivity>([
  'normal',
  'private',
  'sensitive',
  'restricted',
]);

function toScopeLevel(value: unknown): MemoryScopeLevel {
  const text = clean(value);
  return (text && MEMORY_SCOPE_LEVELS.has(text as MemoryScopeLevel)
    ? text
    : 'user') as MemoryScopeLevel;
}

function toKind(value: unknown): MemoryKind {
  const text = clean(value);
  return (text && MEMORY_KINDS.has(text as MemoryKind)
    ? text
    : 'preference') as MemoryKind;
}

function toStatus(value: unknown): MemoryStatus {
  const text = clean(value);
  return (text && MEMORY_STATUSES.has(text as MemoryStatus)
    ? text
    : 'active') as MemoryStatus;
}

function toStability(value: unknown): MemoryStability {
  const text = clean(value);
  return (text && MEMORY_STABILITIES.has(text as MemoryStability)
    ? text
    : 'long_term') as MemoryStability;
}

function toSensitivity(value: unknown): MemorySensitivity {
  const text = clean(value);
  return (text && MEMORY_SENSITIVITIES.has(text as MemorySensitivity)
    ? text
    : 'normal') as MemorySensitivity;
}

function toEvidenceSource(value: unknown): MemoryEvidenceSource {
  const text = clean(value);
  return (text || 'conversation_turn') as MemoryEvidenceSource;
}

function namespaceWhere(ns: MemoryNamespace) {
  return {
    userId: ns.userId,
    tenantId: clean(ns.tenantId),
    orgId: clean(ns.orgId),
    groupId: clean(ns.groupId),
    planId: clean(ns.planId),
    projectId: clean(ns.projectId),
  };
}

function namespaceCreateData(ns: MemoryNamespace) {
  return {
    ...namespaceWhere(ns),
    agentId: clean(ns.agentId),
    conversationId: clean(ns.conversationId),
  };
}

function rowToSource(row: MemoryFact): MemorySourceRef {
  return {
    conversationId: row.sourceConversationId ?? null,
    userMessageId: row.sourceMessageId ?? null,
    assistantMessageId: row.sourceAssistantMessageId ?? null,
    traceId: row.sourceTraceId ?? null,
    quote: row.sourceQuote ?? null,
    source: toEvidenceSource(row.evidenceSource),
  };
}

function rowToFact(row: MemoryFact): MemoryFactRecord {
  return {
    id: row.id,
    namespace: {
      tenantId: row.tenantId ?? null,
      orgId: row.orgId ?? null,
      groupId: row.groupId ?? null,
      planId: row.planId ?? null,
      projectId: row.projectId ?? null,
      userId: row.userId,
      agentId: row.agentId ?? null,
      conversationId: row.conversationId ?? null,
    },
    scopeLevel: toScopeLevel(row.scopeLevel),
    kind: toKind(row.kind),
    subject: row.subject,
    predicate: row.predicate,
    valueJson: row.valueJson,
    summary: row.summary,
    searchText: row.searchText,
    status: toStatus(row.status),
    confidence: Number(row.confidence ?? 0),
    stability: toStability(row.stability),
    sensitivity: toSensitivity(row.sensitivity),
    source: rowToSource(row),
    validFrom: row.validFrom?.toISOString?.() ?? null,
    validTo: row.validTo?.toISOString?.() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString?.() ?? null,
    usageCount: Number(row.usageCount ?? 0),
    createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

@Injectable()
export class MemoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findFactById(input: {
    namespace: MemoryNamespace;
    memoryId: string;
    includeDeleted?: boolean;
  }): Promise<MemoryFactRecord | null> {
    const id = clean(input.memoryId);
    if (!id) return null;

    const row = await this.prisma.memoryFact.findFirst({
      where: {
        id,
        userId: input.namespace.userId,
        tenantId: clean(input.namespace.tenantId),
        ...(input.includeDeleted ? {} : { status: { not: 'deleted' } }),
      },
    });

    return row ? rowToFact(row) : null;
  }

  async findFactsByIds(input: {
    namespace: MemoryNamespace;
    memoryIds: string[];
    includeDeleted?: boolean;
  }): Promise<MemoryFactRecord[]> {
    const ids = Array.from(
      new Set(input.memoryIds.map((id) => clean(id)).filter(Boolean) as string[]),
    );

    if (!ids.length) return [];

    const rows = await this.prisma.memoryFact.findMany({
      where: {
        id: { in: ids },
        userId: input.namespace.userId,
        tenantId: clean(input.namespace.tenantId),
        ...(input.includeDeleted ? {} : { status: { not: 'deleted' } }),
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    return rows.map(rowToFact);
  }

  async softDeleteFact(input: {
    namespace: MemoryNamespace;
    memoryId: string;
    reason?: string | null;
    actor?: string | null;
    sourceFrameId?: string | null;
  }): Promise<MemoryFactRecord> {
    await this.assertOwned(input.namespace, input.memoryId);

    const previous = await this.prisma.memoryFact.findUnique({
      where: { id: input.memoryId },
      select: { status: true },
    });

    const row = await this.prisma.memoryFact.update({
      where: { id: input.memoryId },
      data: {
        status: 'deleted',
        validTo: new Date(),
      },
    });

    await this.audit({
      namespace: input.namespace,
      action: 'delete',
      memoryId: row.id,
      payload: {
        reason: input.reason ?? null,
        actor: input.actor ?? null,
        sourceFrameId: input.sourceFrameId ?? null,
        previousStatus: previous?.status ?? null,
      },
    });

    return rowToFact(row);
  }

  async softDeleteFacts(input: {
    namespace: MemoryNamespace;
    memoryIds: string[];
    reason?: string | null;
    actor?: string | null;
    sourceFrameId?: string | null;
  }): Promise<{ deleted: MemoryFactRecord[]; skipped: string[] }> {
    const ids = Array.from(
      new Set(input.memoryIds.map((id) => clean(id)).filter(Boolean) as string[]),
    );

    if (!ids.length) {
      return { deleted: [], skipped: [] };
    }

    const ownedRows = await this.prisma.memoryFact.findMany({
      where: {
        id: { in: ids },
        userId: input.namespace.userId,
        tenantId: clean(input.namespace.tenantId),
        status: { not: 'deleted' },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const ownedIds = new Set(ownedRows.map((row) => row.id));
    const skipped = ids.filter((id) => !ownedIds.has(id));

    if (!ownedRows.length) {
      return { deleted: [], skipped };
    }

    const now = new Date();

    await this.prisma.memoryFact.updateMany({
      where: {
        id: { in: Array.from(ownedIds) },
        userId: input.namespace.userId,
        tenantId: clean(input.namespace.tenantId),
      },
      data: {
        status: 'deleted',
        validTo: now,
      },
    });

    await Promise.all(
      ownedRows.map((row) =>
        this.audit({
          namespace: input.namespace,
          action: 'delete',
          memoryId: row.id,
          payload: {
            reason: input.reason ?? null,
            actor: input.actor ?? null,
            sourceFrameId: input.sourceFrameId ?? null,
            previousStatus: row.status ?? null,
            bulk: true,
          },
        }),
      ),
    );

    const deletedRows = await this.prisma.memoryFact.findMany({
      where: {
        id: { in: Array.from(ownedIds) },
        userId: input.namespace.userId,
        tenantId: clean(input.namespace.tenantId),
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    return {
      deleted: deletedRows.map(rowToFact),
      skipped,
    };
  }

  async restoreFactDirect(input: {
    namespace: MemoryNamespace;
    memoryId: string;
    reason?: string | null;
    actor?: string | null;
    sourceFrameId?: string | null;
  }): Promise<MemoryFactRecord> {
    await this.assertOwned(input.namespace, input.memoryId);

    const previous = await this.prisma.memoryFact.findUnique({
      where: { id: input.memoryId },
      select: { status: true },
    });

    const row = await this.prisma.memoryFact.update({
      where: { id: input.memoryId },
      data: {
        status: 'active',
        validTo: null,
      },
    });

    await this.audit({
      namespace: input.namespace,
      action: 'restore',
      memoryId: row.id,
      payload: {
        reason: input.reason ?? null,
        actor: input.actor ?? null,
        sourceFrameId: input.sourceFrameId ?? null,
        previousStatus: previous?.status ?? null,
      },
    });

    return rowToFact(row);
  }

  async promoteFact(input: {
    namespace: MemoryNamespace;
    memoryId: string;
    reason?: string | null;
    actor?: string | null;
    sourceFrameId?: string | null;
  }): Promise<MemoryFactRecord> {
    await this.assertOwned(input.namespace, input.memoryId);

    const previous = await this.prisma.memoryFact.findUnique({
      where: { id: input.memoryId },
      select: { status: true },
    });

    const row = await this.prisma.memoryFact.update({
      where: { id: input.memoryId },
      data: {
        status: 'active',
        validTo: null,
      },
    });

    await this.audit({
      namespace: input.namespace,
      action: 'promote',
      memoryId: row.id,
      payload: {
        reason: input.reason ?? null,
        actor: input.actor ?? null,
        sourceFrameId: input.sourceFrameId ?? null,
        previousStatus: previous?.status ?? null,
      },
    });

    return rowToFact(row);
  }

  async purgeFact(input: {
    namespace: MemoryNamespace;
    memoryId: string;
    reason?: string | null;
    actor?: string | null;
    sourceFrameId?: string | null;
  }): Promise<{ id: string }> {
    const id = clean(input.memoryId);
    if (!id) {
      throw new Error('memory_id_required');
    }

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.memoryFact.findFirst({
        where: {
          id,
          userId: input.namespace.userId,
          tenantId: clean(input.namespace.tenantId),
        },
      });

      if (!row) {
        throw new Error('memory_not_found_or_not_owned');
      }

      if (row.status !== 'deleted') {
        throw new Error('memory_purge_requires_deleted_status');
      }

      await tx.memoryAudit.create({
        data: {
          ...namespaceCreateData({
            tenantId: row.tenantId ?? null,
            orgId: row.orgId ?? null,
            groupId: row.groupId ?? null,
            planId: row.planId ?? null,
            projectId: row.projectId ?? null,
            userId: row.userId,
            agentId: row.agentId ?? null,
            conversationId: row.conversationId ?? null,
          }),
          action: 'purge',
          memoryId: row.id,
          payloadJson: {
            reason: input.reason ?? null,
            actor: input.actor ?? null,
            sourceFrameId: input.sourceFrameId ?? null,
            previousStatus: row.status,
            validTo: row.validTo?.toISOString?.() ?? null,
          },
        },
      });

      await tx.memoryFact.delete({
        where: { id: row.id },
      });

      return { id: row.id };
    });
  }

  async purgeExpiredDeletedFacts(input: {
    cutoff: Date;
    limit?: number;
  }): Promise<{ purged: number }> {
    const limit = normalizeLimit(input.limit, 500, 1, 1000);

    const rows = await this.prisma.memoryFact.findMany({
      where: {
        status: 'deleted',
        validTo: {
          lte: input.cutoff,
        },
      },
      orderBy: [{ validTo: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    if (!rows.length) {
      return { purged: 0 };
    }

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.memoryAudit.create({
          data: {
            ...namespaceCreateData({
              tenantId: row.tenantId ?? null,
              orgId: row.orgId ?? null,
              groupId: row.groupId ?? null,
              planId: row.planId ?? null,
              projectId: row.projectId ?? null,
              userId: row.userId,
              agentId: row.agentId ?? null,
              conversationId: row.conversationId ?? null,
            }),
            action: 'auto_purge',
            memoryId: row.id,
            payloadJson: {
              previousStatus: row.status,
              validTo: row.validTo?.toISOString?.() ?? null,
              cutoff: input.cutoff.toISOString(),
              reason: 'deleted_retention_expired',
            },
          },
        });

        await tx.memoryFact.delete({
          where: { id: row.id },
        });
      }
    });

    return { purged: rows.length };
  }

  async softDeleteExpiredByDecay(input: {
    now?: Date;
    limit?: number;
  }): Promise<{ deleted: number }> {
    const now = input.now ?? new Date();
    const limit = normalizeLimit(input.limit, 500, 1, 1000);

    const ephemeralCutoff = new Date(now.getTime() - 30 * 86_400_000);
    const sessionCutoff = new Date(now.getTime() - 90 * 86_400_000);

    const rows = await this.prisma.memoryFact.findMany({
      where: {
        status: 'active',
        OR: [
          {
            stability: 'ephemeral',
            OR: [
              { lastUsedAt: { lte: ephemeralCutoff } },
              { lastUsedAt: null, updatedAt: { lte: ephemeralCutoff } },
            ],
          },
          {
            stability: 'session',
            usageCount: { lte: 1 },
            OR: [
              { lastUsedAt: { lte: sessionCutoff } },
              { lastUsedAt: null, updatedAt: { lte: sessionCutoff } },
            ],
          },
        ],
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    if (!rows.length) {
      return { deleted: 0 };
    }

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const reason =
          row.stability === 'ephemeral'
            ? 'auto_decay_ephemeral_expired'
            : 'auto_decay_session_expired';

        await tx.memoryFact.update({
          where: { id: row.id },
          data: {
            status: 'deleted',
            validTo: now,
          },
        });

        await tx.memoryAudit.create({
          data: {
            ...namespaceCreateData({
              tenantId: row.tenantId ?? null,
              orgId: row.orgId ?? null,
              groupId: row.groupId ?? null,
              planId: row.planId ?? null,
              projectId: row.projectId ?? null,
              userId: row.userId,
              agentId: row.agentId ?? null,
              conversationId: row.conversationId ?? null,
            }),
            action: 'auto_decay_delete',
            memoryId: row.id,
            payloadJson: {
              reason,
              previousStatus: row.status,
              stability: row.stability,
              usageCount: row.usageCount,
              lastUsedAt: row.lastUsedAt?.toISOString?.() ?? null,
              updatedAt: row.updatedAt?.toISOString?.() ?? null,
            },
          },
        });
      }
    });

    return { deleted: rows.length };
  }

  async listFactsForManagement(input: {
    namespace: MemoryNamespace;
    status?: MemoryStatus | 'all' | null;
    scopeLevel?: MemoryScopeLevel | null;
    kind?: MemoryKind | null;
    sensitivity?: MemorySensitivity | null;
    keyword?: string | null;
    limit?: number;
    cursor?: string | null;
  }): Promise<{ items: MemoryFactRecord[]; nextCursor: string | null }> {
    const limit = normalizeLimit(input.limit, 50, 1, 200);
    const keyword = clean(input.keyword);

    const where: Prisma.MemoryFactWhereInput = {
      userId: input.namespace.userId,
      tenantId: clean(input.namespace.tenantId),
      orgId: clean(input.namespace.orgId),
      groupId: clean(input.namespace.groupId),
      planId: clean(input.namespace.planId),
      projectId: clean(input.namespace.projectId),
      agentId: clean(input.namespace.agentId),
      conversationId: clean(input.namespace.conversationId),
      ...(input.status && input.status !== 'all' ? { status: input.status } : {}),
      ...(input.scopeLevel ? { scopeLevel: input.scopeLevel } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.sensitivity ? { sensitivity: input.sensitivity } : {}),
      ...(keyword
        ? {
            OR: [
              { summary: { contains: keyword, mode: 'insensitive' } },
              { searchText: { contains: keyword, mode: 'insensitive' } },
              { subject: { contains: keyword, mode: 'insensitive' } },
              { predicate: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.memoryFact.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(input.cursor
        ? {
            cursor: { id: input.cursor },
            skip: 1,
          }
        : {}),
    });

    const page = rows.slice(0, limit);

    return {
      items: page.map(rowToFact),
      nextCursor: rows.length > limit ? rows[limit].id : null,
    };
  }

  async listAudit(input: {
    namespace: MemoryNamespace;
    memoryId?: string | null;
    cursor?: string | null;
    limit?: number;
  }): Promise<{ items: Array<{ id: string; action: string; memoryId: string | null; payloadJson: unknown; createdAt: string }>; nextCursor: string | null }> {
    const limit = normalizeLimit(input.limit, 50, 1, 200);
    const memoryId = clean(input.memoryId);

    const rows = await this.prisma.memoryAudit.findMany({
      where: {
        userId: input.namespace.userId,
        tenantId: clean(input.namespace.tenantId),
        ...(memoryId ? { memoryId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(input.cursor
        ? {
            cursor: { id: input.cursor },
            skip: 1,
          }
        : {}),
    });

    const page = rows.slice(0, limit);

    return {
      items: page.map((row) => ({
        id: row.id,
        action: row.action,
        memoryId: row.memoryId,
        payloadJson: row.payloadJson,
        createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
      })),
      nextCursor: rows.length > limit ? rows[limit].id : null,
    };
  }

  async createFact(input: {
    namespace: MemoryNamespace;
    candidate: MemoryCandidate;
    status?: MemoryStatus;
  }): Promise<MemoryFactRecord> {
    const { namespace, candidate } = input;

    const row = await this.prisma.memoryFact.create({
      data: {
        ...namespaceCreateData(namespace),
        scopeLevel: candidate.scopeLevel,
        kind: candidate.kind,
        subject: candidate.subject,
        predicate: candidate.predicate,
        valueJson: candidate.value as Prisma.InputJsonValue,
        summary: candidate.summary,
        searchText: this.buildSearchText(candidate),
        status: input.status ?? 'active',
        confidence: candidate.confidence,
        stability: candidate.stability,
        sensitivity: candidate.sensitivity,
        evidenceSource: candidate.evidence.source,
        sourceConversationId: clean(candidate.evidence.conversationId),
        sourceMessageId: clean(candidate.evidence.userMessageId),
        sourceAssistantMessageId: clean(candidate.evidence.assistantMessageId),
        sourceTraceId: clean(candidate.evidence.traceId),
        sourceQuote: clean(candidate.evidence.quote),
        sourceHash: clean(candidate.sourceHash),
      },
    });

    await this.audit({
      namespace,
      action: 'create_fact',
      memoryId: row.id,
      payload: {
        kind: candidate.kind,
        scopeLevel: candidate.scopeLevel,
        subject: candidate.subject,
        predicate: candidate.predicate,
        status: input.status ?? 'active',
      },
    });

    return rowToFact(row);
  }

  async updateFact(input: {
    namespace: MemoryNamespace;
    memoryId: string;
    candidate: MemoryCandidate;
  }): Promise<MemoryFactRecord> {
    await this.assertOwned(input.namespace, input.memoryId);

    const row = await this.prisma.memoryFact.update({
      where: { id: input.memoryId },
      data: {
        kind: input.candidate.kind,
        subject: input.candidate.subject,
        predicate: input.candidate.predicate,
        valueJson: input.candidate.value as Prisma.InputJsonValue,
        summary: input.candidate.summary,
        searchText: this.buildSearchText(input.candidate),
        status: 'active',
        confidence: input.candidate.confidence,
        stability: input.candidate.stability,
        sensitivity: input.candidate.sensitivity,
        evidenceSource: input.candidate.evidence.source,
        sourceConversationId: clean(input.candidate.evidence.conversationId),
        sourceMessageId: clean(input.candidate.evidence.userMessageId),
        sourceAssistantMessageId: clean(input.candidate.evidence.assistantMessageId),
        sourceTraceId: clean(input.candidate.evidence.traceId),
        sourceQuote: clean(input.candidate.evidence.quote),
        sourceHash: clean(input.candidate.sourceHash),
        validTo: null,
      },
    });

    await this.audit({
      namespace: input.namespace,
      action: 'update_fact',
      memoryId: row.id,
      payload: {
        kind: input.candidate.kind,
        subject: input.candidate.subject,
        predicate: input.candidate.predicate,
      },
    });

    return rowToFact(row);
  }

  async markStatus(input: {
    namespace: MemoryNamespace;
    memoryId: string;
    status: MemoryStatus;
    reason?: string;
  }): Promise<MemoryFactRecord> {
    await this.assertOwned(input.namespace, input.memoryId);

    const row = await this.prisma.memoryFact.update({
      where: { id: input.memoryId },
      data: {
        status: input.status,
        validTo: input.status === 'active' ? null : new Date(),
      },
    });

    await this.audit({
      namespace: input.namespace,
      action: `mark_${input.status}`,
      memoryId: row.id,
      payload: {
        reason: input.reason ?? null,
      },
    });

    return rowToFact(row);
  }

  async findSimilar(input: {
    namespace: MemoryNamespace;
    candidate: MemoryCandidate;
    limit?: number;
  }): Promise<MemoryFactRecord[]> {
    const candidate = input.candidate;
    const limit = normalizeLimit(input.limit, 24, 1, 80);
    const lexicalOr = this.buildSimilarityLexicalOr(candidate);

    const baseWhere: Prisma.MemoryFactWhereInput = {
      userId: input.namespace.userId,
      tenantId: clean(input.namespace.tenantId),
      status: 'active',
      scopeLevel: candidate.scopeLevel,
      kind: {
        in: this.compatibleKinds(candidate.kind),
      },
      ...this.scopeWhereForCandidate(input.namespace, candidate),
    };

    const rowsById = new Map<string, MemoryFact>();

    if (lexicalOr.length) {
      const lexicalRows = await this.prisma.memoryFact.findMany({
        where: {
          ...baseWhere,
          OR: lexicalOr,
        },
        orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
      });

      for (const row of lexicalRows) {
        rowsById.set(row.id, row);
      }
    }

    if (rowsById.size < limit) {
      const fallbackRows = await this.prisma.memoryFact.findMany({
        where: baseWhere,
        orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
      });

      for (const row of fallbackRows) {
        rowsById.set(row.id, row);
      }
    }

    return Array.from(rowsById.values()).map(rowToFact);
  }

  async findPendingSimilar(input: {
    namespace: MemoryNamespace;
    candidate: MemoryCandidate;
    limit?: number;
  }): Promise<MemoryFactRecord[]> {
    const candidate = input.candidate;
    const limit = normalizeLimit(input.limit, 24, 1, 80);
    const lexicalOr = this.buildSimilarityLexicalOr(candidate);

    const baseWhere: Prisma.MemoryFactWhereInput = {
      userId: input.namespace.userId,
      tenantId: clean(input.namespace.tenantId),
      status: 'pending_confirmation',
      scopeLevel: candidate.scopeLevel,
      kind: {
        in: this.compatibleKinds(candidate.kind),
      },
      ...this.scopeWhereForCandidate(input.namespace, candidate),
    };

    const rowsById = new Map<string, MemoryFact>();

    if (lexicalOr.length) {
      const lexicalRows = await this.prisma.memoryFact.findMany({
        where: {
          ...baseWhere,
          OR: lexicalOr,
        },
        orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
      });

      for (const row of lexicalRows) {
        rowsById.set(row.id, row);
      }
    }

    if (rowsById.size < limit) {
      const fallbackRows = await this.prisma.memoryFact.findMany({
        where: baseWhere,
        orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
      });

      for (const row of fallbackRows) {
        rowsById.set(row.id, row);
      }
    }

    return Array.from(rowsById.values()).map(rowToFact);
  }


  async findDeletedSimilar(input: {
    namespace: MemoryNamespace;
    candidate: MemoryCandidate;
    limit?: number;
  }): Promise<MemoryFactRecord[]> {
    const candidate = input.candidate;
    const limit = normalizeLimit(input.limit, 24, 1, 80);
    const lexicalOr = this.buildSimilarityLexicalOr(candidate);

    const baseWhere: Prisma.MemoryFactWhereInput = {
      userId: input.namespace.userId,
      tenantId: clean(input.namespace.tenantId),
      status: 'deleted',
      scopeLevel: candidate.scopeLevel,
      kind: {
        in: this.compatibleKinds(candidate.kind),
      },
      ...this.scopeWhereForCandidate(input.namespace, candidate),
    };

    const rowsById = new Map<string, MemoryFact>();

    if (lexicalOr.length) {
      const lexicalRows = await this.prisma.memoryFact.findMany({
        where: {
          ...baseWhere,
          OR: lexicalOr,
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: limit,
      });

      for (const row of lexicalRows) {
        rowsById.set(row.id, row);
      }
    }

    if (rowsById.size < limit) {
      const fallbackRows = await this.prisma.memoryFact.findMany({
        where: baseWhere,
        orderBy: [{ updatedAt: 'desc' }],
        take: limit,
      });

      for (const row of fallbackRows) {
        rowsById.set(row.id, row);
      }
    }

    return Array.from(rowsById.values()).map(rowToFact);
  }

  async listAlwaysOnFactsForContext(input: {
    namespace: MemoryNamespace;
    limit?: number;
  }): Promise<MemoryRetrievalItem[]> {
    const limit = normalizeLimit(input.limit, 8, 1, 24);

    const rows = await this.prisma.memoryFact.findMany({
      where: {
        userId: input.namespace.userId,
        tenantId: clean(input.namespace.tenantId),
        status: 'active',
        scopeLevel: 'user',
        stability: 'long_term',
        sensitivity: 'normal',
        kind: {
          in: ['preference', 'tool_preference', 'constraint', 'workflow'],
        },
        agentId: null,
        conversationId: null,
        projectId: null,
        groupId: null,
        planId: null,
        orgId: null,
      },
      orderBy: [{ lastUsedAt: 'desc' }, { confidence: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    });

    return rows.map((row): MemoryRetrievalItem => ({
      id: row.id,
      kind: toKind(row.kind),
      scopeLevel: toScopeLevel(row.scopeLevel),
      summary: row.summary,
      valueJson: row.valueJson,
      confidence: Number(row.confidence ?? 0),
      score: 1,
      sensitivity: toSensitivity(row.sensitivity),
      stability: toStability(row.stability),
      source: rowToSource(row),
      updatedAt: row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString?.() ?? null,
      usageCount: Number(row.usageCount ?? 0),
    }));
  }

  async retrieve(input: {
    namespace: MemoryNamespace;
    query: string;
    terms: string[];
    limit?: number;
  }): Promise<MemoryRetrievalItem[]> {
    const limit = normalizeLimit(input.limit, 40, 1, 80);
    const terms = input.terms.map((term) => term.trim()).filter(Boolean).slice(0, 12);

    const lexicalOr: Prisma.MemoryFactWhereInput[] = terms.length
      ? terms.map((term) => ({
          searchText: {
            contains: term,
            mode: 'insensitive',
          },
        }))
      : clean(input.query)
        ? [
            {
              searchText: {
                contains: String(input.query).trim().slice(0, 64),
                mode: 'insensitive',
              },
            },
          ]
        : [];

    const scopeOr: Prisma.MemoryFactWhereInput[] = [
      {
        scopeLevel: 'user',
        agentId: null,
        conversationId: null,
        projectId: null,
        groupId: null,
        planId: null,
        orgId: null,
      },
    ];

    if (input.namespace.agentId) {
      scopeOr.push({
        scopeLevel: 'agent',
        agentId: input.namespace.agentId,
      });
    }

    if (input.namespace.conversationId) {
      scopeOr.push({
        scopeLevel: 'conversation',
        conversationId: input.namespace.conversationId,
      });
    }

    if (input.namespace.projectId) {
      scopeOr.push({
        scopeLevel: 'project',
        projectId: input.namespace.projectId,
      });
    }

    if (input.namespace.groupId) {
      scopeOr.push({
        scopeLevel: 'group',
        groupId: input.namespace.groupId,
      });
    }

    if (input.namespace.orgId) {
      scopeOr.push({
        scopeLevel: 'org',
        orgId: input.namespace.orgId,
      });
    }

    if (input.namespace.planId) {
      scopeOr.push({
        scopeLevel: 'plan',
        planId: input.namespace.planId,
      });
    }

    const and: Prisma.MemoryFactWhereInput[] = [
      {
        OR: scopeOr,
      },
    ];

    if (lexicalOr.length) {
      and.push({
        OR: lexicalOr,
      });
    }

    const rows = await this.prisma.memoryFact.findMany({
      where: {
        userId: input.namespace.userId,
        tenantId: clean(input.namespace.tenantId),
        status: 'active',
        AND: and,
      },
      orderBy: [{ lastUsedAt: 'desc' }, { confidence: 'desc' }, { updatedAt: 'desc' }],
      take: Math.max(limit, 12),
    });

    return rows.map((row): MemoryRetrievalItem => ({
      id: row.id,
      kind: toKind(row.kind),
      scopeLevel: toScopeLevel(row.scopeLevel),
      summary: row.summary,
      valueJson: row.valueJson,
      confidence: Number(row.confidence ?? 0),
      score: 0,
      sensitivity: toSensitivity(row.sensitivity),
      stability: toStability(row.stability),
      source: rowToSource(row),
      updatedAt: row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString?.() ?? null,
      usageCount: Number(row.usageCount ?? 0),
    }));
  }

  async markUsed(memoryIds: string[]): Promise<void> {
    const ids = Array.from(new Set(memoryIds.map((id) => id.trim()).filter(Boolean)));
    if (!ids.length) return;

    await this.prisma.memoryFact.updateMany({
      where: {
        id: {
          in: ids,
        },
      },
      data: {
        lastUsedAt: new Date(),
        usageCount: {
          increment: 1,
        },
      },
    });
  }

  async markUsedForNamespace(input: { namespace: MemoryNamespace; memoryIds: string[] }): Promise<void> {
    const ids = Array.from(new Set(input.memoryIds.map((id) => id.trim()).filter(Boolean)));
    if (!ids.length) return;

    await this.prisma.memoryFact.updateMany({
      where: {
        userId: input.namespace.userId,
        tenantId: clean(input.namespace.tenantId),
        id: {
          in: ids,
        },
      },
      data: {
        lastUsedAt: new Date(),
        usageCount: {
          increment: 1,
        },
      },
    });
  }

  async recordRuntimeUsage(input: {
    namespace: MemoryNamespace;
    memoryIds: string[];
    traceId?: string | null;
    conversationId?: string | null;
    userMessageId?: string | null;
    assistantMessageId?: string | null;
    reason?: string | null;
  }): Promise<{ used: number }> {
    const ids = Array.from(
      new Set(input.memoryIds.map((id) => clean(id)).filter(Boolean) as string[]),
    );

    if (!ids.length) return { used: 0 };

    const now = new Date();

    const rows = await this.prisma.memoryFact.findMany({
      where: {
        id: { in: ids },
        userId: input.namespace.userId,
        tenantId: clean(input.namespace.tenantId),
        status: 'active',
      },
      select: {
        id: true,
      },
    });

    const ownedIds = rows.map((row) => row.id);
    if (!ownedIds.length) return { used: 0 };

    await this.prisma.$transaction(async (tx) => {
      await tx.memoryFact.updateMany({
        where: {
          id: { in: ownedIds },
          userId: input.namespace.userId,
          tenantId: clean(input.namespace.tenantId),
          status: 'active',
        },
        data: {
          lastUsedAt: now,
          usageCount: {
            increment: 1,
          },
        },
      });

      for (const memoryId of ownedIds) {
        await tx.memoryAudit.create({
          data: {
            ...namespaceCreateData(input.namespace),
            action: 'use',
            memoryId,
            payloadJson: {
              traceId: input.traceId ?? null,
              conversationId: input.conversationId ?? input.namespace.conversationId ?? null,
              userMessageId: input.userMessageId ?? null,
              assistantMessageId: input.assistantMessageId ?? null,
              reason: input.reason ?? 'runtime_memory_used',
            },
          },
        });
      }
    });

    return { used: ownedIds.length };
  }

  async listFacts(input: {
    namespace: MemoryNamespace;
    limit?: number;
    cursor?: string | null;
  }): Promise<MemoryFactRecord[]> {
    const rows = await this.prisma.memoryFact.findMany({
      where: {
        ...namespaceWhere(input.namespace),
        status: {
          not: 'deleted',
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: normalizeLimit(input.limit, 50, 1, 200),
      ...(input.cursor
        ? {
            cursor: {
              id: input.cursor,
            },
            skip: 1,
          }
        : {}),
    });

    return rows.map(rowToFact);
  }

  async createEpisode(input: {
    namespace: MemoryNamespace;
    traceId?: string | null;
    userText?: string | null;
    assistantText?: string | null;
    sourceConversationId?: string | null;
    sourceUserMessageId?: string | null;
    sourceAssistantMessageId?: string | null;
  }) {
    return this.prisma.memoryEpisode.create({
      data: {
        ...namespaceCreateData(input.namespace),
        sourceConversationId: clean(input.sourceConversationId),
        sourceUserMessageId: clean(input.sourceUserMessageId),
        sourceAssistantMessageId: clean(input.sourceAssistantMessageId),
        sourceTraceId: clean(input.traceId),
        userText: clean(input.userText),
        assistantText: clean(input.assistantText),
      },
    });
  }

  async audit(input: {
    namespace: MemoryNamespace;
    action: string;
    memoryId?: string | null;
    payload?: unknown;
  }): Promise<void> {
    await this.prisma.memoryAudit
      .create({
        data: {
          ...namespaceCreateData(input.namespace),
          action: input.action,
          memoryId: clean(input.memoryId),
          payloadJson: (input.payload ?? {}) as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }

  private async assertOwned(namespace: MemoryNamespace, memoryId: string): Promise<void> {
    const id = clean(memoryId);
    if (!id) {
      throw new Error('memory_id_required');
    }

    const existing = await this.prisma.memoryFact.findFirst({
      where: {
        id,
        userId: namespace.userId,
        tenantId: clean(namespace.tenantId),
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      throw new Error('memory_not_found_or_not_owned');
    }
  }

  private buildSimilarityLexicalOr(candidate: MemoryCandidate): Prisma.MemoryFactWhereInput[] {
    const tokens = this.similarityTokens([
      candidate.subject,
      candidate.predicate,
      candidate.summary,
      JSON.stringify(candidate.value ?? ''),
      ...(candidate.tags ?? []),
    ].join(' ')).slice(0, 64);

    return tokens.map((value): Prisma.MemoryFactWhereInput => ({
      searchText: {
        contains: value,
        mode: 'insensitive',
      },
    }));
  }

  private similarityTokens(value: unknown): string[] {
    return memoryLexicalTokens(normalizeMemoryText(value));
  }

  private scopeWhereForCandidate(
    namespace: MemoryNamespace,
    candidate: MemoryCandidate,
  ): Prisma.MemoryFactWhereInput {
    if (candidate.scopeLevel === 'user') {
      return {
        agentId: null,
        conversationId: null,
        projectId: null,
        groupId: null,
        planId: null,
        orgId: null,
      };
    }

    if (candidate.scopeLevel === 'agent') {
      return {
        agentId: clean(namespace.agentId),
      };
    }

    if (candidate.scopeLevel === 'conversation') {
      return {
        conversationId: clean(namespace.conversationId),
      };
    }

    if (candidate.scopeLevel === 'project') {
      return {
        projectId: clean(namespace.projectId),
      };
    }

    if (candidate.scopeLevel === 'group') {
      return {
        groupId: clean(namespace.groupId),
      };
    }

    if (candidate.scopeLevel === 'org') {
      return {
        orgId: clean(namespace.orgId),
      };
    }

    if (candidate.scopeLevel === 'plan') {
      return {
        planId: clean(namespace.planId),
      };
    }

    return {};
  }

  private compatibleKinds(kind: MemoryKind): MemoryKind[] {
    const group = memoryKindGroup(kind);

    return Array.from(MEMORY_KINDS).filter((value) => memoryKindGroup(value) === group);
  }

  private buildSearchText(candidate: MemoryCandidate): string {
    const parts = [
      candidate.kind,
      candidate.scopeLevel,
      candidate.subject,
      candidate.predicate,
      candidate.summary,
      JSON.stringify(candidate.value ?? ''),
      ...(candidate.tags ?? []),
    ];

    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
  }
}