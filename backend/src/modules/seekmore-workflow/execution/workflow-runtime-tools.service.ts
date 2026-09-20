import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ToolsRegistry } from '../../../tools/toolsregistry';
import { ToolError, type Dict, type Tool, type ToolContext } from '../../../tools/toolstypes';
import type { AgentPermissionMode } from '../../seekmore-agent/contracts/agent-turn.types';
import { WorkflowManagerService } from '../application/workflow-manager.service';
import { WorkflowQueryService } from '../application/workflow-query.service';
import type {
  WorkflowBlockInput,
  WorkflowCompleteInput,
  WorkflowControlInput,
  WorkflowStartInput,
  WorkflowUpdateInput,
} from '../contracts/workflow-lifecycle.types';

@Injectable()
export class WorkflowRuntimeToolsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolsRegistry,
    private readonly manager: WorkflowManagerService,
    private readonly query: WorkflowQueryService,
  ) {}

  onModuleInit(): void {
    for (const tool of this.tools()) {
      this.registry.register(tool, {
        enabled: true,
        concurrency: 8,
        defaultTimeoutMs: 60_000,
      });
    }
  }

  private tools(): Tool[] {
    return [
      this.tool(
        'workflow.start',
        'Create a durable Workflow around this same AgentLoop. Submit the long-term goal and the real durable phases now. Phases guide work across turns.',
        startSchema,
        'continue',
        (args, ctx) => this.start(args as unknown as WorkflowStartInput, ctx),
      ),
      this.tool(
        'workflow.update',
        'Save a durable Workflow checkpoint without ending the current turn. Use it as soon as real progress, goal/constraints, phase structure, current phase, or already-completed phases materially change. Continue working after the checkpoint.',
        updateSchema,
        'continue',
        (args, ctx) => this.update(args as unknown as WorkflowUpdateInput, ctx),
      ),
      this.tool(
        'workflow.complete',
        'Mark the currently active durable phase complete only after its work and verification are finished. A successful call ends the current turn. The scheduler may start the next phase in a new turn when AUTO continuation is enabled.',
        completeSchema,
        'finish_on_success',
        (args, ctx) => this.complete(args as unknown as WorkflowCompleteInput, ctx),
      ),
      this.tool(
        'workflow.block',
        'Record a real blocker for the currently active durable phase. Use only for user input, an external dependency, a resource conflict, or an unrecoverable failure. A successful call ends the current turn and does not auto-continue.',
        blockSchema,
        'finish_on_success',
        (args, ctx) => this.block(args as unknown as WorkflowBlockInput, ctx),
      ),
      this.tool(
        'workflow.control',
        'Resume, pause, cancel, or change AUTO/MANUAL continuation for the active Workflow. A successful control call ends the current turn. On a normal USER turn, process the user request directly instead of using RESUME merely to hand work to a background turn.',
        controlSchema,
        'finish_on_success',
        (args, ctx) => this.control(args as unknown as WorkflowControlInput, ctx),
      ),
    ];
  }

  private tool(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    turnBehavior: 'continue' | 'finish_on_success',
    execute: (args: Dict, ctx: ToolContext) => Promise<unknown>,
  ): Tool {
    return {
      name,
      version: '2.0.0',
      runtimeOnly: true,
      description,
      displayName: name,
      tags: ['workflow', 'runtime-only'],
      providerKind: 'internal',
      sideEffectClass: 'irreversible_write',
      riskLevel: 'medium',
      parallelism: 'resource_serial',
      batchBehavior: 'exclusive',
      turnBehavior,
      presentation: 'workflow',
      conflictKeyFields: ['conversationId'],
      supportsAbort: true,
      requiresApproval: false,
      idempotency: 'optional',
      inputSchema,
      outputSchema: { type: 'object', additionalProperties: true },
      execute,
    };
  }

  private async start(input: WorkflowStartInput, ctx: ToolContext): Promise<unknown> {
    const message = await this.requireUserMessage(ctx);
    const scope = {
      userId: ctx.userId,
      agentId: this.requireAgentId(ctx),
      conversationId: ctx.conversationId,
    };
    const started = await this.manager.start({
      ...input,
      scope,
      branchId: message.branchId ?? null,
      workspaceId: this.metadataText(ctx, 'workspaceId'),
      initialUserMessageId: message.id,
      inputObjectIds: [],
      permissionMode: this.permissionMode(ctx),
      traceId: this.requireTrace(ctx),
      assistantMessageId: ctx.assistantMessageId ?? this.metadataText(ctx, 'assistantMessageId'),
    });
    return {
      created: started.created,
      message: started.created
        ? 'Workflow and durable phases created. Continue using the current phase as direction.'
        : 'An active Workflow already exists for this conversation.',
      workflow: this.compact(started),
    };
  }

  private async update(input: WorkflowUpdateInput, ctx: ToolContext): Promise<unknown> {
    const bound = await this.requireBoundWorkflow(ctx);
    const updated = await this.manager.update({
      ...input,
      run: bound.run,
      traceId: this.requireTrace(ctx),
    });
    return {
      message: String(input.progressSummary ?? '').trim()
        || 'Workflow progress checkpoint saved.',
      workflow: this.compact(updated),
    };
  }

  private async complete(input: WorkflowCompleteInput, ctx: ToolContext): Promise<unknown> {
    const bound = await this.requireBoundWorkflow(ctx);
    if (!bound.link.phaseId) {
      throw new ToolError('WORKFLOW_TURN_PHASE_REQUIRED', 'This Workflow turn is not bound to an executable phase.');
    }
    const completed = await this.manager.complete({
      ...input,
      run: bound.run,
      phaseId: bound.link.phaseId,
      traceId: this.requireTrace(ctx),
    });
    return {
      message: input.summary,
      workflow: this.compact(completed),
    };
  }

  private async block(input: WorkflowBlockInput, ctx: ToolContext): Promise<unknown> {
    const bound = await this.requireBoundWorkflow(ctx);
    if (!bound.link.phaseId) {
      throw new ToolError('WORKFLOW_TURN_PHASE_REQUIRED', 'This Workflow turn is not bound to an executable phase.');
    }
    const blocked = await this.manager.block({
      ...input,
      run: bound.run,
      phaseId: bound.link.phaseId,
      traceId: this.requireTrace(ctx),
    });
    return {
      message: input.reason,
      workflow: this.compact(blocked),
    };
  }

  private async control(input: WorkflowControlInput, ctx: ToolContext): Promise<unknown> {
    const bound = await this.requireBoundWorkflow(ctx);
    const controlled = await this.manager.control({
      ...input,
      run: bound.run,
      traceId: this.requireTrace(ctx),
    });
    return {
      message: `Workflow ${input.action.toLowerCase()} applied.`,
      workflow: this.compact(controlled),
    };
  }

  private async requireBoundWorkflow(ctx: ToolContext) {
    const traceId = this.requireTrace(ctx);
    const bound = await this.query.byTrace(traceId);
    if (!bound) {
      throw new ToolError('WORKFLOW_TURN_NOT_BOUND', 'This turn is not bound to an active Workflow.');
    }
    const agentId = this.requireAgentId(ctx);
    if (
      bound.run.userId !== ctx.userId
      || bound.run.agentId !== agentId
      || bound.run.conversationId !== ctx.conversationId
    ) {
      throw new ToolError('WORKFLOW_TURN_SCOPE_MISMATCH', 'Workflow turn scope does not match the current conversation.');
    }
    return bound;
  }

  private compact(snapshot: {
    run: any;
    phases: any[];
    currentPhase: any;
  }): Record<string, unknown> {
    return {
      workflowId: snapshot.run.id,
      title: snapshot.run.title,
      goal: snapshot.run.goal,
      status: snapshot.run.status,
      waitReason: snapshot.run.waitReason,
      continuationMode: snapshot.run.continuationMode,
      currentPhase: snapshot.currentPhase
        ? {
            id: snapshot.currentPhase.id,
            title: snapshot.currentPhase.title,
            status: snapshot.currentPhase.status,
          }
        : null,
      phaseCount: snapshot.phases.length,
      completedPhaseCount: snapshot.phases.filter((phase) => phase.status === 'COMPLETED').length,
      phases: snapshot.phases.map((phase) => ({
        id: phase.id,
        parentPhaseId: phase.parentPhaseId,
        title: phase.title,
        status: phase.status,
        position: phase.position,
        dependencyIds: phase.dependencyIds,
      })),
    };
  }

  private async requireUserMessage(ctx: ToolContext) {
    const id = this.requireUserMessageId(ctx);
    const message = await this.prisma.message.findFirst({
      where: {
        id,
        conversationId: ctx.conversationId,
        role: 'USER',
        deletedAt: null,
        conversation: {
          userId: ctx.userId,
          agentId: this.requireAgentId(ctx),
          deletedAt: null,
        },
      },
      select: {
        id: true,
        content: true,
        parentMessageId: true,
        branchId: true,
      },
    });
    if (!message) throw new ToolError('WORKFLOW_USER_MESSAGE_NOT_FOUND', 'Current user message was not found.');
    return message;
  }

  private requireUserMessageId(ctx: ToolContext): string {
    const id = String(ctx.userMessageId ?? '').trim();
    if (!id) throw new ToolError('WORKFLOW_USER_MESSAGE_ID_REQUIRED', 'Current userMessageId is unavailable.');
    return id;
  }

  private requireTrace(ctx: ToolContext): string {
    const traceId = String(ctx.traceId ?? '').trim();
    if (!traceId) throw new ToolError('WORKFLOW_TRACE_ID_REQUIRED', 'Current traceId is unavailable.');
    return traceId;
  }

  private requireAgentId(ctx: ToolContext): string {
    const agentId = this.metadataText(ctx, 'agentId');
    if (!agentId) throw new ToolError('WORKFLOW_AGENT_ID_REQUIRED', 'Current Agent identity is unavailable.');
    return agentId;
  }

  private permissionMode(ctx: ToolContext): AgentPermissionMode {
    const value = this.metadataText(ctx, 'permissionMode');
    return value === 'audit_autorun' || value === 'full_access' ? value : 'confirm_required';
  }

  private metadataText(ctx: ToolContext, key: string): string | null {
    const value = ctx.metadata?.[key];
    const text = String(value ?? '').trim();
    return text || null;
  }
}

