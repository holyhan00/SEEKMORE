import { Injectable } from '@nestjs/common';
import type { AgentRuntimeMessage, AgentRuntimeToolDefinition } from '../../contracts/agent-turn.types';
import { stableStringify } from '../util/runtime.util';

@Injectable()
export class TokenEstimatorService {
  messages(messages: AgentRuntimeMessage[], tools: AgentRuntimeToolDefinition[] = []): number {
    let characters = 0;
    let mediaTokens = 0;
    for (const message of messages) {
      const content = Array.isArray(message.content) ? message.content.map((part) => {
        if (part.type === 'image') { mediaTokens += 4096; return { type: 'image', objectId: part.objectId }; }
        return part;
      }) : message.content;
      characters += 16 + message.role.length + stableStringify(content).length;
      characters += stableStringify(message.toolCalls ?? []).length;
    }
    characters += stableStringify(tools).length;
    return Math.ceil(characters / 3) + mediaTokens;
  }
}
