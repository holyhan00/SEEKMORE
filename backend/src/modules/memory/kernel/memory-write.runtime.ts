                                                            
import { Injectable, Logger } from '@nestjs/common';
import { ConfirmedMemoryExtractor } from '../extract/confirmed-memory.extractor';
import { LlmMemoryExtractor } from '../extract/llm-memory.extractor';
import { MemoryAdmissionPolicy } from '../governance/admission-policy.service';
import { MemoryConflictResolver } from '../governance/conflict-resolver.service';
import { ImplicitMemoryPolicy } from '../governance/implicit-memory-policy.service';
import { MemoryRetentionPolicy } from '../governance/retention-policy.service';
import { MemoryScopeResolver } from '../governance/memory-scope-resolver.service';
import { MemoryPromotionPolicy } from '../governance/promotion-policy.service';
import { MemoryDecisionAuditService } from '../observability/memory-decision-audit.service';
import { MemoryRepository } from '../storage/prisma/memory.repository';
import {
  memoryKindGroup,
  memoryLexicalTokens,
  memoryTokenJaccard,
  normalizeMemoryText,
  strongerMemorySensitivity,
  strongerMemoryStability,
  uniqueMemoryJsonValues,
} from '../shared/memory-primitives';
import type {
  MemoryAdmissionDecision,
  MemoryCandidate,
  MemoryFactRecord,
  MemoryNamespace,
  WriteMemoryInput,
  WriteMemoryOutput,
} from './memory.types';

@Injectable()
export class MemoryWriteRuntime {
  private readonly logger = new Logger(MemoryWriteRuntime.name);

  constructor(
    private readonly confirmedExtractor: ConfirmedMemoryExtractor,
    private readonly llmExtractor: LlmMemoryExtractor,
    private readonly admission: MemoryAdmissionPolicy,
    private readonly conflicts: MemoryConflictResolver,
    private readonly retention: MemoryRetentionPolicy,
    private readonly scopeResolver: MemoryScopeResolver,
    private readonly promotion: MemoryPromotionPolicy,
    private readonly implicitPolicy: ImplicitMemoryPolicy,
    private readonly decisionAudit: MemoryDecisionAuditService,
    private readonly repo: MemoryRepository,
  ) {}

