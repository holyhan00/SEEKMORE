import type { ArchiveManifest } from './archive-manifest.types';

export type CodeProjectKind = 'nestjs' | 'react' | 'vite' | 'node' | 'python' | 'java' | 'go' | 'rust' | 'php' | 'unknown';

export interface CodeProjectScanFile {
  path: string;
  language: string;
  role: 'source' | 'test' | 'config' | 'manifest' | 'docs' | 'generated' | 'unknown';
  sizeBytes: number;
  lineCount: number;
  content: string;
  hash?: string | null;
}

export interface CodeSymbolProfile {
  name: string;
  kind: 'class' | 'function' | 'method' | 'interface' | 'type' | 'enum' | 'const' | 'controller' | 'service' | 'module' | 'hook' | 'component' | 'variable' | 'unknown';
  filePath: string;
  lineStart: number;
  lineEnd: number;
  signature: string;
  exported: boolean;
  metadata?: Record<string, unknown>;
}

export interface CodeDependencyEdge {
  fromPath: string;
  to: string;
  importText: string;
  resolvedPath?: string | null;
  kind: 'import' | 'require' | 'dynamic_import' | 'unknown';
}

export interface CodeProjectIndexInput {
  archiveObjectId: string;
  extractedRoot: string;
  manifest: ArchiveManifest;
}

export interface CodeProjectIndexResult {
  archiveObjectId: string;
  projectKind: CodeProjectKind;
  languageSet: string[];
  objects: CodeProjectScanFile[];
  symbols: CodeSymbolProfile[];
  dependencies: CodeDependencyEdge[];
  summary: string;
  warnings: string[];
}

export interface CodeProjectInspectResult {
  objectId: string;
  projectKind: CodeProjectKind;
  languages: string[];
  summary: string;
  manifests: string[];
  files: Array<Omit<CodeProjectScanFile, 'content'>>;
  symbols: CodeSymbolProfile[];
  dependencies: CodeDependencyEdge[];
  warnings: string[];
  limits: {
    filesTruncated: boolean;
    fileContentsTruncated: boolean;
  };
}
