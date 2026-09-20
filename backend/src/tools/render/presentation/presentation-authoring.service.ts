import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RuntimeObjectService } from '../../../modules/object-runtime/object/object.service';
import { objectToolPartition } from '../../object/object-tool-context';
import type { ToolContext } from '../../toolstypes';
import { ToolError } from '../../toolstypes';
import { RenderOutputCommitService } from '../delivery/render-output-commit.service';
import type { RenderPlanDiagnostic } from '../planning/core/render-plan-diagnostics.types';
import { safeFilename } from '../planning/core/render-plan.util';
import { buildPresentationRasterPreview } from '../preview/render-preview.builder';
import { RenderDispatcher } from '../render.dispatcher';
import type { RenderArtifactPreview, RenderPayload } from '../render.types';
import { PresentationAssetResolverService } from './presentation-asset-resolver.service';
import { PresentationContractValidator } from './presentation-contract.validator';
import {
  PRESENTATION_SLIDE_GRAMMAR_IDS,
  PRESENTATION_VISUAL_REVIEW_CRITERIA,
  presentationAuthoringGuide,
  presentationDesignIntentSummary,
} from './presentation-design.guidance';
import type {
  PresentationDraftDocument,
  PresentationDraftPartition,
  PresentationDraftSlideSpec,
  PresentationOutlineItem,
} from './presentation-draft.types';
import { PresentationLayoutEngine } from './presentation-layout.engine';
import { PresentationRenderOutputVerifier } from './presentation-output.verifier';
import { PresentationRenderError } from './presentation-render.errors';
import { PresentationSlideRasterizerService } from './presentation-slide-rasterizer.service';
import type {
  PresentationDesignDNA,
  PresentationDesignStudy,
  PresentationFill,
  PresentationRuntimePayload,
  PresentationScene,
  PresentationSlideDesignIntent,
  PresentationSlideSpec,
  ResolvedPresentationSlide,
} from './presentation.types';
import { PresentationWorkspaceStore } from './presentation-workspace.store';

export interface PresentationCreateInput {
  title: string;
  purpose: string;
  audience?: string;
  usage?: string;
  language?: string;
  storyline?: string;
  outline: PresentationOutlineItem[];
  designStudy: PresentationDesignStudy;
  designDNA: PresentationDesignDNA;
  page: {
    widthInch: number;
    heightInch: number;
  };
  filename?: string;
}

export interface PresentationSlideUpsertInput {
  id: string;
  designIntent?: PresentationSlideDesignIntent;
  background?: PresentationFill;
  scene: PresentationScene;
}

interface ResolvedSlideResult {
  ok: boolean;
  diagnostics: RenderPlanDiagnostic[];
  slide?: ResolvedPresentationSlide;
}

@Injectable()
export class PresentationAuthoringService {
  constructor(
    private readonly workspace: PresentationWorkspaceStore,
    private readonly validator: PresentationContractValidator,
    private readonly assets: PresentationAssetResolverService,
    private readonly layout: PresentationLayoutEngine,
    private readonly dispatcher: RenderDispatcher,
    private readonly verifier: PresentationRenderOutputVerifier,
    private readonly delivery: RenderOutputCommitService,
    private readonly rasterizer: PresentationSlideRasterizerService,
    private readonly objects: RuntimeObjectService,
  ) {}