  async write(input: WriteMemoryInput): Promise<WriteMemoryOutput> {
    const frame = input.frame;

    const episode = await this.repo
      .createEpisode({
        namespace: input.namespace,
        traceId: input.traceId ?? null,
        userText: frame.userText ?? null,
        assistantText: frame.assistantText ?? null,
        sourceConversationId: frame.source.conversationId ?? null,
        sourceUserMessageId: frame.source.userMessageId ?? null,
        sourceAssistantMessageId: frame.source.assistantMessageId ?? null,
      })
      .catch(() => null);

    const episodeId = this.extractRecordId(episode);
    this.logger.debug(
      `[MemoryEpisodeProbe] trace=${input.traceId ?? '-'} episodeId=${episodeId ?? '-'} conversationId=${frame.source.conversationId ?? '-'} userMessageId=${frame.source.userMessageId ?? '-'} assistantMessageId=${frame.source.assistantMessageId ?? '-'}`,
    );

    await this.decisionAudit.episodeCreated({
      namespace: input.namespace,
      traceId: input.traceId ?? null,
      episodeId,
      sourceConversationId: frame.source.conversationId ?? null,
      sourceUserMessageId: frame.source.userMessageId ?? null,
      sourceAssistantMessageId: frame.source.assistantMessageId ?? null,
    });

    if (frame.targetMemoryIds?.length && (frame.intent === 'forget' || frame.intent === 'update')) {
      const action = frame.intent === 'forget' ? 'delete' : null;

      if (action) {
        const result = await this.conflicts.applyStrongTargets({
          namespace: input.namespace,
          action,
          targetMemoryIds: frame.targetMemoryIds,
          reason: frame.reason ?? 'management_strong_target',
        });

        return {
          accepted: 0,
          updated: 0,
          deleted: result.applied.length,
          skipped: result.skipped.length,
          decisions: [],
        };
      }
    }

    const confirmed = this.confirmedExtractor.extract(frame);
    const extracted = confirmed.length ? [] : await this.llmExtractor.extract(frame);

    const explicitCandidates = this.collapseCandidates(
      confirmed
        .filter((candidate) => this.retention.shouldPersist(candidate))
        .map((candidate) => this.normalizeCandidateScope(input.namespace, candidate)),
    );
    this.logger.debug(
      `[MemoryExplicitCandidatesProbe] trace=${input.traceId ?? '-'} count=${explicitCandidates.length} candidates=${this.formatCandidatesForLog(explicitCandidates)}`,
    );

    const implicitCandidates = this.collapseCandidates(
      extracted
        .filter((candidate) => this.retention.shouldPersist(candidate))
        .map((candidate) => this.normalizeCandidateScope(input.namespace, candidate))
        .filter((candidate) => this.isImplicitCandidateGroundedInUserTurn(frame, candidate)),
    );
    this.logger.debug(
      `[MemoryImplicitCandidatesProbe] trace=${input.traceId ?? '-'} count=${implicitCandidates.length} candidates=${this.formatCandidatesForLog(implicitCandidates)}`,
    );

    const decisions: MemoryAdmissionDecision[] = [];
    let accepted = 0;
    let skipped = 0;
    let updated = 0;
    let deleted = 0;
    let episodeOnly = 0;
    let pending = 0;
    let deferred = 0;

    for (const candidate of explicitCandidates) {
      const result = await this.applyGovernedCandidate({
        input,
        candidate,
        frame,
        decisions,
        origin: 'explicit',
        episodeId,
      });

      accepted += result.accepted;
      skipped += result.skipped;
      updated += result.updated;
      deleted += result.deleted;
    }

    for (const candidate of implicitCandidates) {
      const scopedNamespace = this.scopeResolver.normalizeNamespaceForCandidate(
        input.namespace,
        candidate,
      );

      const [rawPendingSimilar, rawActiveSimilar, deletedSimilar] = await Promise.all([
        this.repo.findPendingSimilar({ namespace: scopedNamespace, candidate }),
        this.repo.findSimilar({ namespace: scopedNamespace, candidate }),
        this.repo.findDeletedSimilar({ namespace: scopedNamespace, candidate }),
      ]);

      const deletedGuard = this.resolveDeletedGuard(deletedSimilar, candidate);
      const pendingSimilar = deletedGuard.hit
        ? this.filterBlockedSimilar(rawPendingSimilar, deletedGuard.blockingFacts)
        : rawPendingSimilar;
      const activeSimilar = deletedGuard.hit
        ? this.filterBlockedSimilar(rawActiveSimilar, deletedGuard.blockingFacts)
        : rawActiveSimilar;

      if (deletedGuard.hit) {
        this.logger.debug(
          `[MemoryDeletedGuardProbe] trace=${input.traceId ?? '-'} episodeId=${episodeId ?? '-'} candidate=${this.formatCandidateForLog(candidate)} blockedDeleted=${this.formatSimilarForLog(deletedGuard.blockingFacts)} rawPendingSimilarCount=${rawPendingSimilar.length} rawActiveSimilarCount=${rawActiveSimilar.length} pendingSimilarCount=${pendingSimilar.length} activeSimilarCount=${activeSimilar.length}`,
        );
        this.logger.debug(
          `[MemoryImplicitRouteProbe] trace=${input.traceId ?? '-'} episodeId=${episodeId ?? '-'} route=defer reasonCode=implicit_deleted_guard candidate=${this.formatCandidateForLog(candidate)}`,
        );
        deferred += 1;
        skipped += 1;
        await this.repo.audit({
          namespace: scopedNamespace,
          action: 'implicit_memory_deferred',
          payload: {
            traceId: input.traceId ?? null,
            episodeId,
            reasonCode: 'implicit_deleted_guard',
            candidate: this.candidateAuditPayload(candidate),
            blockingMemoryIds: deletedGuard.blockingFacts.map((fact) => fact.id),
          },
        });
        continue;
      }

      const implicitDecision = this.implicitPolicy.decide({
        frame,
        namespace: scopedNamespace,
        candidate,
        similarActive: activeSimilar,
        similarPending: pendingSimilar,
        similarDeleted: deletedSimilar,
      });

      this.logger.debug(
        `[MemoryImplicitDecisionProbe] trace=${input.traceId ?? '-'} episodeId=${episodeId ?? '-'} action=${implicitDecision.action} reasonCode=${implicitDecision.reason} confidence=${implicitDecision.confidence} candidate=${this.formatCandidateForLog(candidate)} pendingSimilarCount=${pendingSimilar.length} activeSimilarCount=${activeSimilar.length} deletedSimilarCount=${deletedSimilar.length} pendingSimilar=${this.formatSimilarForLog(pendingSimilar)} activeSimilar=${this.formatSimilarForLog(activeSimilar)} deletedSimilar=${this.formatSimilarForLog(deletedSimilar)}`,
      );

      await this.decisionAudit.implicitDecision({
        namespace: scopedNamespace,
        traceId: input.traceId ?? null,
        episodeId,
        candidate,
        decision: implicitDecision,
        similarActive: activeSimilar,
        similarPending: pendingSimilar,
        similarDeleted: deletedSimilar,
      });

      if (implicitDecision.action === 'episode_only') {
        this.logger.debug(
          `[MemoryImplicitRouteProbe] trace=${input.traceId ?? '-'} episodeId=${episodeId ?? '-'} route=episode_only reasonCode=${implicitDecision.reason} candidate=${this.formatCandidateForLog(candidate)}`,
        );
        episodeOnly += 1;
        continue;
      }

      if (implicitDecision.action === 'skip') {
        this.logger.debug(
          `[MemoryImplicitRouteProbe] trace=${input.traceId ?? '-'} episodeId=${episodeId ?? '-'} route=skip reasonCode=${implicitDecision.reason} candidate=${this.formatCandidateForLog(candidate)}`,
        );
        skipped += 1;
        continue;
      }

      if (implicitDecision.action === 'defer') {
        this.logger.debug(
          `[MemoryImplicitRouteProbe] trace=${input.traceId ?? '-'} episodeId=${episodeId ?? '-'} route=defer reasonCode=${implicitDecision.reason} candidate=${this.formatCandidateForLog(candidate)}`,
        );
        deferred += 1;
        skipped += 1;
        await this.repo.audit({
          namespace: scopedNamespace,
          action: 'implicit_memory_deferred',
          payload: {
            traceId: input.traceId ?? null,
            episodeId,
            reasonCode: implicitDecision.reason,
            candidate: this.candidateAuditPayload(candidate),
          },
        });
        continue;
      }

      if (implicitDecision.action === 'pending') {
        this.logger.debug(
          `[MemoryImplicitRouteProbe] trace=${input.traceId ?? '-'} episodeId=${episodeId ?? '-'} route=pending reasonCode=${implicitDecision.reason} candidate=${this.formatCandidateForLog(candidate)}`,
        );
        const decision: MemoryAdmissionDecision = {
          action: 'ask_confirmation',
          reason: candidate.sensitivity === 'normal' ? 'user_confirmed' : 'privacy_sensitive',
          candidate,
          confidence: candidate.confidence,
        };

        await this.decisionAudit.admissionDecision({
          namespace: scopedNamespace,
          traceId: input.traceId ?? null,
          episodeId,
          origin: 'implicit',
          decision,
          similarActive: activeSimilar,
        });

        const applied = await this.conflicts.apply(scopedNamespace, decision);
        decisions.push(decision);

        if (applied) {
          pending += 1;
          skipped += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      this.logger.debug(
        `[MemoryImplicitRouteProbe] trace=${input.traceId ?? '-'} episodeId=${episodeId ?? '-'} route=active_or_promote reasonCode=${implicitDecision.reason} candidate=${this.formatCandidateForLog(candidate)}`,
      );
      const promotablePendingSimilar = this.filterPromotablePendingSimilar(
        pendingSimilar,
        candidate,
      );

      if (pendingSimilar.length !== promotablePendingSimilar.length) {
        this.logger.debug(
          `[MemoryPromotionGuardProbe] trace=${input.traceId ?? '-'} episodeId=${episodeId ?? '-'} candidate=${this.formatCandidateForLog(candidate)} pendingSimilarCount=${pendingSimilar.length} promotablePendingSimilarCount=${promotablePendingSimilar.length}`,
        );
      }

      const promoted = await this.tryPromotePendingCandidate({
        namespace: scopedNamespace,
        candidate,
        pendingSimilar: promotablePendingSimilar,
        traceId: input.traceId ?? null,
        episodeId,
      });

      if (promoted) {
        updated += 1;
        continue;
      }

      const result = await this.applyGovernedCandidate({
        input,
        candidate,
        frame,
        decisions,
        scopedNamespace,
        activeSimilar,
        origin: 'implicit',
        episodeId,
      });

      accepted += result.accepted;
      skipped += result.skipped;
      updated += result.updated;
      deleted += result.deleted;
    }

    this.logger.log(
      `[MemoryWrite] trace=${input.traceId ?? '-'} explicit=${explicitCandidates.length} implicit=${implicitCandidates.length} accepted=${accepted} pending=${pending} episodeOnly=${episodeOnly} deferred=${deferred} updated=${updated} skipped=${skipped} deleted=${deleted}`,
    );

    return {
      accepted,
      skipped,
      updated,
      deleted,
      decisions,
    };
  }

  private async applyGovernedCandidate(input: {
    input: WriteMemoryInput;
    frame: WriteMemoryInput['frame'];
    candidate: MemoryCandidate;
    decisions: MemoryAdmissionDecision[];
    scopedNamespace?: MemoryNamespace;
    activeSimilar?: MemoryFactRecord[];
    origin: 'explicit' | 'implicit';
    episodeId?: string | null;
  }): Promise<{ accepted: number; skipped: number; updated: number; deleted: number }> {
    const scopedNamespace =
      input.scopedNamespace ??
      this.scopeResolver.normalizeNamespaceForCandidate(input.input.namespace, input.candidate);

    const similar =
      input.activeSimilar ??
      (await this.repo.findSimilar({
        namespace: scopedNamespace,
        candidate: input.candidate,
      }));

    this.logger.debug(
      `[MemoryWriteProbe] trace=${input.input.traceId ?? '-'} candidate=${this.formatCandidateForLog(input.candidate)} similarCount=${similar.length} similar=${this.formatSimilarForLog(similar)}`,
    );

    const decision = this.admission.decide({
      frame: input.frame,
      candidate: input.candidate,
      similar,
    });

    this.logger.debug(
      `[MemoryAdmissionDecisionProbe] trace=${input.input.traceId ?? '-'} episodeId=${input.episodeId ?? '-'} origin=${input.origin} action=${decision.action} reasonCode=${decision.reason} target=${decision.targetMemoryId ?? '-'} candidate=${this.formatCandidateForLog(decision.candidate)} similarCount=${similar.length} similar=${this.formatSimilarForLog(similar)}`,
    );

    input.decisions.push(decision);

    await this.decisionAudit.admissionDecision({
      namespace: scopedNamespace,
      traceId: input.input.traceId ?? null,
      episodeId: input.episodeId ?? null,
      origin: input.origin,
      decision,
      similarActive: similar,
    });

    const applied = await this.conflicts.apply(scopedNamespace, decision);

    if (!applied) {
      return { accepted: 0, skipped: 1, updated: 0, deleted: 0 };
    }

    if (decision.action === 'ask_confirmation') {
      return { accepted: 0, skipped: 1, updated: 0, deleted: 0 };
    }

    if (decision.action === 'update_existing' || decision.action === 'supersede') {
      return { accepted: 0, skipped: 0, updated: 1, deleted: 0 };
    }

    if (decision.action === 'delete') {
      return { accepted: 0, skipped: 0, updated: 0, deleted: 1 };
    }

    return { accepted: 1, skipped: 0, updated: 0, deleted: 0 };
  }

  private resolveDeletedGuard(
    deletedSimilar: MemoryFactRecord[],
    candidate: MemoryCandidate,
  ): { hit: boolean; blockingFacts: MemoryFactRecord[] } {
    const blockingFacts = deletedSimilar.filter((fact) =>
      this.isDeletedGuardMatch(fact, candidate),
    );

    return {
      hit: blockingFacts.length > 0,
      blockingFacts,
    };
  }

  private filterBlockedSimilar(
    similar: MemoryFactRecord[],
    blockingFacts: MemoryFactRecord[],
  ): MemoryFactRecord[] {
    if (!blockingFacts.length) return similar;

    return similar.filter((fact) =>
      blockingFacts.every((blocked) => !this.isSameMemoryCluster(fact, blocked)),
    );
  }

  private isDeletedGuardMatch(
    deletedFact: MemoryFactRecord,
    candidate: MemoryCandidate,
  ): boolean {
    if (deletedFact.scopeLevel !== candidate.scopeLevel) return false;
    if (memoryKindGroup(deletedFact.kind as MemoryCandidate['kind']) !== memoryKindGroup(candidate.kind)) {
      return false;
    }

    const exactScore = this.memoryClusterScore(this.factText(deletedFact), this.candidateText(candidate));
    if (exactScore >= 0.46) {
      return true;
    }

    const deletedCoreText = this.memoryCoreText({
      subject: deletedFact.subject,
      predicate: deletedFact.predicate,
      summary: deletedFact.summary,
      value: deletedFact.valueJson,
    });
    const candidateCoreText = this.memoryCoreText({
      subject: candidate.subject,
      predicate: candidate.predicate,
      summary: candidate.summary,
      value: candidate.value,
    });

    return this.memoryClusterScore(deletedCoreText, candidateCoreText) >= 0.42;
  }

  private isSameMemoryCluster(left: MemoryFactRecord, right: MemoryFactRecord): boolean {
    if (left.scopeLevel !== right.scopeLevel) return false;
    if (memoryKindGroup(left.kind as MemoryCandidate['kind']) !== memoryKindGroup(right.kind as MemoryCandidate['kind'])) {
      return false;
    }

    const exactScore = this.memoryClusterScore(this.factText(left), this.factText(right));
    if (exactScore >= 0.46) {
      return true;
    }

    const leftCoreText = this.memoryCoreText({
      subject: left.subject,
      predicate: left.predicate,
      summary: left.summary,
      value: left.valueJson,
    });
    const rightCoreText = this.memoryCoreText({
      subject: right.subject,
      predicate: right.predicate,
      summary: right.summary,
      value: right.valueJson,
    });

    return this.memoryClusterScore(leftCoreText, rightCoreText) >= 0.42;
  }

  private factText(fact: MemoryFactRecord): string {
    return [
      fact.scopeLevel,
      fact.kind,
      fact.subject,
      fact.predicate,
      fact.summary,
      JSON.stringify(fact.valueJson ?? ''),
    ]
      .join(' ')
      .trim();
  }

  private memoryCoreText(input: {
    subject: unknown;
    predicate: unknown;
    summary: unknown;
    value: unknown;
  }): string {
    return [
      input.subject,
      input.predicate,
      input.summary,
      JSON.stringify(input.value ?? ''),
    ]
      .join(' ')
      .trim();
  }

  private memoryClusterScore(left: unknown, right: unknown): number {
    const jaccard = this.textSimilarity(left, right);
    const coverage = this.tokenCoverage(left, right);
    const denseCoverage = this.denseTokenCoverage(left, right);

    return Math.max(jaccard, coverage * 0.82, denseCoverage * 0.76);
  }

  private tokenCoverage(left: unknown, right: unknown): number {
    const leftTokens = this.tokens(left);
    const rightTokens = this.tokens(right);

    if (!leftTokens.length || !rightTokens.length) return 0;

    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);

    let intersection = 0;
    for (const token of leftSet) {
      if (rightSet.has(token)) intersection += 1;
    }

    return intersection / Math.min(leftSet.size, rightSet.size);
  }

  private denseTokenCoverage(left: unknown, right: unknown): number {
    const leftTokens = this.tokens(left).filter((token) => token.length >= 2);
    const rightTokens = this.tokens(right).filter((token) => token.length >= 2);

    if (!leftTokens.length || !rightTokens.length) return 0;

    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);

    let intersection = 0;
    for (const token of leftSet) {
      if (rightSet.has(token)) intersection += 1;
    }

    const shorter = Math.min(leftSet.size, rightSet.size);
    return shorter > 0 ? intersection / shorter : 0;
  }

