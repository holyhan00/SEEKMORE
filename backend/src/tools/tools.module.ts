                                    

import { Module } from '@nestjs/common';
import { ToolsController } from './tools.controller';
import { ToolsCoreModule } from './tools.core.module';

import { RuntimeEventsModule } from '../modules/chat/runtime-events/runtime-events.module';
import { DocumentParserModule } from '../modules/document-parser/document-parser.module';
import { ObjectRuntimeModule } from '../modules/object-runtime/object-runtime.module';
import { MediaAiModule } from '../modules/media-ai/media-ai.module';
import { WebSearchSettingsModule } from '../modules/web-search-settings/web-search-settings.module';
import { SkillModule } from '../modules/agent/skill/skill.module';
import { KnowledgeModule } from '../modules/agent/knowledge/knowledge.module';
import { TimeModule } from './time/time.module';
import { AutomationModule } from '../modules/automation/automation.module';

import { SerperProvider } from './websearch/serper.provider';
import { WebSearchTool } from './websearch/websearch.tool';
import { WebSearchProviderRegistry } from './websearch/websearch-provider.registry';
import { ImageGenerateTool } from './image/image-generate.tool';
import { VideoGenerateTool } from './video/video-generate.tool';
import { MusicGenerateTool } from './audio/music-generate.tool';
import { SpeechSynthesizeTool } from './audio/speech-synthesize.tool';
import { VoiceCloneTool } from './audio/voice-clone.tool';
import { VisionAnalyzeTool } from './vision/vision-analyze.tool';
import { WebReadProvider } from './webread/webread.provider';
import { WebReadTool } from './webread/webread.tool';
import { RepositoryInspectTool } from './repository/repository-inspect.tool';
import { RepositoryTreeTool } from './repository/repository-tree.tool';
import { RepositoryFileReadTool } from './repository/repository-file-read.tool';
import { RenderModule } from './render/render.module';
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
import { TerminalSessionStore } from './terminal/terminal-session.store';
import { TerminalPolicyService } from './terminal/terminal-policy.service';
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
import { CodeProjectArchiveService } from './code-project/code-project-archive.service';
import { CodeProjectInspectService } from './code-project/code-project-inspect.service';
import { CodeProjectScannerService } from './code-project/code-project-scanner.service';
import { CodeSymbolExtractorService } from './code-project/code-symbol-extractor.service';
import { CodeDependencyGraphService } from './code-project/code-dependency-graph.service';
import { RuntimeCancellationModule } from '../modules/runtime-cancellation/runtime-cancellation.module';
import { McpRuntimeModule } from '../modules/mcp/mcp-runtime.module';
import { McpManageTool } from './plugins/mcp-manage.tool';

import { ToolsBuiltinRegistrar } from './tools.builtin.registrar';

@Module({
  imports: [
    ToolsCoreModule,
    RuntimeEventsModule,
    RenderModule,
    DocumentParserModule,
    ObjectRuntimeModule,
    MediaAiModule,
    WebSearchSettingsModule,
    SkillModule,
    KnowledgeModule,
    TimeModule,
    AutomationModule,
    RuntimeCancellationModule,
    McpRuntimeModule,
  ],
  controllers: [ToolsController],
  providers: [
    SerperProvider,
    WebSearchProviderRegistry,
    WebSearchTool,
    ImageGenerateTool,
    VideoGenerateTool,
    MusicGenerateTool,
    SpeechSynthesizeTool,
    VoiceCloneTool,
    VisionAnalyzeTool,
    WebReadProvider,
    WebReadTool,
    RepositoryInspectTool,
    RepositoryTreeTool,
    RepositoryFileReadTool,
    DocumentRenderDocxRuntimeTool,
    DocumentRenderPdfRuntimeTool,
    PresentationCreateRuntimeTool,
    PresentationSlidesUpsertRuntimeTool,
    PresentationInspectRuntimeTool,
    PresentationFinalizeRuntimeTool,
    PackageRenderZipRuntimeTool,
    SpreadsheetRenderXlsxRuntimeTool,
    WorkspaceInspectTool,
    FileSearchTool,
    FileReadTool,
    FileWriteTool,
    FilePatchTool,
    FileDeleteTool,
    TerminalSessionStore,
    TerminalPolicyService,
    TerminalRunTool,
    TerminalReadTool,
    TerminalKillTool,
    PythonExecuteTool,
    GitStatusTool,
    GitDiffTool,
    DocumentParseTool,
    ObjectSearchTool,
    ObjectInspectTool,
    CodeProjectArchiveService,
    CodeProjectInspectService,
    CodeProjectScannerService,
    CodeSymbolExtractorService,
    CodeDependencyGraphService,
    CodeProjectInspectTool,
    McpManageTool,
    ToolsBuiltinRegistrar,
  ],
  exports: [
    TerminalSessionStore,
    ToolsCoreModule,
    WebSearchTool,
    ImageGenerateTool,
    VideoGenerateTool,
    MusicGenerateTool,
    SpeechSynthesizeTool,
    VoiceCloneTool,
    VisionAnalyzeTool,
    WebReadTool,
    RepositoryInspectTool,
    RepositoryTreeTool,
    RepositoryFileReadTool,
    DocumentRenderDocxRuntimeTool,
    DocumentRenderPdfRuntimeTool,
    PresentationCreateRuntimeTool,
    PresentationSlidesUpsertRuntimeTool,
    PresentationInspectRuntimeTool,
    PresentationFinalizeRuntimeTool,
    PackageRenderZipRuntimeTool,
    SpreadsheetRenderXlsxRuntimeTool,
    WorkspaceInspectTool,
    FileSearchTool,
    FileReadTool,
    FileWriteTool,
    FilePatchTool,
    FileDeleteTool,
    TerminalRunTool,
    TerminalReadTool,
    TerminalKillTool,
    PythonExecuteTool,
    GitStatusTool,
    GitDiffTool,
    DocumentParseTool,
    ObjectSearchTool,
    ObjectInspectTool,
    CodeProjectInspectTool,
    McpManageTool,
  ],
})
export class ToolsModule {}