  async create(
    input: PresentationCreateInput,
    context: ToolContext,
  ): Promise<Record<string, unknown>> {
    const partition = this.partition(context);
    const title = this.requiredText(input.title, 'PRESENTATION_TITLE_REQUIRED', 'title');
    const purpose = this.requiredText(input.purpose, 'PRESENTATION_PURPOSE_REQUIRED', 'purpose');
    const outline = this.normalizeOutline(input.outline);
    const studyResult = this.validator.validateDesignStudy(input.designStudy);
    if (!studyResult.ok) throw this.contractError('PRESENTATION_DESIGN_STUDY_INVALID', 'designStudy failed validation.', studyResult.diagnostics);
    const dnaResult = this.validator.validateDesignDNA(input.designDNA);
    if (!dnaResult.ok) throw this.contractError('PRESENTATION_DESIGN_DNA_INVALID', 'designDNA failed validation.', dnaResult.diagnostics);

    const widthInch = Number(input.page?.widthInch);
    const heightInch = Number(input.page?.heightInch);
    if (!Number.isFinite(widthInch) || widthInch <= 0 || !Number.isFinite(heightInch) || heightInch <= 0) {
      throw new ToolError('PRESENTATION_PAGE_INVALID', 'page.widthInch and page.heightInch must be greater than zero.');
    }
    const page = { widthInch, heightInch };
    const filename = safeFilename(input.filename, title, 'pptx');

    const document = await this.workspace.create(partition, (id, now) => ({
      id,
      revision: 1,
      partition,
      objective: {
        purpose,
        audience: this.optionalText(input.audience),
        usage: this.optionalText(input.usage),
        language: this.optionalText(input.language),
      },
      narrative: {
        title,
        storyline: this.optionalText(input.storyline),
        outline,
      },
      design: {
        page,
        study: studyResult.value,
        dna: dnaResult.value,
      },
      output: {
        format: 'pptx',
        filename,
      },
      slides: {},
      createdAt: now,
      updatedAt: now,
    }));

    return this.deckSummary(document);
  }

  async upsertSlides(
    presentationId: string,
    slides: PresentationSlideUpsertInput[],
    context: ToolContext,
  ): Promise<Record<string, unknown>> {
    const id = this.requiredText(presentationId, 'PRESENTATION_ID_REQUIRED', 'presentationId');
    if (!Array.isArray(slides) || slides.length === 0) {
      throw new ToolError('PRESENTATION_SLIDES_REQUIRED', 'slides must contain at least one slide.');
    }
    if (slides.length > 6) {
      throw new ToolError('PRESENTATION_SLIDE_BATCH_LIMIT', 'A single presentation.slides.upsert call can contain at most 6 slides.', { maximum: 6 });
    }

    const partition = this.partition(context);
    const mutation = await this.workspace.mutate(id, partition, async (document) => {
      const results: Array<Record<string, unknown>> = [];
      let accepted = 0;

      for (const input of slides) {
        const slideId = String(input?.id ?? '').trim();
        const outline = document.narrative.outline.find((item) => item.id === slideId);
        if (!slideId || !outline) {
          results.push({
            slideId: slideId || null,
            status: 'rejected',
            diagnostics: [this.diagnostic('PRESENTATION_SLIDE_NOT_IN_OUTLINE', 'Slide id must match an item declared by presentation.create.', '$.slides[].id')],
          });
          continue;
        }

        const draftSlide: PresentationDraftSlideSpec = {
          id: slideId,
          purpose: outline.purpose,
          designIntent: this.normalizeDesignIntent(
            input.designIntent ?? outline.designIntent,
            `slides[${slideId}].designIntent`,
          ),
          background: input.background,
          scene: this.clone(input.scene),
        };
        const resolved = await this.resolveSlide(document, draftSlide, context);
        if (!resolved.ok) {
          results.push({ slideId, status: 'rejected', diagnostics: this.compactDiagnostics(resolved.diagnostics) });
          continue;
        }

        document.slides[slideId] = this.clone(draftSlide);
        accepted += 1;
        results.push({
          slideId,
          status: 'stored',
          designIntent: presentationDesignIntentSummary(draftSlide.designIntent),
          diagnostics: this.compactDiagnostics(resolved.diagnostics),
          resolvedElementCount: resolved.slide?.elements.length ?? 0,
        });
      }

      if (accepted > 0) document.revision += 1;
      return { accepted, results };
    });

    return {
      presentationId: mutation.document.id,
      revision: mutation.document.revision,
      accepted: mutation.result.accepted,
      rejected: slides.length - mutation.result.accepted,
      slides: mutation.result.results,
      readySlideIds: this.readySlideIds(mutation.document),
      remainingSlideIds: this.remainingSlideIds(mutation.document),
      state: 'persisted',
    };
  }

