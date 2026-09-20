import type { McpAuditEvent } from '../domain/mcp-runtime.types';

export interface McpAuditSink {
  write(event: McpAuditEvent): Promise<void>;
}
