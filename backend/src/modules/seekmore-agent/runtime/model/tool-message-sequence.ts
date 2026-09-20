import type {
  AgentRuntimeMessage,
  AgentRuntimeToolCall,
} from '../../contracts/agent-turn.types';
import { contentText } from './model-content.util';

export interface ToolMessageSequenceRepairResult {
  messages: AgentRuntimeMessage[];
  repaired: boolean;
  orphanToolMessages: number;
  incompleteToolCallGroups: number;
  duplicateToolResponses: number;
  unmatchedToolResponses: number;
}

export interface ProtocolSafeTailWindow {
  start: number;
  messages: AgentRuntimeMessage[];
}

   
                                                                              
                                                                            
                                                                              
                              
   
export function protocolSafeTailWindow(
  messages: AgentRuntimeMessage[],
  desiredCount: number,
): ProtocolSafeTailWindow {
  if (!messages.length) {
    return { start: 0, messages: [] };
  }

  let start = Math.max(0, messages.length - Math.max(1, desiredCount));

  while (start > 0 && messages[start]?.role === 'tool') {
    start -= 1;
  }

  return {
    start,
    messages: messages.slice(start),
  };
}

   
                                                                           
                                                                        
                                                                          
                                                                            
                                
   
export function repairToolMessageSequence(
  messages: AgentRuntimeMessage[],
): ToolMessageSequenceRepairResult {
  const output: AgentRuntimeMessage[] = [];
  let orphanToolMessages = 0;
  let incompleteToolCallGroups = 0;
  let duplicateToolResponses = 0;
  let unmatchedToolResponses = 0;

  for (let index = 0; index < messages.length;) {
    const message = messages[index];

    if (
      message.role === 'assistant'
      && Array.isArray(message.toolCalls)
      && message.toolCalls.length > 0
    ) {
      const toolMessages: AgentRuntimeMessage[] = [];
      let cursor = index + 1;

      while (
        cursor < messages.length
        && messages[cursor]?.role === 'tool'
      ) {
        toolMessages.push(messages[cursor]);
        cursor += 1;
      }

      const expected = uniqueToolCalls(message.toolCalls);
      const expectedIds = new Set(expected.map((call) => call.id));
      const seen = new Set<string>();
      const validResults: AgentRuntimeMessage[] = [];
      const invalidResults: AgentRuntimeMessage[] = [];

      for (const toolMessage of toolMessages) {
        const toolCallId = String(toolMessage.toolCallId ?? '').trim();

        if (!toolCallId || !expectedIds.has(toolCallId)) {
          unmatchedToolResponses += 1;
          invalidResults.push(toolMessage);
          continue;
        }

        if (seen.has(toolCallId)) {
          duplicateToolResponses += 1;
          invalidResults.push(toolMessage);
          continue;
        }

        seen.add(toolCallId);
        validResults.push(toolMessage);
      }

      const complete = expected.length > 0
        && expected.every((call) => seen.has(call.id));

      if (complete) {
        output.push({
          ...message,
          toolCalls: expected,
        });
        output.push(...validResults);

        for (const invalidResult of invalidResults) {
          output.push(historicalToolObservation(invalidResult));
        }
      } else {
        incompleteToolCallGroups += 1;

        const assistantContent = contentText(message.content).trim();
        if (assistantContent) {
          output.push({
            ...message,
            toolCalls: [],
          });
        }

        for (const toolMessage of toolMessages) {
          output.push(historicalToolObservation(toolMessage));
        }
      }

      index = cursor;
      continue;
    }

    if (message.role === 'tool') {
      orphanToolMessages += 1;
      output.push(historicalToolObservation(message));
      index += 1;
      continue;
    }

    output.push(message);
    index += 1;
  }

  const repaired = orphanToolMessages > 0
    || incompleteToolCallGroups > 0
    || duplicateToolResponses > 0
    || unmatchedToolResponses > 0;

  return {
    messages: output,
    repaired,
    orphanToolMessages,
    incompleteToolCallGroups,
    duplicateToolResponses,
    unmatchedToolResponses,
  };
}

function uniqueToolCalls(
  calls: AgentRuntimeToolCall[],
): AgentRuntimeToolCall[] {
  const seen = new Set<string>();
  const output: AgentRuntimeToolCall[] = [];

  for (const call of calls) {
    const id = String(call.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push(call);
  }

  return output;
}

function historicalToolObservation(
  message: AgentRuntimeMessage,
): AgentRuntimeMessage {
  const name = String(message.name ?? 'tool').trim() || 'tool';
  const toolCallId = String(message.toolCallId ?? '').trim();
  const content = contentText(message.content).trim();

  return {
    role: 'system',
    content: [
      `[Historical tool observation: ${name}]`,
      toolCallId ? `toolCallId: ${toolCallId}` : '',
      content,
    ].filter(Boolean).join('\n'),
  };
}

export interface ToolProtocolHistoryDowngradeResult {
  messages: AgentRuntimeMessage[];
  changed: boolean;
  assistantToolCallMessages: number;
  toolMessages: number;
}

   
                                                                          
                                                                       
                                                                     
                                                                          
                                   
   
export function downgradeToolProtocolHistory(
  messages: AgentRuntimeMessage[],
): ToolProtocolHistoryDowngradeResult {
  const output: AgentRuntimeMessage[] = [];
  let assistantToolCallMessages = 0;
  let toolMessages = 0;

  for (const message of messages) {
    if (
      message.role === 'assistant'
      && Array.isArray(message.toolCalls)
      && message.toolCalls.length > 0
    ) {
      assistantToolCallMessages += 1;
      const assistantContent = contentText(message.content).trim();
      if (assistantContent) {
        output.push({
          ...message,
          toolCalls: [],
        });
      }

      output.push({
        role: 'system',
        content: [
          '[Historical tool requests]',
          ...message.toolCalls.map((call) => {
            const name = String(call.name ?? 'tool').trim() || 'tool';
            const id = String(call.id ?? '').trim();
            return id ? `${name} (${id})` : name;
          }),
        ].join('\n'),
      });
      continue;
    }

    if (message.role === 'tool') {
      toolMessages += 1;
      output.push(historicalToolObservation(message));
      continue;
    }

    output.push(message);
  }

  return {
    messages: output,
    changed: assistantToolCallMessages > 0 || toolMessages > 0,
    assistantToolCallMessages,
    toolMessages,
  };
}
