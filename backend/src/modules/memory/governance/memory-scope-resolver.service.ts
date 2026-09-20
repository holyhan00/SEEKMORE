                                                                         
import { Injectable } from '@nestjs/common';
import type { MemoryCandidate, MemoryNamespace } from '../kernel/memory.types';

@Injectable()
export class MemoryScopeResolver {
  normalizeNamespaceForCandidate(
    namespace: MemoryNamespace,
    candidate: MemoryCandidate,
  ): MemoryNamespace {
    const base: MemoryNamespace = {
      userId: namespace.userId,
      tenantId: namespace.tenantId ?? null,
    };

    switch (candidate.scopeLevel) {
      case 'user':
        return base;

      case 'agent':
        return {
          ...base,
          agentId: namespace.agentId ?? null,
        };

      case 'conversation':
        return {
          ...base,
          conversationId: namespace.conversationId ?? null,
        };

      case 'project':
        return {
          ...base,
          projectId: namespace.projectId ?? null,
        };

      case 'org':
        return {
          ...base,
          orgId: namespace.orgId ?? null,
        };

      case 'group':
        return {
          ...base,
          groupId: namespace.groupId ?? null,
        };

      case 'plan':
        return {
          ...base,
          planId: namespace.planId ?? null,
        };

      default:
        return base;
    }
  }
}