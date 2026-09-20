                                                                   
import { Injectable } from '@nestjs/common';
import type { WriteBackInput } from '../../memory/facade/memory.facade.types';
import { MemoryCommandClassifier } from './memory-command-classifier.service';

export type MemoryWriteFrameAdapterInput = {
  traceId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  userText?: string | null;
  assistantText?: string | null;
};

export type MemoryWriteFrameAdapterOutput = Omit<WriteBackInput, 'user' | 'scope'> | null;

@Injectable()
export class MemoryWriteFrameAdapter {
  constructor(private readonly commandClassifier: MemoryCommandClassifier) {}

  build(input: MemoryWriteFrameAdapterInput): MemoryWriteFrameAdapterOutput {
    const userText = this.normalize(input.userText);
    const assistantText = this.normalize(input.assistantText);

    if (!userText) return null;

    const command = this.commandClassifier.classify({ text: userText });

    return {
      traceId: input.traceId,
      intent: command.intent === 'forget' ? 'forget' : 'remember',
      explicitness: command.explicitness,
      userText,
      assistantText,
      source: {
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
      },
      confirmedCandidates: [],
    };
  }

  private normalize(value: unknown): string {
    return String(value ?? '').trim();
  }
}