  private filterPromotablePendingSimilar(
    pendingSimilar: MemoryFactRecord[],
    candidate: MemoryCandidate,
  ): MemoryFactRecord[] {
    return pendingSimilar.filter((pendingFact) =>
      this.isPromotionCompatible(pendingFact, candidate),
    );
  }

  private isPromotionCompatible(
    pendingFact: MemoryFactRecord,
    candidate: MemoryCandidate,
  ): boolean {
    if (!this.isSameCandidateFamily(pendingFact, candidate)) {
      return false;
    }

    if (this.hasMemoryPolarityConflict(this.factText(pendingFact), this.candidateText(candidate))) {
      return false;
    }

    const clusterScore = this.memoryClusterScore(this.factText(pendingFact), this.candidateText(candidate));
    if (clusterScore >= 0.46) {
      return true;
    }

    const pendingCoreText = this.memoryCoreText({
      subject: pendingFact.subject,
      predicate: pendingFact.predicate,
      summary: pendingFact.summary,
      value: pendingFact.valueJson,
    });
    const candidateCoreText = this.memoryCoreText({
      subject: candidate.subject,
      predicate: candidate.predicate,
      summary: candidate.summary,
      value: candidate.value,
    });

    return this.memoryClusterScore(pendingCoreText, candidateCoreText) >= 0.42;
  }

