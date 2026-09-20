import { Injectable } from '@nestjs/common';
import type { AgentToolExecutionRecord } from '../../contracts/agent-tool.types';
import { assessMutationEvidence } from './verification-evidence';

@Injectable()
export class VerificationStopService {
  observe(records: AgentToolExecutionRecord[], _workspaceRoot?: string | null) {
    const assessment = assessMutationEvidence(records);
    return { mutated: assessment.mutationCount > 0, verified: assessment.mutationCount > 0 && assessment.unverifiedMutationCount === 0,
      unknownExecution: assessment.unknownOutcomeCount > 0 };
  }
  needsVerification(input: { lastMutationIteration: number | null; lastVerificationIteration: number | null; alreadyNudged: boolean }) {
    return !input.alreadyNudged && input.lastMutationIteration != null
      && (input.lastVerificationIteration == null || input.lastVerificationIteration < input.lastMutationIteration);
  }
  nudge(): string {
    return 'Persistent changes still lack a later observation of the same target. Verify changed targets; report unknown outcomes explicitly when verification is unavailable.';
  }
}
