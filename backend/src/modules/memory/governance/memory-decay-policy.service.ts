                                                                       
import { Injectable } from '@nestjs/common';
import type { MemoryRetrievalItem } from '../kernel/memory.types';

const DAY_MS = 86_400_000;

type MemoryDecayDeleteInput = {
  stability: string;
  usageCount: number;
  lastUsedAt?: Date | string | null;
  updatedAt: Date | string;
  now?: Date;
};

@Injectable()
export class MemoryDecayPolicy {
  score(item: MemoryRetrievalItem, now: Date = new Date()): number {
    const updatedAt = this.toTime(item.updatedAt);
    const lastUsedAt = item.lastUsedAt ? this.toTime(item.lastUsedAt) : updatedAt;
    const nowMs = now.getTime();

    const ageDays = this.daysBetween(nowMs, updatedAt);
    const unusedDays = this.daysBetween(nowMs, lastUsedAt);

    const confidenceWeight = this.clamp(item.confidence, 0, 1);
    const baseWeight = this.clamp(item.score, 0, 1);
    const usageWeight = this.usageWeight(item.usageCount);
    const recencyWeight = this.recencyWeight(unusedDays, item.stability);
    const stabilityWeight = this.stabilityWeight(item.stability);
    const stalePenalty = this.stalePenalty(unusedDays, ageDays, item.stability);

    return this.clamp(
      baseWeight * 0.45 +
        confidenceWeight * 0.25 +
        usageWeight * 0.15 +
        recencyWeight * 0.1 +
        stabilityWeight * 0.05 -
        stalePenalty,
      0,
      1,
    );
  }

  shouldAutoDelete(input: MemoryDecayDeleteInput): boolean {
    const now = input.now ?? new Date();
    const updatedAt = this.toTime(input.updatedAt);
    const lastUsedAt = input.lastUsedAt ? this.toTime(input.lastUsedAt) : updatedAt;
    const unusedDays = this.daysBetween(now.getTime(), lastUsedAt);

    if (input.stability === 'ephemeral') {
      return unusedDays >= 30;
    }

    if (input.stability === 'session') {
      return unusedDays >= 90 && input.usageCount <= 1;
    }

    return false;
  }

  staleReason(input: MemoryDecayDeleteInput): string | null {
    if (!this.shouldAutoDelete(input)) return null;

    if (input.stability === 'ephemeral') {
      return 'auto_decay_ephemeral_expired';
    }

    if (input.stability === 'session') {
      return 'auto_decay_session_expired';
    }

    return 'auto_decay_expired';
  }

  private usageWeight(usageCount: number): number {
    return this.clamp(Math.log1p(Math.max(0, usageCount)) / Math.log(20), 0, 1);
  }

  private recencyWeight(unusedDays: number, stability: string): number {
    const halfLife =
      stability === 'long_term'
        ? 180
        : stability === 'session'
          ? 45
          : 14;

    return this.clamp(1 / (1 + unusedDays / halfLife), 0, 1);
  }

  private stabilityWeight(stability: string): number {
    if (stability === 'long_term') return 1;
    if (stability === 'session') return 0.65;
    if (stability === 'ephemeral') return 0.35;
    return 0.5;
  }

  private stalePenalty(unusedDays: number, ageDays: number, stability: string): number {
    if (stability === 'long_term') {
      return this.clamp(unusedDays / 720, 0, 0.35);
    }

    if (stability === 'session') {
      return this.clamp(unusedDays / 180, 0, 0.6);
    }

    if (stability === 'ephemeral') {
      return this.clamp(Math.max(unusedDays, ageDays) / 60, 0, 0.75);
    }

    return this.clamp(unusedDays / 365, 0, 0.4);
  }

  private toTime(value: Date | string | null | undefined): number {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.getTime() : Date.now();
    }

    const time = new Date(String(value ?? '')).getTime();
    return Number.isFinite(time) ? time : Date.now();
  }

  private daysBetween(nowMs: number, pastMs: number): number {
    return Math.max(0, (nowMs - pastMs) / DAY_MS);
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(Math.max(value, min), max);
  }
}