  private isSameCandidateFamily(
    fact: MemoryFactRecord,
    candidate: MemoryCandidate,
  ): boolean {
    if (fact.scopeLevel !== candidate.scopeLevel) return false;
    return memoryKindGroup(fact.kind as MemoryCandidate['kind']) === memoryKindGroup(candidate.kind);
  }

  private hasMemoryPolarityConflict(left: unknown, right: unknown): boolean {
    const leftText = this.normalizeForPolarity(left);
    const rightText = this.normalizeForPolarity(right);

    if (!leftText || !rightText) {
      return false;
    }

    const leftSignals = this.memoryPolaritySignals(leftText);
    const rightSignals = this.memoryPolaritySignals(rightText);

    if (!leftSignals.size || !rightSignals.size) {
      return false;
    }

    for (const signal of leftSignals) {
      if (rightSignals.has(signal)) {
        return false;
      }
    }

    return this.memoryClusterScore(left, right) >= 0.32;
  }

  private memoryPolaritySignals(text: string): Set<'complete_file' | 'diff_only' | 'fragment_only'> {
    const signals = new Set<'complete_file' | 'diff_only' | 'fragment_only'>();

    const wantsCompleteFile =
      this.containsAny(text, ['完整文件', '完整代码', '完整工程', '完整源码', '完整实现']) &&
      !this.containsAny(text, ['不要完整文件', '不需要完整文件', '不用完整文件', '不看完整文件']);

    const rejectsCompleteFile = this.containsAny(text, [
      '不要完整文件',
      '不需要完整文件',
      '不用完整文件',
      '不贴完整文件',
      '不再直接贴完整文件',
    ]);

    const wantsDiffOnly =
      this.containsAny(text, ['只给我关键diff', '只给关键diff', '关键diff', '只提供关键diff', '只给出关键diff']) ||
      (this.containsAny(text, ['diff']) && this.containsAny(text, ['只给', '只提供', '关键']));

    const rejectsFragment = this.containsAny(text, [
      '不喜欢demo',
      '不要demo',
      '不需要demo',
      '不喜欢零散示例',
      '不喜欢零散片段',
      '不丢零散片段',
      '不要零散片段',
    ]);

    if (wantsCompleteFile || rejectsFragment) {
      signals.add('complete_file');
    }

    if (wantsDiffOnly || rejectsCompleteFile) {
      signals.add('diff_only');
    }

    if (rejectsCompleteFile && !wantsDiffOnly) {
      signals.add('fragment_only');
    }

    return signals;
  }

