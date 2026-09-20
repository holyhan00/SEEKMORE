import type {
  GrowTerminalEvent,
  GrowTurnEvidence,
} from '../domain/grow.types';

export interface GrowEvidencePort {
  loadTerminalEvidence(event: GrowTerminalEvent): Promise<GrowTurnEvidence | null>;
  loadRecentEvidence(input: {
    userId: string;
    agentId: string;
    conversationId: string;
    afterTurnId?: string | null;
    limit: number;
  }): Promise<GrowTurnEvidence[]>;
}
