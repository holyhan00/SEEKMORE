import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TurnResourceRegistry } from '../../runtime-cancellation/turn-resource.registry';
import type { WorkflowConversationScope } from '../persistence/workflow-run.repository';
import { RedisWorkflowSchedulerService } from '../scheduling/redis-workflow-scheduler.service';

export interface WorkflowConversationCleanupResult {
  workflowIds: string[];
  phaseIdsByWorkflow: Record<string, string[]>;
  runningTraceIds: string[];
  pausedWorkflowCount: number;
  blockedTurnCount: number;
  cancelledApprovalCount: number;
  disabledMemoryCount: number;
}

@Injectable()
export class WorkflowConversationCleanupService {
  constructor(
    private readonly resources: TurnResourceRegistry,
    private readonly scheduler: RedisWorkflowSchedulerService,
  ) {}

     
                          
                                       
                                      
     
  async deleteInTransaction(
    tx: Prisma.TransactionClient,
    scope: WorkflowConversationScope,
    recycledAt = new Date(),
  ): Promise<WorkflowConversationCleanupResult> {
    const db = tx as any;
    const runs = await db.workflowRun.findMany({
      where: {
        userId: scope.userId,
        agentId: scope.agentId,
        conversationId: scope.conversationId,
      },
      select: {
        id: true,
        status: true,
        continuationMode: true,
        contractJson: true,
        phases: { select: { id: true } },
        turnLinks: { select: { traceId: true } },
      },
    });

    const workflowIds = runs.map((run: any) => String(run.id));
    const phaseIdsByWorkflow = Object.fromEntries(
      runs.map((run: any) => [
        String(run.id),
        run.phases.map((phase: any) => String(phase.id)),
      ]),
    );

    let pausedWorkflowCount = 0;
    for (const run of runs) {
      if (!['RUNNING', 'WAITING', 'BLOCKED'].includes(String(run.status))) continue;
      const contract = this.record(run.contractJson);
      const metadata = this.record(contract.metadata);
      const updated = await db.workflowRun.updateMany({
        where: {
          id: run.id,
          status: { in: ['RUNNING', 'WAITING', 'BLOCKED'] },
        },
        data: {
          status: String(run.status) === 'RUNNING' ? 'WAITING' : run.status,
          ...(String(run.status) === 'RUNNING'
            ? { waitReason: 'CONTINUATION' }
            : {}),
          continuationMode: 'MANUAL',
          leaseOwner: null,
          leaseExpiresAt: null,
          contractJson: {
            ...contract,
            metadata: {
              ...metadata,
              conversationRecycle: {
                previousStatus: run.status,
                previousContinuationMode: run.continuationMode,
                recycledAt: recycledAt.toISOString(),
              },
            },
          },
          version: { increment: 1 },
        },
      });
      pausedWorkflowCount += Number(updated.count ?? 0);
    }

    if (workflowIds.length > 0) {
                                    
      await db.runtimeEventOutbox.deleteMany({
        where: {
          aggregateType: 'seekmore_workflow',
          aggregateId: { in: workflowIds },
        },
      });
    }

    const activeRequests = await db.chatTurnRequest.findMany({
      where: {
        conversationId: scope.conversationId,
        status: {
          in: [
            'STARTING',
            'RUNNING',
            'WAITING_APPROVAL',
            'WAITING_EXTERNAL',
            'CANCELLING',
          ],
        },
      },
      select: { traceId: true },
    });

    const blockedTurns = await db.chatTurnRequest.updateMany({
      where: {
        conversationId: scope.conversationId,
        status: 'QUEUED',
      },
      data: {
        status: 'BLOCKED',
        failureCode: 'CONVERSATION_RECYCLED',
        failureMessage: 'Conversation was moved to the recycle bin before this turn started',
        completedAt: recycledAt,
        version: { increment: 1 },
      },
    });

    await db.chatTurnRequest.updateMany({
      where: {
        conversationId: scope.conversationId,
        status: {
          in: ['STARTING', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_EXTERNAL'],
        },
      },
      data: {
        status: 'CANCELLING',
        cleanupStatus: 'PENDING',
        cancelReason: 'conversation_recycled',
        cancelRequestedAt: recycledAt,
        cleanupRequestedAt: recycledAt,
        version: { increment: 1 },
      },
    });

    const cancelledApprovals = await db.agentApproval.updateMany({
      where: {
        conversationId: scope.conversationId,
        status: 'pending',
      },
      data: {
        status: 'cancelled',
        errorJson: {
          code: 'CONVERSATION_RECYCLED',
          message: 'Conversation was moved to the recycle bin',
        },
      },
    });

                                           
                                                         
                                
    const disabledMemory = await db.memoryFact.updateMany({
      where: {
        userId: scope.userId,
        status: 'active',
        OR: [
          { conversationId: scope.conversationId },
          { sourceConversationId: scope.conversationId },
        ],
      },
      data: {
        status: 'deleted',
        validTo: recycledAt,
      },
    });

    const workflowTraceIds = runs.flatMap((run: any) =>
      run.turnLinks.map((link: any) => String(link.traceId ?? '').trim()),
    );
    const requestTraceIds = activeRequests.map((row: any) =>
      String(row.traceId ?? '').trim(),
    );
    const traceIds = [...new Set([...workflowTraceIds, ...requestTraceIds].filter(Boolean))];

    const activeTurns = traceIds.length
      ? await db.agentTurn.findMany({
          where: {
            traceId: { in: traceIds },
            status: 'running',
          },
          select: { traceId: true },
        })
      : [];

    return {
      workflowIds,
      phaseIdsByWorkflow,
      runningTraceIds: activeTurns.map((turn: any) => String(turn.traceId)),
      pausedWorkflowCount,
      blockedTurnCount: Number(blockedTurns.count ?? 0),
      cancelledApprovalCount: Number(cancelledApprovals.count ?? 0),
      disabledMemoryCount: Number(disabledMemory.count ?? 0),
    };
  }

  async finalizeCleanup(result: WorkflowConversationCleanupResult): Promise<void> {
    await Promise.allSettled(
      result.runningTraceIds.map((traceId) =>
        this.resources.cancelTrace(traceId, 'conversation_deleted'),
      ),
    );
    await Promise.allSettled(
      result.workflowIds.map((workflowId) =>
        this.scheduler.remove(
          workflowId,
          result.phaseIdsByWorkflow[workflowId] ?? [],
        ),
      ),
    );
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
