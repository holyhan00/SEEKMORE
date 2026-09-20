import { Injectable } from '@nestjs/common';
import type { ResolvedUserLlmConfig } from '../../llm-settings/contracts/llm-settings.types';
import type { AgentAttachedObject } from '../../seekmore-agent/contracts/agent-turn.types';
import { RuntimeCapabilityContextBuilder } from './runtime-capability-context.builder';

@Injectable()
export class MediaTurnPreparationService {
  constructor(
    private readonly capabilities: RuntimeCapabilityContextBuilder,
  ) {}

  async prepare(input: {
    traceId: string;
    assistantMessageId: string;
    userId: string;
    agentId: string;
    conversationId: string;
    userInput: string;
    primary: ResolvedUserLlmConfig;
    attachedObjects: AgentAttachedObject[];
    workflowActive: boolean;
    signal?: AbortSignal;
  }) {
    const capability = await this.capabilities.build({
      userId: input.userId,
      primary: input.primary,
      workflowActive: input.workflowActive,
    });

    return {
      attachedObjects: input.attachedObjects,
      capabilityContext: capability.context,
      disabledToolNames: capability.disabledToolNames,
    };
  }
}
