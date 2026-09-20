export class WorkflowScopeQueryDto {
  agentId!: string;
  conversationId!: string;
}

export class WorkflowActiveQueryDto extends WorkflowScopeQueryDto {}

export class WorkflowEventsQueryDto extends WorkflowScopeQueryDto {
  afterSequence?: string;
}

export class WorkflowCancelDto {
  agentId!: string;
  conversationId!: string;
  reason?: string;
}

export class WorkflowContinuationModeDto {
  agentId!: string;
  conversationId!: string;
  mode!: 'MANUAL' | 'AUTO';
}
