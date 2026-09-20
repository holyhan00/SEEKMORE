import { Injectable, Logger } from '@nestjs/common';
import type { ToolContext } from '../toolstypes';
import { RenderOutputCommitService } from './delivery/render-output-commit.service';
import { RenderPlanningError } from './planning/core/render-planning.errors';
import { RenderPlanningOrchestrator } from './planning/core/render-planning.orchestrator';
import type { RenderPlanDiagnostic } from './planning/core/render-plan-diagnostics.types';
import type { RenderPlanBase, RenderPlanningRequest } from './planning/core/render-plan.types';
import { RenderDispatcher } from './render.dispatcher';
import type { RenderDeliveryResult } from './delivery/render-delivery.types';

@Injectable()
export class RenderPipelineService {
  private readonly logger = new Logger(RenderPipelineService.name);
  private readonly maximumOutputRepairAttempts = 1;

  constructor(
    private readonly planning: RenderPlanningOrchestrator,
    private readonly dispatcher: RenderDispatcher,
    private readonly delivery: RenderOutputCommitService,
  ) {}

  async execute(
    request: RenderPlanningRequest,
    context: ToolContext,
  ): Promise<RenderDeliveryResult & {
    planning: {
      kind: string;
      format: string;
      attempts: number;
      diagnostics: RenderPlanDiagnostic[];
      objective: unknown;
      design: unknown;
    };
  }> {
    const startedAt = Date.now();
    this.logger.log(`[RenderPipeline] stage=planning.start kind=${request.kind} format=${request.output.format} trace=${context.traceId ?? '-'}`);
    const planningStartedAt = Date.now();
    let compiled = await this.planning.planAndCompile(request, context);
    this.logger.log(`[RenderPipeline] stage=planning.done durationMs=${Date.now() - planningStartedAt} attempts=${compiled.attempts} trace=${context.traceId ?? '-'}`);
    let verificationDiagnostics: RenderPlanDiagnostic[] = [];

    for (let outputAttempt = 0; outputAttempt <= this.maximumOutputRepairAttempts; outputAttempt += 1) {
      this.logger.log(`[RenderPipeline] stage=rendering.start attempt=${outputAttempt + 1} trace=${context.traceId ?? '-'}`);
      const renderingStartedAt = Date.now();
      const dispatch = await this.dispatcher.render({
        toolName: compiled.toolName,
        userId: context.userId,
        conversationId: context.conversationId,
        requestId: context.requestId,
        source: this.source(context),
        filename: compiled.filename,
        title: this.title(compiled.plan),
        payload: compiled.payload,
        meta: {
          ...(request.meta ?? {}),
          traceId: context.traceId,
          renderPlanKind: compiled.plan.kind,
          renderPlanVersion: compiled.plan.version,
          planningAttempts: compiled.attempts,
        },
      });

      this.logger.log(`[RenderPipeline] stage=rendering.done durationMs=${Date.now() - renderingStartedAt} trace=${context.traceId ?? '-'}`);
      this.logger.log(`[RenderPipeline] stage=verification.start trace=${context.traceId ?? '-'}`);
      const verificationStartedAt = Date.now();
      const verified = await this.planning.verifyOutput({
        request,
        plan: compiled.plan,
        artifact: dispatch.artifact,
      });
      verificationDiagnostics = verified.diagnostics;
      this.logger.log(`[RenderPipeline] stage=verification.done ok=${verified.ok} durationMs=${Date.now() - verificationStartedAt} diagnostics=${JSON.stringify(verified.diagnostics)} trace=${context.traceId ?? '-'}`);

      if (verified.ok) {
        this.logger.log(`[RenderPipeline] stage=delivery.start trace=${context.traceId ?? '-'}`);
        const deliveryStartedAt = Date.now();
        const delivered = await this.delivery.persist({
          artifact: verified.value,
          context,
          filename: compiled.filename,
          tool: dispatch.tool,
          meta: {
            ...dispatch.meta,
            durationMs: Date.now() - startedAt,
            planningAttempts: compiled.attempts,
            planningDiagnostics: compiled.diagnostics,
            verificationDiagnostics,
          },
        });
        this.logger.log(`[RenderPipeline] stage=delivery.done durationMs=${Date.now() - deliveryStartedAt} trace=${context.traceId ?? '-'}`);
        this.logger.log(
          `[RenderPipeline] completed kind=${request.kind} format=${request.output.format} file=${delivered.artifact.filename} durationMs=${Date.now() - startedAt} trace=${context.traceId ?? '-'}`,
        );
        return {
          ...delivered,
          planning: {
            kind: compiled.plan.kind,
            format: request.output.format,
            attempts: compiled.attempts,
            diagnostics: [...compiled.diagnostics, ...verificationDiagnostics],
            objective: compiled.plan.objective,
            design: compiled.plan.design,
          },
        };
      }

      const repairable = verified.diagnostics.some((item) => item.repairable);
      if (!repairable || outputAttempt >= this.maximumOutputRepairAttempts) {
        throw new RenderPlanningError(
          'RENDER_OUTPUT_VERIFICATION_FAILED',
          'Rendered output did not pass verification.',
          'verification',
          verified.diagnostics,
          false,
        );
      }

      compiled = await this.planning.repairAndCompile({
        request,
        previousPlan: compiled.plan,
        diagnostics: verified.diagnostics,
        previousAttempts: compiled.attempts,
        context,
      });
    }

    throw new RenderPlanningError(
      'RENDER_PIPELINE_UNREACHABLE',
      'Render pipeline ended without a delivery result.',
      'delivery',
      verificationDiagnostics,
    );
  }

  private source(context: ToolContext): string {
    const value = context.metadata?.source;
    return typeof value === 'string' && value.trim() ? value.trim() : 'agent';
  }

  private title(plan: RenderPlanBase): string | undefined {
    const value = plan as unknown as Record<string, unknown>;
    const composition = value.composition as Record<string, unknown> | undefined;
    const workbook = value.workbook as Record<string, unknown> | undefined;
    const narrative = value.narrative as Record<string, unknown> | undefined;
    const candidate = composition?.title ?? workbook?.title ?? narrative?.title;
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
  }
}
