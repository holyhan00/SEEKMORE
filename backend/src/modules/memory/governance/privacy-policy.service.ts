                                                                  
import { Injectable } from '@nestjs/common';
import type { MemoryCandidate } from '../kernel/memory.types';
import type { MemoryStatus } from '../kernel/memory.constants';
import type { MemoryWriteFrame } from '../frames/memory-frame.types';

export type MemoryPrivacyWriteDecision = {
  allowed: boolean;
  requiresConfirmation: boolean;
  targetStatus: MemoryStatus | 'rejected';
  effectiveSensitivity: MemoryCandidate['sensitivity'];
  reasonCodes: string[];
};

@Injectable()
export class MemoryPrivacyPolicy {
  evaluateWrite(input: {
    frame: MemoryWriteFrame;
    candidate: MemoryCandidate;
  }): MemoryPrivacyWriteDecision {
    const sensitivity = input.candidate.sensitivity;

    if (sensitivity === 'normal') {
      return {
        allowed: true,
        requiresConfirmation: false,
        targetStatus: 'active',
        effectiveSensitivity: 'normal',
        reasonCodes: ['normal_memory'],
      };
    }

    if (sensitivity === 'private') {
      return {
        allowed: true,
        requiresConfirmation: false,
        targetStatus: 'active',
        effectiveSensitivity: 'private',
        reasonCodes: ['private_memory'],
      };
    }

    if (sensitivity === 'sensitive') {
      const confirmed = input.frame.explicitness === 'explicit';

      return {
        allowed: true,
        requiresConfirmation: !confirmed,
        targetStatus: confirmed ? 'active' : 'pending_confirmation',
        effectiveSensitivity: 'sensitive',
        reasonCodes: confirmed
          ? ['sensitive_explicit_confirmed']
          : ['sensitive_requires_confirmation'],
      };
    }

    return {
      allowed: false,
      requiresConfirmation: true,
      targetStatus: 'rejected',
      effectiveSensitivity: 'restricted',
      reasonCodes: ['restricted_memory_rejected'],
    };
  }

  sanitize(candidate: MemoryCandidate): MemoryCandidate {
    if (candidate.sensitivity !== 'restricted') {
      return candidate;
    }

    return {
      ...candidate,
      confidence: Math.min(candidate.confidence, 0.2),
    };
  }

  requiresConfirmation(candidate: MemoryCandidate): boolean {
    return candidate.sensitivity === 'sensitive' || candidate.sensitivity === 'restricted';
  }

  canInjectIntoContext(candidateOrSensitivity: MemoryCandidate | MemoryCandidate['sensitivity']): boolean {
    const sensitivity =
      typeof candidateOrSensitivity === 'string'
        ? candidateOrSensitivity
        : candidateOrSensitivity.sensitivity;

    return sensitivity === 'normal' || sensitivity === 'private';
  }

  shouldMaskInManagementView(candidateOrSensitivity: MemoryCandidate | MemoryCandidate['sensitivity']): boolean {
    const sensitivity =
      typeof candidateOrSensitivity === 'string'
        ? candidateOrSensitivity
        : candidateOrSensitivity.sensitivity;

    return sensitivity === 'sensitive' || sensitivity === 'restricted';
  }
}