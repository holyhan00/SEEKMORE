                                                                      

import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../../../prisma/prisma.service';
import { RuntimeFlowTraceLogger } from '../../common/trace/runtime-flow-trace.logger';
import type { RuntimeWorkspaceContext, RuntimeWorkspaceResolveInput } from './contracts/runtime-workspace.types';

@Injectable()
export class RuntimeWorkspaceResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {}

  async resolve(input: RuntimeWorkspaceResolveInput): Promise<RuntimeWorkspaceContext | null> {
    const workspaceId = String(input.workspaceId ?? '').trim();

    this.trace.event('workspace.resolve_start', {
      trace: input.traceId,
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      workspaceId: workspaceId || null,
    });

    if (!workspaceId) {
      this.trace.event('workspace.required', {
        trace: input.traceId,
        userId: input.userId,
        conversationId: input.conversationId,
        reasonCode: 'workspace:missing_workspace_id',
      });
      this.trace.event('workspace.resolve_done', {
        trace: input.traceId,
        userId: input.userId,
        conversationId: input.conversationId,
        workspaceId: null,
        resolved: false,
        reasonCodes: 'workspace:missing_workspace_id',
      });
      return null;
    }

    const fromDb = await this.resolveFromDb(input, workspaceId);
    if (fromDb) return this.done(input, workspaceId, fromDb, ['workspace:resolved_from_db']);

    this.trace.event('workspace.required', {
      trace: input.traceId,
      userId: input.userId,
      conversationId: input.conversationId,
      workspaceId,
      reasonCode: 'workspace:not_found_or_not_allowed',
    });
    this.trace.event('workspace.resolve_done', {
      trace: input.traceId,
      userId: input.userId,
      conversationId: input.conversationId,
      workspaceId,
      resolved: false,
      reasonCodes: 'workspace:not_found_or_not_allowed',
    });
    return null;
  }

  private done(
    input: RuntimeWorkspaceResolveInput,
    workspaceId: string,
    context: RuntimeWorkspaceContext,
    reasonCodes: string[],
  ): RuntimeWorkspaceContext {
    this.trace.event('workspace.resolve_done', {
      trace: input.traceId,
      userId: input.userId,
      conversationId: input.conversationId,
      workspaceId,
      rootPath: context.rootPath,
      displayName: context.displayName,
      trustLevel: context.trustLevel,
      writable: context.writable,
      resolved: true,
      reasonCodes: reasonCodes.join('|') || null,
    });
    return context;
  }

  private async resolveFromDb(input: RuntimeWorkspaceResolveInput, workspaceId: string): Promise<RuntimeWorkspaceContext | null> {
    try {
      const delegate = (this.prisma as any).runtimeWorkspace;
      if (!delegate?.findFirst) return null;
      const row = await delegate.findFirst({
        where: {
          userId: input.userId,
          deletedAt: null,
          OR: [
            { id: workspaceId },
            { workspaceKey: workspaceId },
            { workspaceKey: `${input.userId}:${workspaceId}` },
          ],
        },
      });
      const state = this.record(row?.stateJson);
      const rootPath = this.safeRealpath(String(state.rootPath ?? state.root ?? '').trim());
      if (!row || !rootPath) return null;
      return {
        workspaceId: String(row.id ?? workspaceId),
        rootPath,
        displayName: String(state.displayName ?? state.name ?? path.basename(rootPath) ?? workspaceId).trim() || workspaceId,
        trustLevel: this.trustLevel(state.trustLevel, 'restricted'),
        writable: state.writable !== false,
      };
    } catch (error) {
      this.trace.warn('workspace.resolve_db_failed', {
        trace: input.traceId,
        userId: input.userId,
        workspaceId,
        message: error instanceof Error ? error.message : 'database unavailable',
      });
      throw error;
    }
  }

  private safeRealpath(candidate: string): string | null {
    if (!candidate) return null;
    try {
      const resolved = path.resolve(candidate);
      const real = fs.realpathSync.native(resolved);
      const stat = fs.statSync(real);
      if (!stat.isDirectory()) return null;
      return real;
    } catch {
      return null;
    }
  }

  private trustLevel(value: unknown, fallback: RuntimeWorkspaceContext['trustLevel']): RuntimeWorkspaceContext['trustLevel'] {
    const text = String(value ?? '').trim();
    if (text === 'none' || text === 'local_dev' || text === 'trusted' || text === 'restricted') return text;
    return fallback;
  }

  private record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }
}