  async inspect(
    presentationId: string,
    slideIds: string[] | undefined,
    includeSource: boolean,
    context: ToolContext,
  ): Promise<Record<string, unknown>> {
    const id = this.requiredText(presentationId, 'PRESENTATION_ID_REQUIRED', 'presentationId');
    const document = await this.workspace.read(id, this.partition(context));
    const requested = this.normalizeSlideIds(slideIds);
    if (requested.length === 0) return this.deckSummary(document);
    if (requested.length > 4) throw new ToolError('PRESENTATION_INSPECT_BATCH_LIMIT', 'presentation.inspect can inspect at most 4 slides in one call.', { maximum: 4 });

    const results: Array<Record<string, unknown>> = [];
    const observationIds: string[] = [];
    for (const requestedSlideId of requested) {
      const outline = document.narrative.outline.find((item) => item.id === requestedSlideId);
      if (!outline) {
        results.push({ slideId: requestedSlideId, status: 'missing_from_outline', diagnostics: [this.diagnostic('PRESENTATION_SLIDE_NOT_IN_OUTLINE', 'Requested slide does not exist in the presentation outline.', '$.slideIds')] });
        continue;
      }
      const draft = document.slides[requestedSlideId];
      if (!draft) {
        results.push({ slideId: requestedSlideId, status: 'missing', outline });
        continue;
      }

      const resolved = await this.resolveSlide(document, draft, context);
      let observation: Record<string, unknown> | null = null;
      if (resolved.ok && resolved.slide) {
        observation = await this.createObservation(document, resolved.slide, context);
        observationIds.push(String(observation.objectId));
      }
      results.push({
        slideId: requestedSlideId,
        status: resolved.ok ? 'ready' : 'invalid',
        diagnostics: this.compactDiagnostics(resolved.diagnostics),
        designIntent: presentationDesignIntentSummary(
          draft.designIntent ?? outline.designIntent,
        ),
        visualObservation: observation,
        ...(includeSource ? {
          source: {
            designIntent: presentationDesignIntentSummary(
              draft.designIntent ?? outline.designIntent,
            ),
            background: draft.background ?? null,
            scene: draft.scene,
          },
        } : {}),
      });
    }

    return {
      presentationId: id,
      revision: document.revision,
      slides: results,
      visualObservationObjectIds: observationIds,
      readySlideIds: this.readySlideIds(document),
      remainingSlideIds: this.remainingSlideIds(document),
      sourceIncluded: includeSource,
      visualReviewCriteria: PRESENTATION_VISUAL_REVIEW_CRITERIA,
    };
  }

