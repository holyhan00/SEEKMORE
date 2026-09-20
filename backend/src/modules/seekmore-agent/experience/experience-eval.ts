import { stableStringify } from '../runtime/util/runtime.util';
import type { AgentExperienceEpisode } from './experience.types';
import { assessMutationEvidence } from '../runtime/verification/verification-evidence';

/** Hard success requires task-bound environment assertions from the harness. */
export interface EnvironmentCheck { name: string; source: 'test_process' | 'browser_evaluator' | 'artifact_check'; passed: boolean; evidenceRef: string }
export function evaluateExperience(episode: AgentExperienceEpisode, checks: EnvironmentCheck[] = []) {
  const actions = episode.toolActions;
  const failures = actions.filter((row) => row.result.status === 'failed');
  const observedIds = new Set(actions.map((row) => row.call.id));
  const dispatched = episode.events.filter((e) => e.kind === 'tools.dispatched').flatMap((e) => e.payload.toolCalls ?? []);
  const unknownDispatches = dispatched.filter((call) => !observedIds.has(call.id)).length;
  const fingerprints = actions.map((row) => `${row.call.name}:${stableStringify(row.call.arguments)}`);
  const decisions = episode.events.filter((e) => e.kind === 'model.decision');
  const contexts = episode.events.filter((e) => e.kind === 'context.resolved');
  const inputsSeen = new Set(contexts.flatMap((e) => e.payload.inputIds ?? []));
  const steering = episode.inputs.filter((row) => row.kind !== 'CONTEXT_INJECTION');
  const recoveries = failures.map((failed) => actions.find((next) => next.startedAt >= failed.finishedAt
    && next.call.id !== failed.call.id && next.call.name === failed.call.name
    && stableStringify(next.call.arguments) === stableStringify(failed.call.arguments))).filter(Boolean);
  const recovered = recoveries.filter((row) => row!.result.status === 'completed').length;
  const humanApprovals = episode.approvals?.filter((row) => row.decidedAt && row.decision).length ?? null;
  const evidence = assessMutationEvidence(actions);
  const eligibleChecks = checks.filter((check) => check.evidenceRef.trim());
  const hasUsage = (key: 'inputTokens' | 'outputTokens' | 'cachedInputTokens') => episode.usage?.[key] ?? null;
  return {
    goalOutcome: eligibleChecks.length ? eligibleChecks.every((check) => check.passed) ? 'passed' : 'failed' : 'unknown',
    ...evidence,
    unknownOutcomeCount: evidence.unknownOutcomeCount + unknownDispatches,
    toolCallCount: episode.availability.journal ? dispatched.length : null,
    toolFailureRate: actions.length ? failures.length / actions.length : null,
    duplicateToolRate: actions.length ? (actions.length - new Set(fingerprints).size) / actions.length : null,
    recoveryCount: recoveries.length,
    recoverySuccess: recoveries.length ? recovered / recoveries.length : null,
    steeringCount: steering.length,
    steeringContextCoverage: steering.length ? steering.filter((row) => inputsSeen.has(row.id)).length / steering.length : null,
    steeringAdherence: null, // Semantic compliance is not proved merely by receiving an input.
    modelCallCount: episode.availability.journal ? episode.events.filter((event) => event.kind === 'model.attempt.started').length : null,
    modelSamplingCount: episode.availability.journal ? contexts.length : null,
    successfulModelCallCount: decisions.length,
    inputTokens: hasUsage('inputTokens'), outputTokens: hasUsage('outputTokens'), cachedTokens: hasUsage('cachedInputTokens'),
    duration: episode.completedAt ? Date.parse(episode.completedAt) - Date.parse(episode.startedAt) : null,
    timeToFirstAction: actions.length ? Math.max(0, Math.min(...actions.map((row) => row.startedAt)) - Date.parse(episode.startedAt)) : null,
    timeToCompletion: episode.completedAt ? Date.parse(episode.completedAt) - Date.parse(episode.startedAt) : null,
    humanApprovalCount: humanApprovals,
    approvalRequestCount: episode.approvals?.length ?? null,
    humanInterventionCount: humanApprovals == null ? null : steering.length + humanApprovals,
    costs: null,
    checks: eligibleChecks,
  };
}
export type ExperienceEvaluation = ReturnType<typeof evaluateExperience>;
