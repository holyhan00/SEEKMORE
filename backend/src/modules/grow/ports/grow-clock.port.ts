export interface GrowClockPort {
  now(): Date;
}

export class SystemGrowClock implements GrowClockPort {
  now(): Date {
    return new Date();
  }
}