  async finalize(
    presentationId: string,
    filename: string | undefined,
    context: ToolContext,
  ): Promise<unknown> {
    const id = this.requiredText(presentationId, 'PRESENTATION_ID_REQUIRED', 'presentationId');
    const partition = this.partition(context);

    const mutation = await this.workspace.mutate(id, partition, async (document) => {
      const missing = this.remainingSlideIds(document);
      if (missing.length > 0) {
        throw new ToolError('PRESENTATION_SLIDES_INCOMPLETE', 'Presentation cannot be finalized until every outline slide has been authored.', { presentationId: id, missingSlideIds: missing });
      }

      const sourceSlides = document.narrative.outline.map((item) => this.toSlideSpec(document.slides[item.id], item.purpose));
      const validationDiagnostics: RenderPlanDiagnostic[] = [];
      for (const slide of sourceSlides) {
        const validated = this.validator.validateSlide(slide, { designDNA: document.design.dna });
        validationDiagnostics.push(...this.rebaseDiagnostics(validated.diagnostics, slide.id));
        if (!validated.ok) throw this.contractError('PRESENTATION_SLIDE_INVALID', `Slide ${slide.id} failed validation.`, validationDiagnostics);
      }

      const resolvedAssets = await this.assets.resolveSlides(sourceSlides, context);
      const laidOut = this.layout.resolve(resolvedAssets, { page: document.design.page, designDNA: document.design.dna });
      if (!laidOut.ok) throw this.contractError('PRESENTATION_LAYOUT_INVALID', 'Presentation layout failed objective constraints.', laidOut.diagnostics);

      const outputFilename = safeFilename(filename, document.narrative.title, 'pptx');
      const payload: PresentationRuntimePayload = {
        title: document.narrative.title,
        language: document.objective.language,
        page: document.design.page,
        designDNA: document.design.dna,
        slides: laidOut.value,
        meta: {
          presentationId: document.id,
          presentationRevision: document.revision,
        },
      };
      const dispatch = await this.dispatcher.render({
        toolName: 'presentation.pptx.write',
        userId: context.userId,
        conversationId: context.conversationId,
        requestId: context.requestId,
        source: this.source(context),
        filename: outputFilename,
        title: document.narrative.title,
        payload: payload as unknown as RenderPayload,
        meta: {
          traceId: context.traceId,
          presentationId: document.id,
          presentationRevision: document.revision,
        },
      });

      const verified = await this.verifier.verify({
        expectedSlideCount: laidOut.value.length,
        artifact: dispatch.artifact,
      });
      if (!verified.ok) throw this.contractError('PRESENTATION_OUTPUT_VERIFICATION_FAILED', 'Rendered PPTX failed package verification.', verified.diagnostics);

      let preview: RenderArtifactPreview | undefined;
      const previewDiagnostics: RenderPlanDiagnostic[] = [];
      try {
        preview = await this.createFinalPreview(document, laidOut.value);
      } catch (error) {
        previewDiagnostics.push({
          stage: 'rendering',
          code: 'PRESENTATION_PREVIEW_FAILED',
          message: error instanceof Error ? error.message : String(error),
          severity: 'warning',
          repairable: false,
          detail: {
            presentationId: document.id,
            presentationRevision: document.revision,
          },
        });
      }

      const diagnostics = [
        ...validationDiagnostics,
        ...laidOut.diagnostics,
        ...verified.diagnostics,
        ...previewDiagnostics,
      ];
      const delivered = await this.delivery.persist({
        artifact: preview
          ? { ...verified.value, preview }
          : verified.value,
        context,
        filename: outputFilename,
        tool: dispatch.tool,
        meta: {
          ...dispatch.meta,
          presentationId: document.id,
          presentationRevision: document.revision,
          diagnostics,
        },
      });

      const objectId = String(delivered.meta?.objectId ?? delivered.artifact?.id ?? '').trim();
      if (objectId) {
        document.lastFinalized = { revision: document.revision, objectId, finalizedAt: new Date().toISOString() };
      }
      return { ...delivered, presentation: { diagnostics } };
    });

    return {
      ...mutation.result,
      presentationDraft: {
        presentationId: mutation.document.id,
        revision: mutation.document.revision,
        persisted: true,
        lastFinalized: mutation.document.lastFinalized ?? null,
      },
    };
  }

  private async resolveSlide(
    document: PresentationDraftDocument,
    draftSlide: PresentationDraftSlideSpec,
    context: ToolContext,
  ): Promise<ResolvedSlideResult> {
    try {
      const source = this.toSlideSpec(draftSlide, draftSlide.purpose);
      const validated = this.validator.validateSlide(source, { designDNA: document.design.dna });
      if (!validated.ok) return { ok: false, diagnostics: this.rebaseDiagnostics(validated.diagnostics, draftSlide.id) };
      const resolvedAssets = await this.assets.resolveSlides([validated.value], context);
      const laidOut = this.layout.resolve(resolvedAssets, { page: document.design.page, designDNA: document.design.dna });
      const diagnostics = this.rebaseDiagnostics([...validated.diagnostics, ...laidOut.diagnostics], draftSlide.id);
      return laidOut.ok
        ? { ok: true, diagnostics, slide: laidOut.value[0] }
        : { ok: false, diagnostics };
    } catch (error) {
      if (error instanceof PresentationRenderError) return { ok: false, diagnostics: this.rebaseDiagnostics(error.diagnostics, draftSlide.id) };
      return {
        ok: false,
        diagnostics: [this.diagnostic('PRESENTATION_SLIDE_RESOLVE_FAILED', error instanceof Error ? error.message : String(error), '$.slide', false)],
      };
    }
  }

