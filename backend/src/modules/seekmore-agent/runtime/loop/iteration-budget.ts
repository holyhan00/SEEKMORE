export class IterationBudget {
  private modelCalls = 0;
  private toolCalls = 0;
  private graceUsed = false;

  constructor(
    readonly maximumModelCalls: number,
    readonly maximumToolCalls = Math.max(16, maximumModelCalls * 8),
  ) {}

  canCallModel(): boolean {
    return this.modelCalls < this.maximumModelCalls;
  }

  recordModelCall(): void {
    this.modelCalls += 1;
  }

  canExecuteTools(count: number): boolean {
    return this.toolCalls + count <= this.maximumToolCalls;
  }

  recordToolCalls(count: number): void {
    this.toolCalls += count;
  }

  takeGraceCall(): boolean {
    if (this.graceUsed) return false;
    this.graceUsed = true;
    return true;
  }

  restore(snapshot: Record<string, any>): void {
    this.modelCalls = Number(snapshot.modelCalls ?? 0);
    this.toolCalls = Number(snapshot.toolCalls ?? 0);
    this.graceUsed = Boolean(snapshot.graceUsed);
  }

  snapshot(): Record<string, number | boolean> {
    return {
      modelCalls: this.modelCalls,
      maximumModelCalls: this.maximumModelCalls,
      remainingModelCalls: Math.max(0, this.maximumModelCalls - this.modelCalls),
      toolCalls: this.toolCalls,
      maximumToolCalls: this.maximumToolCalls,
      graceUsed: this.graceUsed,
    };
  }
}
