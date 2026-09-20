import type { AgentToolExecutionRecord } from '../../contracts/agent-tool.types';

/** Target and hash equality prove a file state observation, not semantic task success. */
export function assessMutationEvidence(records: AgentToolExecutionRecord[]) {
  const mutations = records.filter((row) => row.result.status === 'completed' &&
    ['workspace_write', 'irreversible_write', 'external_effect'].includes(row.sideEffectClass ?? ''));
  const covered = mutations.filter((mutation) => {
    if (mutation.result.status !== 'completed') return false;
    const expected = mutation.result.evidence;
    if (!expected?.target || !expected.contentHash) return false;
    return records.some((check) => check.startedAt >= mutation.finishedAt && check.call.id !== mutation.call.id
      && ['file.read', 'repository.read_file'].includes(check.canonicalName ?? '')
      && check.result.status === 'completed' && check.result.evidence?.target === expected.target
      && check.result.evidence?.contentHash === expected.contentHash);
  });
  const unknownExecutions = records.filter((row) => {
    const result = row.result;
    if (row.sideEffectClass !== 'process_execution' || result.status === 'requires_confirmation') return false;
    if (result.status !== 'completed') return true;
    if (result.evidence?.exitCode != null && result.evidence.running !== true) return false;
    const sessionId = result.evidence?.sessionId;
    return !sessionId || !records.some((later) => later.startedAt >= row.finishedAt && later.call.id !== row.call.id
      && later.canonicalName === 'terminal.read' && later.result.status === 'completed'
      && later.result.evidence?.sessionId === sessionId
      && later.result.evidence?.running === false && later.result.evidence?.exitCode != null);
  });
  const coveredIds = new Set(covered.map((row) => row.call.id));
  const unresolved = mutations.filter((row) => !coveredIds.has(row.call.id)).map((row) => ({
    toolCallId: row.call.id,
    target: row.result.status === 'completed' ? row.result.evidence?.target ?? 'unknown' : 'unknown',
    observedAt: new Date(row.finishedAt).toISOString(),
  }));
  return { unresolved, mutationCount: mutations.length, verifiedMutationCount: covered.length,
    unverifiedMutationCount: mutations.length - covered.length, unknownOutcomeCount: unknownExecutions.length,
    completionEvidenceCoverage: mutations.length ? covered.length / mutations.length : null };
}