  private containsAny(text: string, patterns: string[]): boolean {
    return patterns.some((pattern) => text.includes(pattern));
  }

  private normalizeForPolarity(value: unknown): string {
    return normalizeMemoryText(
      typeof value === 'string' ? value : JSON.stringify(value ?? ''),
    ).replace(/\s+/g, '');
  }

  private async tryPromotePendingCandidate(input: {
    namespace: MemoryNamespace;
    candidate: MemoryCandidate;
    pendingSimilar: MemoryFactRecord[];
    traceId: string | null;
    episodeId?: string | null;
  }): Promise<boolean> {
    for (const pendingFact of input.pendingSimilar) {
      this.logger.debug(
        `[MemoryPromotionProbe] trace=${input.traceId ?? '-'} episodeId=${input.episodeId ?? '-'} pendingMemoryId=${pendingFact.id} candidate=${this.formatCandidateForLog(input.candidate)} pendingFact=${this.formatSimilarForLog([pendingFact])}`,
      );
      const decision = this.promotion.decidePendingPromotion({
        pendingFact,
        incomingCandidate: input.candidate,
      });

      this.logger.debug(
        `[MemoryPromotionDecisionProbe] trace=${input.traceId ?? '-'} episodeId=${input.episodeId ?? '-'} pendingMemoryId=${pendingFact.id} shouldPromote=${decision.shouldPromote} reasonCode=${decision.reason} confidence=${decision.confidence}`,
      );

      await this.decisionAudit.promotionDecision({
        namespace: input.namespace,
        traceId: input.traceId,
        episodeId: input.episodeId ?? null,
        candidate: input.candidate,
        pendingFact,
        shouldPromote: decision.shouldPromote,
        reasonCode: decision.reason,
        confidence: decision.confidence,
      });

      if (!decision.shouldPromote) {
        continue;
      }

      const promoted = await this.repo.promoteFact({
        namespace: input.namespace,
        memoryId: pendingFact.id,
        reason: decision.reason ?? 'auto_promote',
        actor: 'memory-write-runtime',
        sourceFrameId: input.traceId,
      });

      await this.decisionAudit.promotionDecision({
        namespace: input.namespace,
        traceId: input.traceId,
        episodeId: input.episodeId ?? null,
        candidate: input.candidate,
        pendingFact,
        shouldPromote: true,
        reasonCode: decision.reason ?? 'auto_promote',
        confidence: decision.confidence,
        promotedMemoryId: promoted.id,
      });

      this.logger.log(
        `[MemoryPromote] trace=${input.traceId ?? '-'} memoryId=${promoted.id} reason=${decision.reason ?? 'auto_promote'} confidence=${decision.confidence}`,
      );

      return true;
    }

    return false;
  }

