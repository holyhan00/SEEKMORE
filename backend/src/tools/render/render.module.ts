import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { LLMModule } from '../../modules/llm/llm.module';
import { RuntimeObjectModule } from '../../modules/object-runtime/object/object.module';

import { RenderDispatcher } from './render.dispatcher';
import { RenderRegistry } from './render.registry';
import { RenderPipelineService } from './render-pipeline.service';
import { RenderObjectDeliveryService } from './delivery/render-object-delivery.service';
import { RenderOutputCommitService } from './delivery/render-output-commit.service';
import { RenderPlanningToolRequestFactory } from './tools/render-planning-tool-request.factory';

import { RenderPlanningRegistry } from './planning/core/render-planning.registry';
import { RenderPlanningModelService } from './planning/core/render-planning-model.service';
import { RenderPlanParserService } from './planning/core/render-plan-parser.service';
import { RenderPlanRepairService } from './planning/core/render-plan-repair.service';
import { RenderPlanningOrchestrator } from './planning/core/render-planning.orchestrator';

import { DocumentRenderPlannerService } from './planning/document/document-render-planner.service';
import { DocumentRenderPlanValidator } from './planning/document/document-render-plan.validator';
import { DocumentRenderPlanningCapability } from './planning/document/document-render-planning.capability';
import { DocumentRenderPlanCompiler } from './compilation/document/document-render-plan.compiler';
import { DocumentRenderOutputVerifier } from './verification/document/document-render-output.verifier';

import { SpreadsheetRenderPlannerService } from './planning/spreadsheet/spreadsheet-render-planner.service';
import { SpreadsheetRenderPlanValidator } from './planning/spreadsheet/spreadsheet-render-plan.validator';
import { SpreadsheetRenderPlanNormalizer } from './planning/spreadsheet/spreadsheet-render-plan.normalizer';
import { SpreadsheetRenderPlanningCapability } from './planning/spreadsheet/spreadsheet-render-planning.capability';
import { SpreadsheetRenderOutputVerifier } from './verification/spreadsheet/spreadsheet-render-output.verifier';

import { PresentationRenderOutputVerifier } from './presentation/presentation-output.verifier';
import { PresentationContractValidator } from './presentation/presentation-contract.validator';
import { PresentationLayoutEngine } from './presentation/presentation-layout.engine';
import { PresentationAssetResolverService } from './presentation/presentation-asset-resolver.service';
import { PresentationWorkspaceStore } from './presentation/presentation-workspace.store';
import { PresentationAuthoringService } from './presentation/presentation-authoring.service';
import { PresentationSlideRasterizerService } from './presentation/presentation-slide-rasterizer.service';

import { DocxRenderTool } from './document/docx/docx-render.tool';
import { DocxRenderService } from './document/docx/docx-render.service';
import { DocxRenderMapper } from './document/docx/docx-render.mapper';
import { DocxRenderValidator } from './document/docx/docx-render.validator';
import { DocxStyleResolver } from './document/docx/docx-style.resolver';

import { XlsxRenderTool } from './spreadsheet/xlsx/xlsx-render.tool';
import { XlsxRenderService } from './spreadsheet/xlsx/xlsx-render.service';
import { XlsxExecutionValidator } from './spreadsheet/xlsx/xlsx-execution.validator';
import { XlsxMaterializationMapper } from './spreadsheet/xlsx/xlsx-materialization.mapper';

import { PdfRenderTool } from './document/pdf/pdf-render.tool';
import { PdfRenderService } from './document/pdf/pdf-render.service';
import { PptxRenderTool } from './presentation/pptx/pptx-render.tool';
import { PptxRenderService } from './presentation/pptx/pptx-render.service';
import { ZipRenderTool } from './package/zip/zip-render.tool';
import { ZipRenderService } from './package/zip/zip-render.service';

@Module({
  imports: [PrismaModule, LLMModule, RuntimeObjectModule],
  providers: [
    RenderDispatcher,
    RenderRegistry,
    RenderPipelineService,
    RenderObjectDeliveryService,
    RenderOutputCommitService,
    RenderPlanningToolRequestFactory,

    RenderPlanningRegistry,
    RenderPlanningModelService,
    RenderPlanParserService,
    RenderPlanRepairService,
    RenderPlanningOrchestrator,

    DocumentRenderPlannerService,
    DocumentRenderPlanValidator,
    DocumentRenderPlanCompiler,
    DocumentRenderOutputVerifier,
    DocumentRenderPlanningCapability,

    SpreadsheetRenderPlannerService,
    SpreadsheetRenderPlanNormalizer,
    SpreadsheetRenderPlanValidator,
    XlsxExecutionValidator,
    XlsxMaterializationMapper,
    SpreadsheetRenderOutputVerifier,
    SpreadsheetRenderPlanningCapability,

    PresentationLayoutEngine,
    PresentationContractValidator,
    PresentationAssetResolverService,
    PresentationWorkspaceStore,
    PresentationSlideRasterizerService,
    PresentationAuthoringService,
    PresentationRenderOutputVerifier,

    DocxRenderTool,
    DocxRenderService,
    DocxRenderMapper,
    DocxRenderValidator,
    DocxStyleResolver,

    XlsxRenderTool,
    XlsxRenderService,

    PdfRenderTool,
    PdfRenderService,
    PptxRenderTool,
    PptxRenderService,
    ZipRenderTool,
    ZipRenderService,
  ],
  exports: [
    RenderDispatcher,
    RenderRegistry,
    RenderPipelineService,
    RenderObjectDeliveryService,
    RenderOutputCommitService,
    RenderPlanningToolRequestFactory,
    RenderPlanningOrchestrator,
    PresentationAuthoringService,
  ],
})
export class RenderModule implements OnModuleInit {
  constructor(
    private readonly renderRegistry: RenderRegistry,
    private readonly planningRegistry: RenderPlanningRegistry,
    private readonly docx: DocxRenderTool,
    private readonly xlsx: XlsxRenderTool,
    private readonly pdf: PdfRenderTool,
    private readonly pptx: PptxRenderTool,
    private readonly zip: ZipRenderTool,
    private readonly documentPlanning: DocumentRenderPlanningCapability,
    private readonly spreadsheetPlanning: SpreadsheetRenderPlanningCapability,
  ) {}

  onModuleInit(): void {
    this.renderRegistry.register(this.docx);
    this.renderRegistry.register(this.xlsx);
    this.renderRegistry.register(this.pdf);
    this.renderRegistry.register(this.pptx);
    this.renderRegistry.register(this.zip);

    this.planningRegistry.register(this.documentPlanning);
    this.planningRegistry.register(this.spreadsheetPlanning);
  }
}
