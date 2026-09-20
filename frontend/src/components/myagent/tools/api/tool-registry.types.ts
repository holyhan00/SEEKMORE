export interface ToolRegistryItem {
  name: string;
  version?: string;
  enabled: boolean;
  systemEnabled?: boolean;
  concurrency: number;
  active: number;
  queued: number;
  timeoutMs?: number;
  tags?: string[];
  sideEffectClass?: string;
  requiresApproval?: boolean;
}

export interface ToolRegistryResponse {
  ok: boolean;
  userId: string;
  count: number;
  tools: ToolRegistryItem[];
  executionEndpoint: string | null;
  message?: string;
}