  private extractRecordId(record: unknown): string | null {
    if (!record || typeof record !== 'object') return null;
    const id = (record as { id?: unknown }).id;
    return typeof id === 'string' && id.trim() ? id : null;
  }

  private candidateAuditPayload(candidate: MemoryCandidate) {
    return {
      kind: candidate.kind,
      scopeLevel: candidate.scopeLevel,
      subject: candidate.subject,
      predicate: candidate.predicate,
      summary: candidate.summary,
      sensitivity: candidate.sensitivity,
      stability: candidate.stability,
      confidence: candidate.confidence,
      sourceHash: candidate.sourceHash ?? null,
    };
  }

  private isImplicitCandidateGroundedInUserTurn(
    frame: WriteMemoryInput['frame'],
    candidate: MemoryCandidate,
  ): boolean {
    if (frame.explicitness === 'explicit') {
      return true;
    }

    const userText = normalizeMemoryText(frame.userText ?? '');
    if (!userText) {
      return false;
    }

    const candidateText = this.candidateText(candidate);
    const supportScore = this.textSimilarity(userText, candidateText);

    if (supportScore >= 0.18) {
      return true;
    }

    const userTokens = new Set(this.tokens(userText));
    const candidateTokens = this.tokens(candidateText);
    const distinctiveTokens = candidateTokens.filter((token) =>
      this.isDistinctiveGroundingToken(token),
    );

    if (!userTokens.size || !distinctiveTokens.length) {
      return false;
    }

    const distinctiveHits = distinctiveTokens.filter((token) => userTokens.has(token)).length;
    const distinctiveRatio = distinctiveHits / distinctiveTokens.length;

    return distinctiveHits >= 3 && distinctiveRatio >= 0.22;
  }

