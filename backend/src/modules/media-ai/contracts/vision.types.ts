export interface VisionAnalyzeRequest {
  userId: string;
  agentId: string;
  conversationId: string;
  objectIds: string[];
  instruction: string;
  traceId?: string;
  assistantMessageId?: string;
  signal?: AbortSignal;
}

export interface VisionAnalysisItem {
  objectIds: string[];
  summary: string;
  provider: string;
  model: string;
}

export interface VisionAnalysisResult {
  analysis: VisionAnalysisItem;
  objectObservations: Array<{ objectId: string; contentHash: string; versionNo: number }>;
}
