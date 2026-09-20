                                               

import { Injectable, OnModuleInit } from '@nestjs/common';
import { ToolsRegistry } from './toolsregistry';
import { RuntimeEventToolObserver } from './observers/runtime-event.tool-observer';
import { WebSearchTool } from './websearch/websearch.tool';
import { ImageGenerateTool } from './image/image-generate.tool';
import { VideoGenerateTool } from './video/video-generate.tool';
import { MusicGenerateTool } from './audio/music-generate.tool';
import { SpeechSynthesizeTool } from './audio/speech-synthesize.tool';
import { VoiceCloneTool } from './audio/voice-clone.tool';
import { VisionAnalyzeTool } from './vision/vision-analyze.tool';
import { WebReadTool } from './webread/webread.tool';
import { RepositoryInspectTool } from './repository/repository-inspect.tool';
import { RepositoryTreeTool } from './repository/repository-tree.tool';
import { RepositoryFileReadTool } from './repository/repository-file-read.tool';
import { DocumentRenderDocxRuntimeTool } from './render/tools/document-render-docx.tool';
import { DocumentRenderPdfRuntimeTool } from './render/tools/document-render-pdf.tool';
import { PackageRenderZipRuntimeTool } from './render/tools/package-render-zip.tool';
import { PresentationCreateRuntimeTool } from './render/tools/presentation-create.tool';
import { PresentationSlidesUpsertRuntimeTool } from './render/tools/presentation-slides-upsert.tool';
import { PresentationInspectRuntimeTool } from './render/tools/presentation-inspect.tool';
import { PresentationFinalizeRuntimeTool } from './render/tools/presentation-finalize.tool';
import { SpreadsheetRenderXlsxRuntimeTool } from './render/tools/spreadsheet-render-xlsx.tool';
import { WorkspaceInspectTool } from './workspace/workspace-inspect.tool';
import { FileSearchTool } from './filesystem/file-search.tool';
import { FileReadTool } from './filesystem/file-read.tool';
import { FileWriteTool } from './filesystem/file-write.tool';
import { FilePatchTool } from './filesystem/file-patch.tool';
import { FileDeleteTool } from './filesystem/file-delete.tool';
import { TerminalRunTool } from './terminal/terminal-run.tool';
import { TerminalReadTool } from './terminal/terminal-read.tool';
import { TerminalKillTool } from './terminal/terminal-kill.tool';
import { PythonExecuteTool } from './code/python-execute.tool';
import { GitStatusTool } from './code/git-status.tool';
import { GitDiffTool } from './code/git-diff.tool';
import { DocumentParseTool } from './document/document-parse.tool';
import { ObjectSearchTool } from './object/object-search.tool';
import { ObjectInspectTool } from './object/object-inspect.tool';
import { CodeProjectInspectTool } from './code-project/code-project-inspect.tool';
import { applyBuiltinToolMetadata } from './builtin-tool-metadata.registry';
import { SkillViewTool } from '../modules/agent/skill/tools/skill-view.tool';
import { SkillReadResourceTool } from '../modules/agent/skill/tools/skill-read-resource.tool';
import { SkillSearchTool } from '../modules/agent/skill/tools/skill-search.tool';
import { KnowledgeSearchTool } from '../modules/agent/knowledge/tools/knowledge-search.tool';
import { TimeTool } from './time/time.tool';
import { AutomationTool } from '../modules/automation/automation.tool';
import { McpManageTool } from './plugins/mcp-manage.tool';

