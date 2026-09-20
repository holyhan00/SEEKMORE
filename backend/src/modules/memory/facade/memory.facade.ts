import { Injectable } from '@nestjs/common';
import { MemoryReadRuntime } from '../kernel/memory-read.runtime';
import { MemoryWriteRuntime } from '../kernel/memory-write.runtime';
import { MemoryGovernanceRuntime } from '../kernel/memory-governance.runtime';
import { MemoryRepository } from '../storage/prisma/memory.repository';
import type { BuildContextInput, ListMemoryInput, WriteBackInput } from './memory.facade.types';
import { toNamespace } from './memory.facade.types';
import type {
  MemoryKind,
  MemoryScopeLevel,
  MemorySensitivity,
  MemoryStatus,
} from '../kernel/memory.constants';
import { MemoryRestoreService } from '../governance/memory-restore.service';

@Injectable()
export class MemoryFacade {
  constructor(
    private readonly readRuntime: MemoryReadRuntime,
    private readonly writeRuntime: MemoryWriteRuntime,
    private readonly governance: MemoryGovernanceRuntime,
    private readonly repo: MemoryRepository,
    private readonly restoreService: MemoryRestoreService,
  ) {}

  async buildContext(input: BuildContextInput) {
    const namespace = toNamespace(input.user, input.scope);
    this.governance.assertReadable(input.user.id, namespace);

    return this.readRuntime.buildContext({
      traceId: input.traceId ?? null,
      actor: {
        actorUserId: input.user.id,
        roles: input.user.roles ?? (input.user.role ? [input.user.role] : []),
      },
      namespace,
      query: input.query,
      recentMessages: input.recentMessages,
      maxItems: input.maxItems,
      maxChars: input.maxChars,
    });
  }

  async writeBack(input: WriteBackInput) {
    const namespace = toNamespace(input.user, input.scope);
    this.governance.assertWritable(input.user.id, namespace);

    return this.writeRuntime.write({
      traceId: input.traceId ?? null,
      actor: {
        actorUserId: input.user.id,
        roles: input.user.roles ?? (input.user.role ? [input.user.role] : []),
      },
      namespace,
      frame: {
        intent: input.intent,
        explicitness: input.explicitness,
        confidence: input.explicitness === 'explicit' ? 0.95 : 0.7,
        namespace,
        source: {
          conversationId: input.source?.conversationId ?? namespace.conversationId ?? null,
          userMessageId: input.source?.userMessageId ?? null,
          assistantMessageId: input.source?.assistantMessageId ?? null,
          traceId: input.traceId ?? null,
        },
        userText: input.userText ?? null,
        assistantText: input.assistantText ?? null,
        confirmedCandidates: input.confirmedCandidates ?? [],
        targetMemoryIds: input.targetMemoryIds ?? [],
        operationSource: input.operationSource ?? 'conversation',
        operationActor: input.operationActor ?? {
          userId: input.user.id,
          role: input.user.role ?? null,
        },
        reason: input.reason ?? null,
      },
    });
  }

  async list(input: ListMemoryInput) {
    const namespace = toNamespace(input.user, input.scope);
    this.governance.assertReadable(input.user.id, namespace);

    return this.repo.listFacts({
      namespace,
      cursor: input.cursor ?? null,
      limit: input.limit ?? 50,
    });
  }

  async listForManagement(input: ListMemoryInput & {
    status?: MemoryStatus | 'all' | null;
    scopeLevel?: MemoryScopeLevel | null;
    kind?: MemoryKind | null;
    sensitivity?: MemorySensitivity | null;
    keyword?: string | null;
  }) {
    const namespace = toNamespace(input.user, input.scope);
    this.governance.assertReadable(input.user.id, namespace);

    return this.repo.listFactsForManagement({
      namespace,
      status: input.status ?? 'active',
      scopeLevel: input.scopeLevel ?? null,
      kind: input.kind ?? null,
      sensitivity: input.sensitivity ?? null,
      keyword: input.keyword ?? null,
      cursor: input.cursor ?? null,
      limit: input.limit ?? 50,
    });
  }

  async deleteById(input: ListMemoryInput & {
    memoryId: string;
    reason?: string | null;
  }) {
    const namespace = toNamespace(input.user, input.scope);
    this.governance.assertWritable(input.user.id, namespace);

    return this.writeRuntime.write({
      traceId: null,
      actor: {
        actorUserId: input.user.id,
        roles: input.user.roles ?? (input.user.role ? [input.user.role] : []),
      },
      namespace,
      frame: {
        intent: 'forget',
        explicitness: 'explicit',
        confidence: 1,
        namespace,
        source: {
          conversationId: namespace.conversationId ?? null,
          userMessageId: null,
          assistantMessageId: null,
          traceId: null,
        },
        targetMemoryIds: [input.memoryId],
        confirmedCandidates: [],
        operationSource: 'management_ui',
        operationActor: {
          userId: input.user.id,
          role: input.user.role ?? null,
        },
        reason: input.reason ?? 'management_delete',
      },
    });
  }

  async restoreById(input: ListMemoryInput & {
    memoryId: string;
    reason?: string | null;
  }) {
    const namespace = toNamespace(input.user, input.scope);
    this.governance.assertWritable(input.user.id, namespace);

    return this.restoreService.restore({
      namespace,
      memoryId: input.memoryId,
      reason: input.reason ?? 'management_restore',
      actor: input.user.id,
      sourceFrameId: null,
    });
  }


  async promoteById(input: ListMemoryInput & {
    memoryId: string;
    reason?: string | null;
  }) {
    const namespace = toNamespace(input.user, input.scope);
    this.governance.assertWritable(input.user.id, namespace);

    return this.repo.promoteFact({
      namespace,
      memoryId: input.memoryId,
      reason: input.reason ?? 'management_promote',
      actor: input.user.id,
      sourceFrameId: null,
    });
  }

  async purgeById(input: ListMemoryInput & {
    memoryId: string;
    reason?: string | null;
  }) {
    const namespace = toNamespace(input.user, input.scope);
    this.governance.assertWritable(input.user.id, namespace);

    return this.repo.purgeFact({
      namespace,
      memoryId: input.memoryId,
      reason: input.reason ?? 'management_purge',
      actor: input.user.id,
      sourceFrameId: null,
    });
  }

  async recordRuntimeUsage(input: ListMemoryInput & {
    memoryIds: string[];
    traceId?: string | null;
    conversationId?: string | null;
    userMessageId?: string | null;
    assistantMessageId?: string | null;
    reason?: string | null;
  }) {
    const namespace = toNamespace(input.user, input.scope);
    this.governance.assertReadable(input.user.id, namespace);

    return this.repo.recordRuntimeUsage({
      namespace,
      memoryIds: input.memoryIds,
      traceId: input.traceId ?? null,
      conversationId: input.conversationId ?? namespace.conversationId ?? null,
      userMessageId: input.userMessageId ?? null,
      assistantMessageId: input.assistantMessageId ?? null,
      reason: input.reason ?? 'runtime_memory_used',
    });
  }

  async listAudit(input: ListMemoryInput & {
    memoryId?: string | null;
  }) {
    const namespace = toNamespace(input.user, input.scope);
    this.governance.assertReadable(input.user.id, namespace);

    return this.repo.listAudit({
      namespace,
      memoryId: input.memoryId ?? null,
      cursor: input.cursor ?? null,
      limit: input.limit ?? 50,
    });
  }
}