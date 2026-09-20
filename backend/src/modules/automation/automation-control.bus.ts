import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface AutomationCancelRequest {
  traceIds: string[];
  reason: string;
}

@Injectable()
export class AutomationControlBus {
  private readonly subject = new Subject<AutomationCancelRequest>();
  readonly cancelRequests$ = this.subject.asObservable();

  requestCancel(traceIds: string[], reason: string): void {
    const normalized = [...new Set(traceIds.map((value) => String(value ?? '').trim()).filter(Boolean))];
    if (!normalized.length) return;
    this.subject.next({ traceIds: normalized, reason });
  }
}
