import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { ChatTurnDeliveryEnvelope, ChatTurnDeliveryType } from './chat-turn-request.types';

@Injectable()
export class ChatTurnDeliveryBus {
  private readonly subject = new Subject<ChatTurnDeliveryEnvelope>();
  private sequence = BigInt(Date.now()) * 1000n;
  readonly events$ = this.subject.asObservable();

  currentSequence(): string {
    return this.sequence.toString();
  }

  publish<T>(input: {
    type: ChatTurnDeliveryType;
    userId: string;
    conversationId: string;
    requestId: string;
    traceId?: string | null;
    payload: T;
  }): ChatTurnDeliveryEnvelope<T> {
    this.sequence += 1n;
    const envelope: ChatTurnDeliveryEnvelope<T> = {
      ...input,
      traceId: input.traceId ?? null,
      eventSequence: this.sequence.toString(),
      occurredAt: new Date().toISOString(),
    };
    this.subject.next(envelope);
    return envelope;
  }
}
