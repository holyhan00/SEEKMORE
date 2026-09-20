export interface WorldSection {
  readonly source: string;
  readonly revision: string;
  readonly observedAt: string | null;
  readonly freshness: 'current' | 'stale' | 'unknown';
  readonly status: 'observed' | 'unknown';
  readonly value: unknown;
}
export interface WorldSnapshot {
  readonly capturedAt: string;
  readonly revision: string;
  readonly sections: Readonly<Record<string, WorldSection>>;
}
