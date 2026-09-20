                                                                            
import { Injectable } from '@nestjs/common';
import type { ImplicitMemoryDecision } from '../governance/implicit-memory-policy.service';
import type {
  MemoryAdmissionDecision,
  MemoryCandidate,
  MemoryFactRecord,
  MemoryNamespace,
} from '../kernel/memory.types';
import { MemoryRepository } from '../storage/prisma/memory.repository';

type CandidateOrigin = 'explicit' | 'implicit';

type CandidateAuditInput = {
  namespace: MemoryNamespace;
  traceId?: string | null;
  episodeId?: string | null;
  origin: CandidateOrigin;
  stage: string;
  candidate: MemoryCandidate;
  reasonCode?: string | null;
  action?: string | null;
  targetMemoryId?: string | null;
  similarActive?: MemoryFactRecord[];
  similarPending?: MemoryFactRecord[];
  similarDeleted?: MemoryFactRecord[];
  appliedMemoryId?: string | null;
  extra?: Record<string, unknown>;
};

@Injectable()
export class MemoryDecisionAuditService {
  constructor(private readonly repo: MemoryRepository) {}

  async episodeCreated(input: {
    namespace: MemoryNamespace;
    traceId?: string | null;
    episodeId?: string | null;
    sourceConversationId?: string | null;
    sourceUserMessageId?: string | null;
    sourceAssistantMessageId?: string | null;
  }): Promise<void> {
    await this.repo.audit({
      namespace: input.namespace,
      action: 'memory_episode_created',
      payload: {
        traceId: input.traceId ?? null,
        episodeId: input.episodeId ?? null,
        sourceConversationId: input.sourceConversationId ?? null,
        sourceUserMessageId: input.sourceUserMessageId ?? null,
        sourceAssistantMessageId: input.sourceAssistantMessageId ?? null,
      },
    });
  }

  async candidateDecision(input: CandidateAuditInput): Promise<void> {
    await this.repo.audit({
      namespace: input.namespace,
      action: 'memory_candidate_decision',
      memoryId: input.appliedMemoryId ?? input.targetMemoryId ?? null,
      payload: {
        traceId: input.traceId ?? null,
        episodeId: input.episodeId ?? null,
        origin: input.origin,
        stage: input.stage,
        action: input.action ?? null,
        reasonCode: input.reasonCode ?? null,
        targetMemoryId: input.targetMemoryId ?? null,
        appliedMemoryId: input.appliedMemoryId ?? null,
        candidate: this.candidatePayload(input.candidate),
        similar: {
          active: this.factRefs(input.similarActive),
          pending: this.factRefs(input.similarPending),
          deleted: this.factRefs(input.similarDeleted),
        },
        ...(input.extra ?? {}),
      },
    });
  }

  async implicitDecision(input: {
    namespace: MemoryNamespace;
    traceId?: string | null;
    episodeId?: string | null;
    candidate: MemoryCandidate;
    decision: ImplicitMemoryDecision;
    similarActive?: MemoryFactRecord[];
    similarPending?: MemoryFactRecord[];
    similarDeleted?: MemoryFactRecord[];
  }): Promise<void> {
    await this.candidateDecision({
      namespace: input.namespace,
      traceId: input.traceId ?? null,
      episodeId: input.episodeId ?? null,
      origin: 'implicit',
      stage: 'implicit_policy',
      candidate: input.candidate,
      action: input.decision.action,
      reasonCode: input.decision.reason,
      targetMemoryId: input.decision.targetMemoryId ?? null,
      similarActive: input.similarActive,
      similarPending: input.similarPending,
      similarDeleted: input.similarDeleted,
      extra: {
        confidence: input.decision.confidence,
      },
    });
  }

  async admissionDecision(input: {
    namespace: MemoryNamespace;
    traceId?: string | null;
    episodeId?: string | null;
    origin: CandidateOrigin;
    decision: MemoryAdmissionDecision;
    similarActive?: MemoryFactRecord[];
  }): Promise<void> {
    await this.candidateDecision({
      namespace: input.namespace,
      traceId: input.traceId ?? null,
      episodeId: input.episodeId ?? null,
      origin: input.origin,
      stage: 'admission_policy',
      candidate: input.decision.candidate,
      action: input.decision.action,
      reasonCode: input.decision.reason,
      targetMemoryId: input.decision.targetMemoryId ?? null,
      similarActive: input.similarActive,
      extra: {
        confidence: input.decision.confidence,
      },
    });
  }

  async promotionDecision(input: {
    namespace: MemoryNamespace;
    traceId?: string | null;
    episodeId?: string | null;
    candidate: MemoryCandidate;
    pendingFact: MemoryFactRecord;
    shouldPromote: boolean;
    reasonCode?: string | null;
    confidence: number;
    promotedMemoryId?: string | null;
  }): Promise<void> {
    await this.candidateDecision({
      namespace: input.namespace,
      traceId: input.traceId ?? null,
      episodeId: input.episodeId ?? null,
      origin: 'implicit',
      stage: 'promotion_policy',
      candidate: input.candidate,
      action: input.shouldPromote ? 'promote' : 'keep_pending',
      reasonCode: input.reasonCode ?? null,
      targetMemoryId: input.pendingFact.id,
      appliedMemoryId: input.promotedMemoryId ?? null,
      similarPending: [input.pendingFact],
      extra: {
        confidence: input.confidence,
      },
    });
  }

  private candidatePayload(candidate: MemoryCandidate) {
    return {
      kind: candidate.kind,
      scopeLevel: candidate.scopeLevel,
      subject: candidate.subject,
      predicate: candidate.predicate,
      summary: candidate.summary,
      value: candidate.value,
      stability: candidate.stability,
      sensitivity: candidate.sensitivity,
      confidence: candidate.confidence,
      tags: candidate.tags ?? [],
      sourceHash: candidate.sourceHash ?? null,
      evidence: {
        source: candidate.evidence.source,
        conversationId: candidate.evidence.conversationId ?? null,
        userMessageId: candidate.evidence.userMessageId ?? null,
        assistantMessageId: candidate.evidence.assistantMessageId ?? null,
        traceId: candidate.evidence.traceId ?? null,
        quote: candidate.evidence.quote ?? null,
      },
    };
  }

  private factRefs(facts?: MemoryFactRecord[]) {
    return (facts ?? []).slice(0, 8).map((fact) => ({
      id: fact.id,
      status: fact.status,
      kind: fact.kind,
      scopeLevel: fact.scopeLevel,
      subject: fact.subject,
      predicate: fact.predicate,
      summary: fact.summary,
      confidence: fact.confidence,
      updatedAt: fact.updatedAt,
    }));
  }
}
