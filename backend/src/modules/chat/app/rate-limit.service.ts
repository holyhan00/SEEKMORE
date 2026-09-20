                                                    
import { Injectable } from '@nestjs/common';
import { RATE_LIMIT, MAX_CONCURRENT_STREAMS } from './chat.config';

type ClientRequestState = {
  count: number;
  lastReset: number;
  activeStreams: Set<string>;
};

@Injectable()
export class RateLimitService {
  private clientStates = new Map<string, ClientRequestState>();

  public enterStream(clientId: string, requestId: string) {
    const state = this.ensureState(clientId);
    state.activeStreams.add(requestId);
  }

  public leaveStream(clientId: string, requestId: string) {
    const state = this.clientStates.get(clientId);
    if (!state) return;
    state.activeStreams.delete(requestId);
    if (state.activeStreams.size === 0 && this.shouldGC(state)) {
      this.clientStates.delete(clientId);
    }
  }

  public checkRateLimit(clientId: string): boolean {
    const now = Date.now();
    const state = this.ensureState(clientId);

    if (now - state.lastReset > 1000) {
      state.count = 0;
      state.lastReset = now;
    }
    if (state.count >= RATE_LIMIT) return false;

    state.count += 1;
    return true;
  }

  public checkConcurrentStreams(clientId: string): boolean {
    const state = this.clientStates.get(clientId);
    return !state || state.activeStreams.size < MAX_CONCURRENT_STREAMS;
  }

  private ensureState(clientId: string): ClientRequestState {
    let st = this.clientStates.get(clientId);
    if (!st) {
      st = {
        count: 0,
        lastReset: Date.now(),
        activeStreams: new Set<string>(),
      };
      this.clientStates.set(clientId, st);
    }
    return st;
  }

  private shouldGC(state: ClientRequestState): boolean {
                            
    return true;
  }
}