                                                          

import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';
import { RepositorySourceResolver } from './repository-source-resolver';

@Injectable()
export class RepositoryInspectTool implements Tool {
  name = 'repository.inspect';
  version = '1.0.0';
  description = 'Inspect a public source repository and return metadata, README content, and source citation.';
  tags = ['repository', 'inspect', 'source'];
  timeoutMs = 20_000;

  inputSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      url: { type: 'string' },
      owner: { type: 'string' },
      repo: { type: 'string' },
      ref: { type: 'string' },
    },
  };

  private readonly resolver = new RepositorySourceResolver();

  validateArgs(args: Dict): void {
    try {
      this.resolver.resolve(args);
    } catch (error) {
      throw new ToolError(
        'REPOSITORY_LOCATOR_INVALID',
        error instanceof Error ? error.message : 'Repository locator is invalid.',
      );
    }
  }

  async execute(args: Dict, _ctx: ToolContext, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) {
      throw new ToolError('OPERATION_ABORTED', 'Operation canceled.');
    }

    try {
      const { locator, provider } = this.resolver.resolve(args);
      const output = await provider.inspect(locator, signal);

      if (!output || typeof output !== 'object') {
        throw new ToolError(
          'REPOSITORY_INSPECT_EMPTY',
          'Repository inspection returned no structured output.',
        );
      }

      return output;
    } catch (error) {
      if (error instanceof ToolError) throw error;

      throw new ToolError(
        'REPOSITORY_INSPECT_FAILED',
        error instanceof Error ? error.message : 'Repository inspection failed.',
      );
    }
  }
}