  private async createFinalPreview(
    document: PresentationDraftDocument,
    slides: ResolvedPresentationSlide[],
  ): Promise<RenderArtifactPreview> {
    const rasters = [] as Array<{
      id: string;
      buffer: Buffer;
      width: number;
      height: number;
    }>;

    for (const slide of slides) {
      const raster = await this.rasterizer.render({
        slide,
        widthInch: document.design.page.widthInch,
        heightInch: document.design.page.heightInch,
        widthPx: 960,
      });
      rasters.push({
        id: slide.id,
        buffer: raster.buffer,
        width: raster.width,
        height: raster.height,
      });
    }

    return buildPresentationRasterPreview({
      title: document.narrative.title,
      slides: rasters,
    });
  }

  private async createObservation(
    document: PresentationDraftDocument,
    slide: ResolvedPresentationSlide,
    context: ToolContext,
  ): Promise<Record<string, unknown>> {
    const raster = await this.rasterizer.render({
      slide,
      widthInch: document.design.page.widthInch,
      heightInch: document.design.page.heightInch,
      widthPx: 1600,
    });
    const created = await this.objects.createGenerated({
      ...objectToolPartition(context),
      originalName: `presentation-${document.id}-${slide.id}-inspect.png`,
      mimeType: 'image/png',
      buffer: raster.buffer,
      visibility: 'internal',
      metadata: {
        source: 'presentation.inspect',
        role: 'internal_visual_observation',
        hiddenFromDelivery: true,
        presentationId: document.id,
        presentationRevision: document.revision,
        slideId: slide.id,
      } as Prisma.InputJsonObject,
    });
    return { objectId: created.id, mimeType: 'image/png', width: raster.width, height: raster.height };
  }

  private toSlideSpec(slide: PresentationDraftSlideSpec, purpose?: string): PresentationSlideSpec {
    return { id: slide.id, purpose, background: slide.background, scene: this.clone(slide.scene) };
  }

  private deckSummary(document: PresentationDraftDocument): Record<string, unknown> {
    return {
      presentationId: document.id,
      revision: document.revision,
      title: document.narrative.title,
      storyline: document.narrative.storyline ?? null,
      outline: document.narrative.outline,
      design: {
        page: document.design.page,
        designStudy: document.design.study,
        designDNA: document.design.dna,
      },
      authoringGuide: presentationAuthoringGuide(),
      output: document.output,
      readySlideIds: this.readySlideIds(document),
      remainingSlideIds: this.remainingSlideIds(document),
      state: 'persisted',
      lastFinalized: document.lastFinalized ?? null,
    };
  }

  private readySlideIds(document: PresentationDraftDocument): string[] {
    return document.narrative.outline.map((item) => item.id).filter((id) => Boolean(document.slides[id]));
  }

  private remainingSlideIds(document: PresentationDraftDocument): string[] {
    return document.narrative.outline.map((item) => item.id).filter((id) => !document.slides[id]);
  }

  private normalizeOutline(value: PresentationOutlineItem[]): PresentationOutlineItem[] {
    if (!Array.isArray(value) || value.length === 0) throw new ToolError('PRESENTATION_OUTLINE_REQUIRED', 'outline must contain at least one slide.');
    if (value.length > 60) throw new ToolError('PRESENTATION_OUTLINE_LIMIT', 'outline cannot exceed 60 slides.', { maximum: 60 });
    const ids = new Set<string>();
    return value.map((item, index) => {
      const id = this.requiredText(item?.id, 'PRESENTATION_OUTLINE_ID_REQUIRED', `outline[${index}].id`);
      if (ids.has(id)) throw new ToolError('PRESENTATION_OUTLINE_DUPLICATE_ID', `outline contains duplicate slide id: ${id}`, { slideId: id, index });
      ids.add(id);
      return {
        id,
        title: this.optionalText(item?.title),
        purpose: this.requiredText(item?.purpose, 'PRESENTATION_OUTLINE_PURPOSE_REQUIRED', `outline[${index}].purpose`),
        keyMessage: this.optionalText(item?.keyMessage),
        designIntent: this.normalizeDesignIntent(
          item?.designIntent,
          `outline[${index}].designIntent`,
        ),
      };
    });
  }

