import type {
  GrowFocusContext,
  GrowFocusResult,
} from '../domain/grow.types';

export interface GrowFocusAgentPort {
  run(input: {
    context: GrowFocusContext;
    systemPrompt: string;
    toolNames: string[];
    maxIterations: number;
    tokenBudget: number;
    timeoutMs: number;
  }): Promise<GrowFocusResult>;
}
