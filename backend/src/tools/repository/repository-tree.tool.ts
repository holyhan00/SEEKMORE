
                                                       

import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';
import { RepositorySourceResolver } from './repository-source-resolver';

@Injectable()
export class RepositoryTreeTool implements Tool {
  name = 'repository.list_tree';
  version = '1.0.0';
  description = 'List files in a public source repository tree.';
  tags = ['repository', 'tree', 'source'];
  timeoutMs = 20_000;

  private readonly resolver = new RepositorySourceResolver();

  validateArgs(args: Dict): void {
    try {
      this.resolver.resolve(args);
    } catch (error) {
      throw new ToolError('REPOSITORY_LOCATOR_INVALID', error instanceof Error ? error.message : 'Repository locator is invalid.');
    }
  }

  async execute(args: Dict, _ctx: ToolContext, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new ToolError('OPERATION_ABORTED', 'Operation canceled.');
    const { locator, provider } = this.resolver.resolve(args);
    if (!provider.listTree) throw new ToolError('REPOSITORY_TREE_UNSUPPORTED', 'Repository provider does not support tree listing.');
    return provider.listTree(locator, { path: this.text(args.path), ref: this.text(args.ref ?? args.branch) }, signal);
  }

  private text(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
  }
}
