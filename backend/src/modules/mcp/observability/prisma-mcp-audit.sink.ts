import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { McpAuditEvent } from '../domain/mcp-runtime.types';
import type { SeekmorePrismaClientLike } from '../prisma/prisma-client.types';
import { McpSecretRedactorService } from '../security/mcp-secret-redactor.service';
import { McpAuditSink } from './mcp-audit.sink';

@Injectable()
export class PrismaMcpAuditSink implements McpAuditSink {
  private readonly logger = new Logger(PrismaMcpAuditSink.name);
  private readonly db: SeekmorePrismaClientLike;

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    private readonly redactor: McpSecretRedactorService,
  ) {
    this.db = prisma as unknown as SeekmorePrismaClientLike;
  }

  async write(event: McpAuditEvent): Promise<void> {
    try {
      await this.db.mcpAuditLog.create({
        data: {
          eventType: event.eventType,
          serverId: event.serverId,
          runtimeToolId: event.runtimeToolId,
          tenantId: event.tenantId,
          userId: event.userId,
          agentId: event.agentId,
          traceId: event.traceId,
          severity: event.severity,
          code: event.code,
          message: event.message,
          metadata: this.redactor.redactJson(event.metadata ?? {}),
          occurredAt: event.occurredAt,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to persist MCP audit event: ${event.eventType}`);
      this.logger.debug(error instanceof Error ? error.stack : String(error));
    }
  }
}
