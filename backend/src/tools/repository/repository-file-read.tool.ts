
                                                            

import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';
import { RepositorySourceResolver } from './repository-source-resolver';

@Injectable()
export class RepositoryFileReadTool implements Tool {
  name = 'repository.read_file';
  version = '1.0.0';
  description = 'Read a file from a public source repository.';
  tags = ['repository', 'file', 'source'];
  timeoutMs = 20_000;

  private readonly resolver = new RepositorySourceResolver();

  validateArgs(args: Dict): void {
    const path = this.text(args.path);
    const resolved = this.resolver.resolve(args);
    if (!path && !resolved.locator.path) throw new ToolError('REPOSITORY_PATH_REQUIRED', 'Repository file path is required.');
  }

  async execute(args: Dict, _ctx: ToolContext, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new ToolError('OPERATION_ABORTED', 'Operation canceled.');
    const { locator, provider } = this.resolver.resolve(args);
    if (!provider.readFile) throw new ToolError('REPOSITORY_FILE_UNSUPPORTED', 'Repository provider does not support file reading.');
    return provider.readFile(locator, { path: this.text(args.path), ref: this.text(args.ref ?? args.branch) }, signal);
  }

  private text(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
  }
}
