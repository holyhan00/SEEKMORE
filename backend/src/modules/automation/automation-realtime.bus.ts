import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { AutomationRealtimeEvent, AutomationSnapshot } from './automation.types';

@Injectable()
export class AutomationRealtimeBus {
  private readonly subject = new Subject<AutomationRealtimeEvent>();
  readonly events$ = this.subject.asObservable();

  changed(snapshot: AutomationSnapshot): void {
    this.subject.next({
      type: 'automation.changed',
      userId: snapshot.userId,
      conversationId: snapshot.conversationId,
      payload: { automation: snapshot },
    });
  }

  message(input: {
    userId: string;
    conversationId: string;
    message: Record<string, unknown>;
  }): void {
    this.subject.next({
      type: 'automation.message',
      userId: input.userId,
      conversationId: input.conversationId,
      payload: { message: input.message },
    });
  }

  hidden(input: {
    userId: string;
    conversationId: string;
    messageId: string;
  }): void {
    this.subject.next({
      type: 'automation.message.hidden',
      userId: input.userId,
      conversationId: input.conversationId,
      payload: { messageId: input.messageId },
    });
  }
}
