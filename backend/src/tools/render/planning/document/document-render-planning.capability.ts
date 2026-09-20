import { Injectable } from '@nestjs/common';
import type { ToolContext } from '../../../toolstypes';
import type { RenderPlanningCapability, RenderOutputVerificationInput } from '../core/render-planning-capability';
import type { RenderPlanningRequest } from '../core/render-plan.types';
import { DocumentRenderPlanCompiler } from '../../compilation/document/document-render-plan.compiler';
import { DocumentRenderOutputVerifier } from '../../verification/document/document-render-output.verifier';
import { DOCUMENT_RENDER_PLAN_SCHEMA } from './document-render-plan.schema';
import type { DocumentRenderPlan } from './document-render-plan.types';
import { DocumentRenderPlanValidator } from './document-render-plan.validator';
import { DocumentRenderPlannerService } from './document-render-planner.service';

@Injectable()
export class DocumentRenderPlanningCapability implements RenderPlanningCapability<DocumentRenderPlan> {
  readonly kind = 'document' as const;
  readonly formats = ['docx', 'pdf'] as const;
  readonly schema = DOCUMENT_RENDER_PLAN_SCHEMA;

  constructor(
    private readonly planner: DocumentRenderPlannerService,
    private readonly validator: DocumentRenderPlanValidator,
    private readonly compiler: DocumentRenderPlanCompiler,
    private readonly verifier: DocumentRenderOutputVerifier,
  ) {}

  plan(request: RenderPlanningRequest, context: ToolContext): Promise<unknown> {
    return this.planner.plan(request, context);
  }

  validate(plan: unknown) {
    return this.validator.validate(plan);
  }

  compile(plan: DocumentRenderPlan, request: RenderPlanningRequest) {
    return this.compiler.compile(plan, request);
  }

  verifyOutput(input: RenderOutputVerificationInput<DocumentRenderPlan>) {
    return this.verifier.verify(input);
  }
}
