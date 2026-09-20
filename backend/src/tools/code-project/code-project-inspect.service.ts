import { Injectable } from '@nestjs/common';
import { CodeDependencyGraphService } from './code-dependency-graph.service';
import { CodeProjectScannerService } from './code-project-scanner.service';
import { CodeSymbolExtractorService } from './code-symbol-extractor.service';
import type { CodeProjectInspectResult } from './code-project.types';

@Injectable()
export class CodeProjectInspectService {
  constructor(
    private readonly scanner: CodeProjectScannerService,
    private readonly symbols: CodeSymbolExtractorService,
    private readonly dependencies: CodeDependencyGraphService,
  ) {}

  async inspect(input: { objectId: string; extractedRoot: string; manifest: import('./archive-manifest.types').ArchiveManifest }): Promise<CodeProjectInspectResult> {
    const scanned = await this.scanner.scan({ extractedRoot: input.extractedRoot, manifest: input.manifest });
    const symbols = this.symbols.extract(scanned.objects);
    const dependencies = this.dependencies.build(scanned.objects);
    const sourceCount = scanned.objects.filter((file) => file.role === 'source').length;
    const testCount = scanned.objects.filter((file) => file.role === 'test').length;
    const manifests = scanned.objects.filter((file) => file.role === 'manifest').map((file) => file.path).slice(0, 20);
    return {
      objectId: input.objectId,
      projectKind: scanned.projectKind,
      languages: scanned.languageSet,
      summary: `${scanned.projectKind} project with ${scanned.objects.length} indexed files, ${sourceCount} source files, ${testCount} test files, ${symbols.length} symbols, and ${dependencies.length} dependency edges.`,
      manifests,
      files: scanned.objects.map(({ content: _content, ...file }) => file),
      symbols,
      dependencies,
      warnings: scanned.warnings,
      limits: {
        filesTruncated: scanned.warnings.includes('code_project_file_limit_reached'),
        fileContentsTruncated: scanned.warnings.some((warning) => warning.startsWith('code_file_truncated:')),
      },
    };
  }
}