@Injectable()
export class ToolsBuiltinRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: ToolsRegistry,
    private readonly observer: RuntimeEventToolObserver,
    private readonly webSearchTool: WebSearchTool,
    private readonly imageGenerateTool: ImageGenerateTool,
    private readonly videoGenerateTool: VideoGenerateTool,
    private readonly speechSynthesizeTool: SpeechSynthesizeTool,
    private readonly voiceCloneTool: VoiceCloneTool,
    private readonly musicGenerateTool: MusicGenerateTool,
    private readonly visionAnalyzeTool: VisionAnalyzeTool,
    private readonly webReadTool: WebReadTool,
    private readonly repositoryInspectTool: RepositoryInspectTool,
    private readonly repositoryTreeTool: RepositoryTreeTool,
    private readonly repositoryFileReadTool: RepositoryFileReadTool,
    private readonly documentRenderDocxTool: DocumentRenderDocxRuntimeTool,
    private readonly documentRenderPdfTool: DocumentRenderPdfRuntimeTool,
    private readonly presentationCreateTool: PresentationCreateRuntimeTool,
    private readonly presentationSlidesUpsertTool: PresentationSlidesUpsertRuntimeTool,
    private readonly presentationInspectTool: PresentationInspectRuntimeTool,
    private readonly presentationFinalizeTool: PresentationFinalizeRuntimeTool,
    private readonly packageRenderZipTool: PackageRenderZipRuntimeTool,
    private readonly spreadsheetRenderXlsxTool: SpreadsheetRenderXlsxRuntimeTool,
    private readonly workspaceInspectTool: WorkspaceInspectTool,
    private readonly fileSearchTool: FileSearchTool,
    private readonly fileReadTool: FileReadTool,
    private readonly fileWriteTool: FileWriteTool,
    private readonly filePatchTool: FilePatchTool,
    private readonly fileDeleteTool: FileDeleteTool,
    private readonly terminalRunTool: TerminalRunTool,
    private readonly terminalReadTool: TerminalReadTool,
    private readonly terminalKillTool: TerminalKillTool,
    private readonly pythonExecuteTool: PythonExecuteTool,
    private readonly gitStatusTool: GitStatusTool,
    private readonly gitDiffTool: GitDiffTool,
    private readonly documentParseTool: DocumentParseTool,
    private readonly objectSearchTool: ObjectSearchTool,
    private readonly objectInspectTool: ObjectInspectTool,
    private readonly codeProjectInspectTool: CodeProjectInspectTool,
    private readonly skillSearchTool: SkillSearchTool,
    private readonly skillViewTool: SkillViewTool,
    private readonly skillReadResourceTool: SkillReadResourceTool,
    private readonly knowledgeSearchTool: KnowledgeSearchTool,
    private readonly timeTool: TimeTool,
    private readonly automationTool: AutomationTool,
    private readonly mcpManageTool: McpManageTool,
  ) {}

  onModuleInit(): void {
    this.registry.setObserver(this.observer);

    this.registry.register(applyBuiltinToolMetadata(this.webSearchTool), {
      enabled: true,
      concurrency: 6,
      defaultTimeoutMs: 45_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.imageGenerateTool), {
      enabled: true,
      concurrency: 2,
      defaultTimeoutMs: 300_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.videoGenerateTool), {
      enabled: true,
      concurrency: 1,
      defaultTimeoutMs: 1_200_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.speechSynthesizeTool), {
      enabled: true,
      concurrency: 3,
      defaultTimeoutMs: 300_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.voiceCloneTool), {
      enabled: true,
      concurrency: 1,
      defaultTimeoutMs: 300_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.musicGenerateTool), {
      enabled: true,
      concurrency: 1,
      defaultTimeoutMs: 600_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.visionAnalyzeTool), {
      enabled: true,
      concurrency: 3,
      defaultTimeoutMs: 180_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.webReadTool), {
      enabled: true,
      concurrency: 6,
      defaultTimeoutMs: 45_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.repositoryInspectTool), {
      enabled: true,
      concurrency: 4,
      defaultTimeoutMs: 45_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.repositoryTreeTool), {
      enabled: true,
      concurrency: 4,
      defaultTimeoutMs: 45_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.repositoryFileReadTool), {
      enabled: true,
      concurrency: 4,
      defaultTimeoutMs: 45_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.documentRenderDocxTool), {
      enabled: true,
      concurrency: 3,
      defaultTimeoutMs: 180_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.spreadsheetRenderXlsxTool), {
      enabled: true,
      concurrency: 3,
      defaultTimeoutMs: 180_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.documentRenderPdfTool), {
      enabled: true,
      concurrency: 3,
      defaultTimeoutMs: 180_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.presentationCreateTool), {
      enabled: true,
      concurrency: 4,
      defaultTimeoutMs: 15_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.presentationSlidesUpsertTool), {
      enabled: true,
      concurrency: 4,
      defaultTimeoutMs: 120_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.presentationInspectTool), {
      enabled: true,
      concurrency: 4,
      defaultTimeoutMs: 60_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.presentationFinalizeTool), {
      enabled: true,
      concurrency: 2,
      defaultTimeoutMs: 180_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.packageRenderZipTool), {
      enabled: true,
      concurrency: 3,
      defaultTimeoutMs: 60_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.workspaceInspectTool), {
      enabled: true,
      concurrency: 4,
      defaultTimeoutMs: 15_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.fileSearchTool), {
      enabled: true,
      concurrency: 4,
      defaultTimeoutMs: 20_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.fileReadTool), {
      enabled: true,
      concurrency: 8,
      defaultTimeoutMs: 15_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.fileWriteTool), {
      enabled: true,
      concurrency: 3,
      defaultTimeoutMs: 20_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.filePatchTool), {
      enabled: true,
      concurrency: 3,
      defaultTimeoutMs: 20_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.fileDeleteTool), {
      enabled: true,
      concurrency: 2,
      defaultTimeoutMs: 20_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.terminalRunTool), {
      enabled: true,
      concurrency: 2,
      defaultTimeoutMs: 120_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.terminalReadTool), {
      enabled: true,
      concurrency: 8,
      defaultTimeoutMs: 5_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.terminalKillTool), {
      enabled: true,
      concurrency: 8,
      defaultTimeoutMs: 5_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.pythonExecuteTool), {
      enabled: true,
      concurrency: 2,
      defaultTimeoutMs: 120_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.gitStatusTool), {
      enabled: true,
      concurrency: 4,
      defaultTimeoutMs: 10_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.gitDiffTool), {
      enabled: true,
      concurrency: 4,
      defaultTimeoutMs: 15_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.documentParseTool), {
      enabled: true,
      concurrency: 2,
      defaultTimeoutMs: 60_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.objectSearchTool), {
      enabled: true,
      concurrency: 8,
      defaultTimeoutMs: 10_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.objectInspectTool), {
      enabled: true,
      concurrency: 8,
      defaultTimeoutMs: 10_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.codeProjectInspectTool), {
      enabled: true,
      concurrency: 2,
      defaultTimeoutMs: 90_000,
    });


    this.registry.register(applyBuiltinToolMetadata(this.skillSearchTool), {
      enabled: true,
      concurrency: 16,
      defaultTimeoutMs: 30_000,
    });
    this.registry.register(applyBuiltinToolMetadata(this.skillViewTool), {
      enabled: true,
      concurrency: 16,
      defaultTimeoutMs: 30_000,
    });
    this.registry.register(applyBuiltinToolMetadata(this.skillReadResourceTool), {
      enabled: true,
      concurrency: 16,
      defaultTimeoutMs: 30_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.knowledgeSearchTool), {
      enabled: true,
      concurrency: 8,
      defaultTimeoutMs: 45_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.timeTool), {
      enabled: true,
      concurrency: 8,
      defaultTimeoutMs: 10_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.automationTool), {
      enabled: true,
      concurrency: 8,
      defaultTimeoutMs: 10_000,
    });

    this.registry.register(applyBuiltinToolMetadata(this.mcpManageTool), {
      enabled: true,
      concurrency: 2,
      defaultTimeoutMs: 120_000,
    });
  }
}
