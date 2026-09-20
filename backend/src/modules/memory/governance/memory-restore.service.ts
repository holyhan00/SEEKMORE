import { Injectable, Logger } from '@nestjs/common';
import { MemoryAdmissionPolicy } from './admission-policy.service';
import { MemoryConflictResolver } from './conflict-resolver.service';
import { MemoryRepository } from '../storage/prisma/memory.repository';
import type { MemoryCandidate, MemoryNamespace } from '../kernel/memory.types';

@Injectable()
export class MemoryRestoreService {
  private readonly logger = new Logger(MemoryRestoreService.name);
  constructor(
    private readonly repo: MemoryRepository,
    private readonly admission: MemoryAdmissionPolicy,
    private readonly conflicts: MemoryConflictResolver,
  ) {}

  async restore(input: {
    namespace: MemoryNamespace;
    memoryId: string;
    reason?: string | null;
    actor?: string | null;
    sourceFrameId?: string | null;
  }) {
    this.logger.log(
      `[MemoryRestore] start memoryId=${input.memoryId} userId=${input.namespace.userId} reason=${input.reason ?? '-'}`,
    );

    const deleted = await this.repo.findFactById({
      namespace: input.namespace,
      memoryId: input.memoryId,
      includeDeleted: true,
    });

    if (!deleted || deleted.status !== 'deleted') {
      this.logger.warn(
        `[MemoryRestore] deleted_memory_not_found memoryId=${input.memoryId} found=${Boolean(deleted)} status=${deleted?.status ?? '-'}`,
      );
      throw new Error('deleted_memory_not_found');
    }

    const candidate = this.factToCandidate(deleted);
    const similar = await this.repo.findSimilar({
      namespace: input.namespace,
      candidate,
    });

    this.logger.debug(
      `[MemoryRestore] similar memoryId=${input.memoryId} count=${similar.length} ids=${similar.map((item) => `${item.id}:${item.status}`).join(',')}`,
    );

    const decision = this.admission.decide({
      frame: {
        intent: 'update',
        explicitness: 'explicit',
        confidence: 1,
        namespace: input.namespace,
        reason: input.reason ?? 'restore_deleted_memory',
        targetMemoryIds: [input.memoryId],
        userText: deleted.summary,
        assistantText: null,
        source: {
          conversationId: deleted.source.conversationId,
          userMessageId: deleted.source.userMessageId,
          assistantMessageId: deleted.source.assistantMessageId,
          traceId: input.sourceFrameId ?? deleted.source.traceId,
        },
      },
      candidate,
      similar,
    });

    this.logger.log(
      `[MemoryRestore] decision memoryId=${input.memoryId} action=${decision.action} reason=${decision.reason} target=${decision.targetMemoryId ?? '-'}`,
    );

    if (decision.action === 'write') {
      const restored = await this.repo.restoreFactDirect({
        namespace: input.namespace,
        memoryId: input.memoryId,
        reason: input.reason ?? 'restore_deleted_memory',
        actor: input.actor ?? 'memory-restore-service',
        sourceFrameId: input.sourceFrameId ?? null,
      });

      this.logger.log(
        `[MemoryRestore] direct_restore memoryId=${input.memoryId} restoredId=${restored.id}`,
      );

      return {
        action: 'restored',
        memory: restored,
        decision,
      };
    }

    if (decision.action === 'supersede' || decision.action === 'update_existing') {
      await this.conflicts.apply(input.namespace, {
        ...decision,
        action: 'supersede',
      });

      const restored = await this.repo.restoreFactDirect({
        namespace: input.namespace,
        memoryId: input.memoryId,
        reason: input.reason ?? 'restore_deleted_memory',
        actor: input.actor ?? 'memory-restore-service',
        sourceFrameId: input.sourceFrameId ?? null,
      });

      this.logger.log(
        `[MemoryRestore] replace_restore memoryId=${input.memoryId} restoredId=${restored.id} target=${decision.targetMemoryId ?? '-'}`,
      );

      return {
        action: 'replace_and_restore',
        memory: restored,
        decision,
      };
    }

    const applied = await this.conflicts.apply(input.namespace, decision);

    this.logger.log(
      `[MemoryRestore] applied memoryId=${input.memoryId} action=${decision.action}`,
    );

    return {
      action: decision.action,
      memory: applied,
      decision,
    };
  }

  private factToCandidate(fact: Awaited<ReturnType<MemoryRepository['findFactById']>>): MemoryCandidate {
    if (!fact) {
      throw new Error('memory_fact_required');
    }

    return {
      kind: fact.kind,
      scopeLevel: fact.scopeLevel,
      subject: fact.subject,
      predicate: fact.predicate,
      value: fact.valueJson,
      summary: fact.summary,
      stability: fact.stability,
      sensitivity: fact.sensitivity,
      confidence: fact.confidence,
      evidence: {
        source: fact.source.source,
        conversationId: fact.source.conversationId,
        userMessageId: fact.source.userMessageId,
        assistantMessageId: fact.source.assistantMessageId,
        traceId: fact.source.traceId,
        quote: fact.source.quote,
      },
      tags: [],
      sourceHash: null,
    };
  }
}