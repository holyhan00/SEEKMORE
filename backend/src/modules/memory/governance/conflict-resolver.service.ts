                                                                     
import { Injectable } from '@nestjs/common';
import { MemoryRepository } from '../storage/prisma/memory.repository';
import type {
  MemoryAdmissionDecision,
  MemoryFactRecord,
  MemoryNamespace,
} from '../kernel/memory.types';

@Injectable()
export class MemoryConflictResolver {
  constructor(private readonly repo: MemoryRepository) {}

  async apply(
    namespace: MemoryNamespace,
    decision: MemoryAdmissionDecision,
  ): Promise<MemoryFactRecord | null> {
    if (decision.action === 'skip') {
      return null;
    }

    if (decision.action === 'ask_confirmation') {
      return this.repo.createFact({
        namespace,
        candidate: decision.candidate,
        status: 'pending_confirmation',
      });
    }

    if (decision.action === 'update_existing') {
      if (!decision.targetMemoryId) return null;

      return this.repo.updateFact({
        namespace,
        memoryId: decision.targetMemoryId,
        candidate: decision.candidate,
      });
    }

    if (decision.action === 'supersede') {
      if (!decision.targetMemoryId) {
        return this.repo.createFact({
          namespace,
          candidate: decision.candidate,
        });
      }

      await this.repo.markStatus({
        namespace,
        memoryId: decision.targetMemoryId,
        status: 'superseded',
        reason: decision.reason,
      });

      return this.repo.createFact({
        namespace,
        candidate: decision.candidate,
      });
    }

    if (decision.action === 'delete') {
      if (!decision.targetMemoryId) return null;

      return this.repo.softDeleteFact({
        namespace,
        memoryId: decision.targetMemoryId,
        reason: decision.reason,
      });
    }

    if (decision.action === 'restore') {
      if (!decision.targetMemoryId) return null;

      this.repo.restoreFactDirect({
        namespace,
        memoryId: decision.targetMemoryId,
        reason: decision.reason,
      });
    }

    if (decision.action === 'write') {
      return this.repo.createFact({
        namespace,
        candidate: decision.candidate,
      });
    }

    return null;
  }

  async applyStrongTargets(input: {
    namespace: MemoryNamespace;
    action: 'delete' | 'restore';
    targetMemoryIds: string[];
    reason?: string | null;
  }): Promise<{
    applied: MemoryFactRecord[];
    skipped: Array<{ memoryId: string; reason: 'missing_target' | 'already_deleted' | 'already_active' }>;
  }> {
    const targetIds = Array.from(new Set(input.targetMemoryIds.map((id) => id.trim()).filter(Boolean)));

    if (!targetIds.length) {
      return { applied: [], skipped: [] };
    }

    const existing = await this.repo.findFactsByIds({
      namespace: input.namespace,
      memoryIds: targetIds,
      includeDeleted: true,
    });

    const existingById = new Map(existing.map((item) => [item.id, item]));
    const applied: MemoryFactRecord[] = [];
    const skipped: Array<{ memoryId: string; reason: 'missing_target' | 'already_deleted' | 'already_active' }> = [];

    for (const memoryId of targetIds) {
      const fact = existingById.get(memoryId);

      if (!fact) {
        skipped.push({ memoryId, reason: 'missing_target' });
        continue;
      }

      if (input.action === 'delete') {
        if (fact.status === 'deleted') {
          skipped.push({ memoryId, reason: 'already_deleted' });
          continue;
        }

        applied.push(
          await this.repo.softDeleteFact({
            namespace: input.namespace,
            memoryId,
            reason: input.reason ?? 'strong_target_delete',
          }),
        );
        continue;
      }

      if (fact.status === 'active') {
        skipped.push({ memoryId, reason: 'already_active' });
        continue;
      }

      applied.push(
        await this.repo.restoreFactDirect({
          namespace: input.namespace,
          memoryId,
          reason: input.reason ?? 'strong_target_restore',
        }),
      );
    }

    return { applied, skipped };
  }
}