export interface CancelableTurnResource {
  resourceId: string;
  kind: string;
  cancel(reason: string): void | Promise<void>;
}