  private normalizeDesignIntent(
    value: PresentationSlideDesignIntent | undefined,
    field: string,
  ): PresentationSlideDesignIntent | undefined {
    if (value == null) return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new ToolError(
        'PRESENTATION_SLIDE_DESIGN_INTENT_INVALID',
        `${field} must be an object.`,
      );
    }

    const grammarText = String(value.grammar ?? '').trim();
    const grammar = grammarText || undefined;
    if (
      grammar
      && !PRESENTATION_SLIDE_GRAMMAR_IDS.includes(
        grammar as (typeof PRESENTATION_SLIDE_GRAMMAR_IDS)[number],
      )
    ) {
      throw new ToolError(
        'PRESENTATION_SLIDE_GRAMMAR_INVALID',
        `${field}.grammar is invalid.`,
        { grammar },
      );
    }

    const densityText = String(value.density ?? '').trim();
    const density = densityText || undefined;
    if (density && !['low', 'medium', 'high'].includes(density)) {
      throw new ToolError(
        'PRESENTATION_SLIDE_DENSITY_INVALID',
        `${field}.density is invalid.`,
        { density },
      );
    }

    const visualWeightText = String(value.visualWeight ?? '').trim();
    const visualWeight = visualWeightText || undefined;
    if (visualWeight && !['text', 'balanced', 'visual', 'data'].includes(visualWeight)) {
      throw new ToolError(
        'PRESENTATION_SLIDE_VISUAL_WEIGHT_INVALID',
        `${field}.visualWeight is invalid.`,
        { visualWeight },
      );
    }

    const composition = this.optionalText(value.composition);
    if (composition && composition.length > 600) {
      throw new ToolError(
        'PRESENTATION_SLIDE_COMPOSITION_INVALID',
        `${field}.composition cannot exceed 600 characters.`,
      );
    }

    if (!grammar && !density && !visualWeight && !composition) {
      return undefined;
    }

    return {
      ...(grammar ? { grammar: grammar as PresentationSlideDesignIntent['grammar'] } : {}),
      ...(density ? { density: density as PresentationSlideDesignIntent['density'] } : {}),
      ...(visualWeight ? { visualWeight: visualWeight as PresentationSlideDesignIntent['visualWeight'] } : {}),
      ...(composition ? { composition } : {}),
    };
  }

  private partition(context: ToolContext): PresentationDraftPartition {
    const userId = String(context.userId ?? '').trim();
    const conversationId = String(context.conversationId ?? '').trim();
    const agentId = String(context.metadata?.agentId ?? '').trim();
    if (!userId || !conversationId || !agentId) throw new ToolError('PRESENTATION_CONTEXT_REQUIRED', 'Presentation authoring requires userId, conversationId, and agentId.');
    return { userId, conversationId, agentId };
  }

  private rebaseDiagnostics(diagnostics: RenderPlanDiagnostic[], slideId: string | undefined): RenderPlanDiagnostic[] {
    return diagnostics.map((diagnostic) => ({
      ...diagnostic,
      detail: { ...(diagnostic.detail ?? {}), ...(slideId ? { slideId } : {}) },
    }));
  }

  private compactDiagnostics(diagnostics: RenderPlanDiagnostic[]): RenderPlanDiagnostic[] {
    return diagnostics.slice(0, 20).map((item) => ({ ...item }));
  }

  private normalizeSlideIds(value: string[] | undefined): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))];
  }

  private contractError(code: string, message: string, diagnostics: RenderPlanDiagnostic[]): PresentationRenderError {
    return new PresentationRenderError(code, message, 'validation', diagnostics, false);
  }

  private diagnostic(code: string, message: string, path?: string, repairable = true): RenderPlanDiagnostic {
    return { stage: 'validation', code, message, path, severity: 'error', repairable };
  }

  private requiredText(value: unknown, code: string, field: string): string {
    const text = String(value ?? '').trim();
    if (!text) throw new ToolError(code, `${field} is required.`);
    return text;
  }

  private optionalText(value: unknown): string | undefined {
    const text = String(value ?? '').trim();
    return text || undefined;
  }


  private source(context: ToolContext): string {
    const value = context.metadata?.source;
    return typeof value === 'string' && value.trim() ? value.trim() : 'agent';
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
