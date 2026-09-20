import { Injectable } from '@nestjs/common';
import * as path from 'path';
import type { CodeDependencyEdge, CodeProjectScanFile } from './code-project.types';

@Injectable()
export class CodeDependencyGraphService {
  build(objects: CodeProjectScanFile[]): CodeDependencyEdge[] {
    const filePathSet = new Set(objects.map((file) => file.path));
    const edges: CodeDependencyEdge[] = [];
    for (const file of objects) {
      const lines = file.content.split(/\r?\n/);
      for (const line of lines) {
        const edge = this.edgeFromLine(file.path, line, filePathSet);
        if (edge) edges.push(edge);
      }
    }
    return edges.slice(0, Number(process.env.CODE_PROJECT_MAX_DEPENDENCY_EDGES ?? 10000));
  }

  private edgeFromLine(fromPath: string, line: string, filePathSet: Set<string>): CodeDependencyEdge | null {
    const trimmed = line.trim();
    const importMatch = trimmed.match(/^import\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]/);
    const requireMatch = trimmed.match(/require\(['"]([^'"]+)['"]\)/);
    const dynamicMatch = trimmed.match(/import\(['"]([^'"]+)['"]\)/);
    const target = importMatch?.[1] ?? requireMatch?.[1] ?? dynamicMatch?.[1];
    if (!target) return null;
    return {
      fromPath,
      to: target,
      importText: trimmed.slice(0, 300),
      resolvedPath: this.resolveRelative(fromPath, target, filePathSet),
      kind: importMatch ? 'import' : requireMatch ? 'require' : dynamicMatch ? 'dynamic_import' : 'unknown',
    };
  }

  private resolveRelative(fromPath: string, target: string, filePathSet: Set<string>): string | null {
    if (!target.startsWith('.')) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), target));
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.vue`, path.posix.join(base, 'index.ts'), path.posix.join(base, 'index.tsx'), path.posix.join(base, 'index.js'), path.posix.join(base, 'index.jsx')];
    return candidates.find((candidate) => filePathSet.has(candidate)) ?? null;
  }
}
