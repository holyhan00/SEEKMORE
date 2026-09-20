export type AutomationStatusValue = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
export type AutomationRunStatusValue = 'PENDING' | 'RUNNING' | 'CANCELLING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
export type AutomationCancelActor = 'USER' | 'AGENT' | 'SYSTEM' | 'CONDITION';
export type AutomationRepeatUnit = 'minute' | 'hour' | 'day' | 'week';

export type AutomationTrigger =
  | {
      kind: 'once';
      runAt: string;
      timeZone?: string | null;
    }
  | {
      kind: 'interval';
      runAt?: string | null;
      every: number;
      unit: AutomationRepeatUnit;
      timeZone?: string | null;
    };

export interface AutomationDeliveryPolicy {
  mode: 'always' | 'on_completion';
}

export interface AutomationStopPolicy {
  expiresAt?: string | null;
  maxRuns?: number | null;
  completionCondition?: Record<string, unknown> | null;
  indefinite?: boolean;
}

export interface AutomationCreateInput {
  userId: string;
  conversationId: string;
  anchorMessageId?: string | null;
  title: string;
  instruction: string;
  trigger: AutomationTrigger;
  stopPolicy?: AutomationStopPolicy | null;
  deliveryPolicy?: AutomationDeliveryPolicy | null;
}

export interface AutomationUpdateInput {
  title?: string;
  instruction?: string;
  trigger?: AutomationTrigger;
  stopPolicy?: AutomationStopPolicy | null;
  deliveryPolicy?: AutomationDeliveryPolicy | null;
}

export interface AutomationCleanupResult {
  cancelledAutomationCount: number;
  runningTraceIds: string[];
}

export interface AutomationSnapshot {
  id: string;
  userId: string;
  agentId: string;
  conversationId: string;
  anchorMessageId: string | null;
  title: string;
  instruction: string;
  trigger: AutomationTrigger;
  stopPolicy: AutomationStopPolicy;
  deliveryPolicy: AutomationDeliveryPolicy;
  status: AutomationStatusValue;
  nextWakeAt: string | null;
  lastRunAt: string | null;
  expiresAt: string | null;
  runCount: number;
  completedAt: string | null;
  completionReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRealtimeEvent {
  type: 'automation.changed' | 'automation.message' | 'automation.message.hidden';
  userId: string;
  conversationId: string;
  payload: Record<string, unknown>;
}
