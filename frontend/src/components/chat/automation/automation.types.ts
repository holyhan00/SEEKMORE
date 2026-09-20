export type AutomationStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
export type AutomationRepeatUnit = 'minute' | 'hour' | 'day' | 'week';

export interface AutomationDeliveryPolicy {
  mode: 'always' | 'on_completion';
}

export type AutomationTrigger =
  | { kind: 'once'; runAt: string }
  | { kind: 'interval'; runAt?: string | null; every: number; unit: AutomationRepeatUnit; timeZone?: string | null };

export interface AutomationStopPolicy {
  expiresAt?: string | null;
  maxRuns?: number | null;
  completionCondition?: Record<string, unknown> | null;
  indefinite?: boolean;
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
  status: AutomationStatus;
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

export interface AutomationUpdatePayload {
  title?: string;
  instruction?: string;
  trigger?: AutomationTrigger;
  stopPolicy?: AutomationStopPolicy | null;
  deliveryPolicy?: AutomationDeliveryPolicy | null;
}
