export interface GrowMemoryWriteInput {
  userId: string;
  agentId: string;
  statement: string;
  sourceReviewId: string;
  confidence: number;
}

export interface GrowMemoryPort {
  write(input: GrowMemoryWriteInput): Promise<{ memoryId: string }>;
}
