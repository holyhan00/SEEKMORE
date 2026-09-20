import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { RuntimeConversationSettingsSnapshot } from './runtime-access-policy.types';

export interface RuntimeAccessPolicyChangedEvent {
  type: 'runtime.settings.updated';
  userId: string;
  conversationId: string;
  settings: RuntimeConversationSettingsSnapshot;
  changedFields: Array<'workspaceId' | 'permissionMode'>;
  occurredAt: string;
}

@Injectable()
export class RuntimeAccessPolicyEvents implements OnModuleDestroy {
  private readonly subject = new Subject<RuntimeAccessPolicyChangedEvent>();
  readonly events$: Observable<RuntimeAccessPolicyChangedEvent> = this.subject.asObservable();

  publish(event: RuntimeAccessPolicyChangedEvent): void {
    this.subject.next(event);
  }

  onModuleDestroy(): void {
    this.subject.complete();
  }
}
