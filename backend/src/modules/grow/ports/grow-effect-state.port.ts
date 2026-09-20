import type { GrowEffectObservation } from '../domain/grow.types';

export interface GrowEffectStatePort {
  register(observation: GrowEffectObservation): Promise<void>;
  get(skillId: string, versionId: string): Promise<GrowEffectObservation | null>;
  save(observation: GrowEffectObservation): Promise<void>;
  hasProcessedEvent(eventId: string): Promise<boolean>;
  markProcessedEvent(eventId: string): Promise<void>;
}