  private isDistinctiveGroundingToken(token: string): boolean {
    const normalized = normalizeMemoryText(token);

    if (normalized.length < 3) {
      return false;
    }

    return !new Set([
      'user',
      '用户',
      '偏好',
      '要求',
      '习惯',
      '信息',
      '记忆',
      '代码',
      '回答',
      '输出',
      '实现',
      'prefers',
      'preference',
      'requires',
      'requirement',
      'memory',
      'remember',
      'forget',
      'summary',
      'value',
      'subject',
      'predicate',
    ]).has(normalized);
  }

  private normalizeCandidateScope(
    namespace: MemoryNamespace,
    candidate: MemoryCandidate,
  ): MemoryCandidate {
    if (candidate.scopeLevel === 'user') {
      return candidate;
    }

    if (candidate.scopeLevel === 'agent' && namespace.agentId) {
      return candidate;
    }

    if (candidate.scopeLevel === 'conversation' && namespace.conversationId) {
      return candidate;
    }

    if (candidate.scopeLevel === 'project' && namespace.projectId) {
      return candidate;
    }

    if (candidate.scopeLevel === 'group' && namespace.groupId) {
      return candidate;
    }

    if (candidate.scopeLevel === 'org' && namespace.orgId) {
      return candidate;
    }

    if (candidate.scopeLevel === 'plan' && namespace.planId) {
      return candidate;
    }

    return {
      ...candidate,
      scopeLevel: 'user',
    };
  }

  private collapseCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
    const collapsed: MemoryCandidate[] = [];

    for (const candidate of candidates) {
      const existingIndex = collapsed.findIndex((existing) =>
        this.shouldCollapse(existing, candidate),
      );

      if (existingIndex < 0) {
        collapsed.push(candidate);
        continue;
      }

      collapsed[existingIndex] = this.mergeCandidate(collapsed[existingIndex], candidate);
    }

