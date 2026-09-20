import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ToolContext } from '../../../toolstypes';
import type { RenderArtifact } from '../../render.types';
import type { RenderPlanningCapability } from './render-planning-capability';
import type { RenderPlanDiagnostic } from './render-plan-diagnostics.types';
import { RenderPlanParserService } from './render-plan-parser.service';
import { RenderPlanRepairService } from './render-plan-repair.service';
import { RenderPlanningRegistry } from './render-planning.registry';
import type { CompiledRenderPlan, RenderPlanBase, RenderPlanningRequest } from './render-plan.types';
import { RenderPlanningError } from './render-planning.errors';

@Injectable()
export class RenderPlanningOrchestrator {
  private readonly logger = new Logger(RenderPlanningOrchestrator.name);
  private readonly maximumPlanAttempts = 3;
  private readonly cache = new Map<string, CompiledRenderPlan>();
  private readonly maximumCacheEntries = 128;

  constructor(
    private readonly registry: RenderPlanningRegistry,
    private readonly parser: RenderPlanParserService,
    private readonly repair: RenderPlanRepairService,
  ) {}

  async planAndCompile(
    request: RenderPlanningRequest,
    context: ToolContext,
  ): Promise<CompiledRenderPlan> {
    const capability = this.registry.resolve(request.kind, request.output.format);
    const key = this.fingerprint(request);
    const cached = this.cache.get(key);
    if (cached) {
      this.logger.log(`[RenderPlanning] cache_hit kind=${request.kind} format=${request.output.format} trace=${context.traceId ?? '-'}`);
      return cached;
    }
    let candidate: unknown = request.plan ?? await capability.plan(request, context);
    let diagnostics: RenderPlanDiagnostic[] = [];

    for (let attempt = 1; attempt <= this.maximumPlanAttempts; attempt += 1) {
      const result = this.evaluate(capability, request, candidate);
      diagnostics = [...diagnostics, ...result.diagnostics];
      if (result.ok) {
        this.logger.log(
          `[RenderPlanning] compiled kind=${request.kind} format=${request.output.format} attempts=${attempt} trace=${context.traceId ?? '-'}`,
        );
        const compiled: CompiledRenderPlan = {
          ...result.value,
          diagnostics,
          attempts: request.plan ? 0 : attempt,
        };
        this.remember(key, compiled);
        return compiled;
      }

      const repairable = result.diagnostics.some((item) => item.repairable);
      if (!repairable || attempt >= this.maximumPlanAttempts) break;
      candidate = await this.repair.repair({
        previous: candidate,
        diagnostics: result.diagnostics,
        schema: capability.schema,
        context,
      });
    }

    throw new RenderPlanningError(
      'RENDER_PLAN_REPAIR_EXHAUSTED',
      'Render plan could not be validated and compiled within the repair budget.',
      'compilation',
      diagnostics,
      false,
    );
  }

  async repairAndCompile(input: {
    request: RenderPlanningRequest;
    previousPlan: RenderPlanBase;
    diagnostics: RenderPlanDiagnostic[];
    previousAttempts?: number;
    context: ToolContext;
  }): Promise<CompiledRenderPlan> {
    const capability = this.registry.resolve(input.request.kind, input.request.output.format);
    const repaired = await this.repair.repair({
      previous: input.previousPlan,
      diagnostics: input.diagnostics,
      schema: capability.schema,
      context: input.context,
    });
    const result = this.evaluate(capability, input.request, repaired);
    if (!result.ok) {
      throw new RenderPlanningError(
        'RENDER_OUTPUT_REPAIR_FAILED',
        'Render plan repair did not produce a compilable plan.',
        'verification',
        result.diagnostics,
      );
    }
    return {
      ...result.value,
      diagnostics: [...input.diagnostics, ...result.diagnostics],
      attempts: Math.max(0, input.previousAttempts ?? 0) + 1,
    };
  }

  async verifyOutput(input: {
    request: RenderPlanningRequest;
    plan: RenderPlanBase;
    artifact: RenderArtifact;
  }) {
    const capability = this.registry.resolve(input.request.kind, input.request.output.format);
    return capability.verifyOutput(input as never);
  }

  private fingerprint(request: RenderPlanningRequest): string {
    const stable = JSON.stringify({
      kind: request.kind,
      instruction: request.instruction,
      source: request.source,
      requirements: request.requirements,
      output: request.output,
      plan: request.plan,
    });
    return createHash('sha256').update(stable).digest('hex');
  }

  private remember(key: string, value: CompiledRenderPlan): void {
    if (this.cache.size >= this.maximumCacheEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }

  private evaluate(
    capability: RenderPlanningCapability,
    request: RenderPlanningRequest,
    candidate: unknown,
  ):
    | { ok: true; value: Omit<CompiledRenderPlan, 'diagnostics' | 'attempts'>; diagnostics: RenderPlanDiagnostic[] }
    | { ok: false; diagnostics: RenderPlanDiagnostic[] } {
    const parsed = this.parser.parse(candidate);
    if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };

    const normalized = capability.normalize
      ? capability.normalize(parsed.value)
      : { ok: true as const, value: parsed.value, diagnostics: [] };
    if (!normalized.ok) return { ok: false, diagnostics: normalized.diagnostics };

    const validated = capability.validate(normalized.value);
    if (!validated.ok) {
      return {
        ok: false,
        diagnostics: [...normalized.diagnostics, ...validated.diagnostics],
      };
    }

    const executionValidated = capability.validateExecution
      ? capability.validateExecution(validated.value, request)
      : { ok: true as const, value: validated.value, diagnostics: [] };
    if (!executionValidated.ok) {
      return {
        ok: false,
        diagnostics: [
          ...normalized.diagnostics,
          ...validated.diagnostics,
          ...executionValidated.diagnostics,
        ],
      };
    }

    const compiled = capability.compile(executionValidated.value, request);
    if (!compiled.ok) {
      return {
        ok: false,
        diagnostics: [
          ...parsed.diagnostics,
          ...normalized.diagnostics,
          ...validated.diagnostics,
          ...executionValidated.diagnostics,
          ...compiled.diagnostics,
        ],
      };
    }

    return {
      ok: true,
      value: {
        plan: executionValidated.value,
        toolName: compiled.value.toolName,
        payload: compiled.value.payload,
        filename: compiled.value.filename,
      },
      diagnostics: [
        ...parsed.diagnostics,
        ...normalized.diagnostics,
        ...validated.diagnostics,
        ...executionValidated.diagnostics,
        ...compiled.diagnostics,
      ],
    };
  }
}