const phaseDraftProperties = {
  ref: { type: 'string', minLength: 1, maxLength: 180 },
  title: { type: 'string', minLength: 1, maxLength: 256 },
  description: { type: 'string', maxLength: 20_000 },
  parentRef: { type: 'string', maxLength: 180 },
  dependencyRefs: {
    type: 'array',
    maxItems: 1000,
    items: { type: 'string', minLength: 1, maxLength: 180 },
  },
  acceptanceCriteria: {},
};

const phaseDraftSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ref', 'title'],
  properties: phaseDraftProperties,
};

const startSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'goal', 'continuationMode', 'phases'],
  properties: {
    title: {
      type: 'string',
      minLength: 2,
      maxLength: 256,
      description: 'Concise durable Workflow title. Never copy the full user message.',
    },
    goal: { type: 'string', minLength: 1, maxLength: 20_000 },
    continuationMode: { type: 'string', enum: ['AUTO', 'MANUAL'] },
    phases: {
      type: 'array',
      minItems: 1,
      maxItems: 1000,
      items: phaseDraftSchema,
      description: 'Durable high-level phases. There is no business limit on phase count or tree depth.',
    },
    constraints: { type: 'array', maxItems: 1000, items: { type: 'string' } },
    expectedDeliverables: { type: 'array', maxItems: 1000, items: { type: 'string' } },
    metadata: { type: 'object', additionalProperties: true },
  },
};

const phasePatchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['phaseId'],
  properties: {
    phaseId: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1, maxLength: 256 },
    description: { type: ['string', 'null'], maxLength: 20_000 },
    parentPhaseId: { type: ['string', 'null'] },
    dependencyIds: { type: 'array', maxItems: 1000, items: { type: 'string' } },
    position: { type: 'integer', minimum: 0 },
    acceptanceCriteria: {},
  },
};

const updateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    goal: { type: 'string', minLength: 1, maxLength: 20_000 },
    constraints: { type: 'array', maxItems: 1000, items: { type: 'string' } },
    expectedDeliverables: { type: 'array', maxItems: 1000, items: { type: 'string' } },
    completedPhases: {
      type: 'array',
      maxItems: 1000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phaseId', 'summary'],
        properties: {
          phaseId: { type: 'string', minLength: 1 },
          summary: { type: 'string', minLength: 1, maxLength: 20_000 },
          result: {},
        },
      },
    },
    progressSummary: {
      type: 'string',
      minLength: 1,
      maxLength: 20_000,
      description: 'Durable summary of real progress completed in this turn and the concrete work remaining in the active phase.',
    },
    add: { type: 'array', maxItems: 1000, items: phaseDraftSchema },
    update: { type: 'array', maxItems: 1000, items: phasePatchSchema },
    skipPhaseIds: { type: 'array', maxItems: 1000, items: { type: 'string' } },
    cancelPhaseIds: { type: 'array', maxItems: 1000, items: { type: 'string' } },
    removePhaseIds: { type: 'array', maxItems: 1000, items: { type: 'string' } },
    currentPhaseId: { type: ['string', 'null'] },
  },
};

const completeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 20_000 },
    result: {},
  },
};

const blockSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'reason'],
  properties: {
    kind: {
      type: 'string',
      enum: ['USER_INPUT', 'EXTERNAL_DEPENDENCY', 'RESOURCE_CONFLICT', 'UNRECOVERABLE'],
    },
    reason: { type: 'string', minLength: 1, maxLength: 20_000 },
  },
};

const controlSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ['RESUME', 'PAUSE', 'CANCEL', 'SET_CONTINUATION'] },
    continuationMode: { type: 'string', enum: ['AUTO', 'MANUAL'] },
    reason: { type: 'string', maxLength: 20_000 },
  },
};