    return collapsed;
  }

  private shouldCollapse(existing: MemoryCandidate, incoming: MemoryCandidate): boolean {
    if (existing.scopeLevel !== incoming.scopeLevel) return false;

    const existingGroup = memoryKindGroup(existing.kind);
    const incomingGroup = memoryKindGroup(incoming.kind);

    if (existingGroup !== incomingGroup) return false;

    const subjectScore = this.textSimilarity(existing.subject, incoming.subject);
    const predicateScore = this.textSimilarity(existing.predicate, incoming.predicate);
    const summaryScore = this.textSimilarity(existing.summary, incoming.summary);
    const valueScore = this.textSimilarity(existing.value, incoming.value);
    const fullScore = this.textSimilarity(this.candidateText(existing), this.candidateText(incoming));

    if (subjectScore >= 0.78 && predicateScore >= 0.72) return true;
    if (fullScore >= 0.58) return true;
    if (subjectScore >= 0.58 && summaryScore >= 0.55) return true;
    if (predicateScore >= 0.55 && valueScore >= 0.55) return true;

    return false;
  }

  private mergeCandidate(left: MemoryCandidate, right: MemoryCandidate): MemoryCandidate {
    const base = left.confidence >= right.confidence ? left : right;
    const other = base === left ? right : left;

    return {
      ...base,
      subject: this.pickRepresentativeText(base.subject, other.subject),
      predicate: this.pickRepresentativeText(base.predicate, other.predicate),
      summary: this.mergeText(base.summary, other.summary, 900),
      value: this.mergeValue(base.value, other.value),
      confidence: Math.max(left.confidence, right.confidence),
      stability: strongerMemoryStability(left.stability, right.stability),
      sensitivity: strongerMemorySensitivity(left.sensitivity, right.sensitivity),
      evidence: {
        ...base.evidence,
        quote: this.mergeNullableText(base.evidence.quote, other.evidence.quote, 1000),
      },
      tags: this.mergeTags(left.tags, right.tags),
      sourceHash: left.sourceHash ?? right.sourceHash ?? null,
    };
  }

  private pickRepresentativeText(left: string, right: string): string {
    const normalizedLeft = normalizeMemoryText(left);
    const normalizedRight = normalizeMemoryText(right);

    if (!normalizedLeft) return right;
    if (!normalizedRight) return left;

    if (normalizedLeft.includes(normalizedRight)) return left;
    if (normalizedRight.includes(normalizedLeft)) return right;

    return left.length >= right.length ? left : right;
  }

  private mergeText(left: string, right: string, maxLength: number): string {
    const normalizedLeft = normalizeMemoryText(left);
    const normalizedRight = normalizeMemoryText(right);

    if (!normalizedLeft) return right.slice(0, maxLength);
    if (!normalizedRight) return left.slice(0, maxLength);

    if (normalizedLeft.includes(normalizedRight)) return left.slice(0, maxLength);
    if (normalizedRight.includes(normalizedLeft)) return right.slice(0, maxLength);

    if (this.textSimilarity(left, right) >= 0.86) {
      return (left.length >= right.length ? left : right).slice(0, maxLength);
    }

    return `${left} ${right}`.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  private mergeNullableText(
    left: string | null | undefined,
    right: string | null | undefined,
    maxLength: number,
  ): string | null {
    const merged = this.mergeText(left ?? '', right ?? '', maxLength);
    return merged || null;
  }

  private mergeValue(left: unknown, right: unknown): unknown {
    const leftText = normalizeMemoryText(JSON.stringify(left ?? ''));
    const rightText = normalizeMemoryText(JSON.stringify(right ?? ''));

    if (!leftText) return right;
    if (!rightText) return left;

    if (leftText === rightText) return left;
    if (leftText.includes(rightText)) return left;
    if (rightText.includes(leftText)) return right;

    if (this.textSimilarity(left, right) >= 0.86) return left;

    return {
      items: uniqueMemoryJsonValues([left, right]),
    };
  }

  private mergeTags(left?: string[], right?: string[]): string[] {
    return Array.from(
      new Set([...(left ?? []), ...(right ?? [])].map((tag) => tag.trim()).filter(Boolean)),
    ).slice(0, 16);
  }

  private formatCandidatesForLog(candidates: MemoryCandidate[]): string {
    return JSON.stringify(candidates.slice(0, 12).map((candidate) => ({
      scopeLevel: candidate.scopeLevel,
      kind: candidate.kind,
      subject: candidate.subject,
      predicate: candidate.predicate,
      summary: candidate.summary,
      sensitivity: candidate.sensitivity,
      stability: candidate.stability,
      confidence: candidate.confidence,
      value: this.compactValue(candidate.value),
    })));
  }

  private formatCandidateForLog(candidate: MemoryCandidate): string {
    return JSON.stringify({
      scopeLevel: candidate.scopeLevel,
      kind: candidate.kind,
      subject: candidate.subject,
      predicate: candidate.predicate,
      summary: candidate.summary,
      value: this.compactValue(candidate.value),
      confidence: candidate.confidence,
    });
  }

  private formatSimilarForLog(
    similar: Array<{
      id: string;
      scopeLevel: string;
      kind: string;
      subject: string;
      predicate: string;
      summary: string;
      valueJson: unknown;
      confidence: number;
    }>,
  ): string {
    return JSON.stringify(
      similar.slice(0, 8).map((item) => ({
        id: item.id,
        scopeLevel: item.scopeLevel,
        kind: item.kind,
        subject: item.subject,
        predicate: item.predicate,
        summary: item.summary,
        value: this.compactValue(item.valueJson),
        confidence: item.confidence,
      })),
    );
  }

  private compactValue(value: unknown): unknown {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    if (!text) return null;
    return text.length > 240 ? `${text.slice(0, 240)}...` : value;
  }

  private candidateText(candidate: MemoryCandidate): string {
    return [
      candidate.scopeLevel,
      candidate.kind,
      candidate.subject,
      candidate.predicate,
      candidate.summary,
      JSON.stringify(candidate.value ?? ''),
      ...(candidate.tags ?? []),
    ]
      .join(' ')
      .trim();
  }

  private textSimilarity(left: unknown, right: unknown): number {
    return memoryTokenJaccard(this.tokens(left), this.tokens(right));
  }

  private tokens(value: unknown): string[] {
    const text = normalizeMemoryText(
      typeof value === 'string' ? value : JSON.stringify(value ?? ''),
    );
    return memoryLexicalTokens(text);
  }
}