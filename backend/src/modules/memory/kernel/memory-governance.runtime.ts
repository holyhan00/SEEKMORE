                                                                 
import { Injectable } from '@nestjs/common';
import type { MemoryNamespace } from './memory.types';

@Injectable()
export class MemoryGovernanceRuntime {
  assertReadable(actorUserId: string, namespace: MemoryNamespace) {
    if (!namespace.userId || namespace.userId !== actorUserId) {
      throw new Error('MEMORY_ACCESS_DENIED');
    }
  }

  assertWritable(actorUserId: string, namespace: MemoryNamespace) {
    this.assertReadable(actorUserId, namespace);
  }
}
