                                                            
import { BadRequestException, Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../../toolstypes';
import { RenderOutputCommitService } from '../delivery/render-output-commit.service';
import { RenderDispatcher } from '../render.dispatcher';
import type { RenderPayload } from '../render.types';
import {
  isRecord,
  nonEmptyString,
} from '../planning/core/render-plan.util';

@Injectable()
export class PackageRenderZipRuntimeTool implements Tool {
  name = 'package.render.zip';
  version = '2.0.0';

  description =
    'Validate, package, verify, and persist a ZIP archive from an explicit file manifest. This tool does not use RenderPlan.';

  tags = ['render', 'package', 'zip', 'artifact'];
  timeoutMs = 120_000;

  inputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['files'],
    properties: {
      filename: {
        type: 'string',
      },
      files: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
        },
      },
      title: {
        type: 'string',
      },
      meta: {
        type: 'object',
      },
    },
  };

  constructor(
    private readonly dispatcher: RenderDispatcher,
    private readonly delivery: RenderOutputCommitService,
  ) {}

  validateArgs(args: Dict): void {
    if (!isRecord(args)) {
      throw new BadRequestException({ code: 'ZIP_ARGS_OBJECT_REQUIRED', message: 'ZIP args must be an object' });
    }

    if (
      !Array.isArray(args.files) ||
      args.files.length === 0
    ) {
      throw new BadRequestException({ code: 'ZIP_FILES_REQUIRED', message: 'ZIP requires files' });
    }

    if (Object.prototype.hasOwnProperty.call(args, 'output')) {
      throw new BadRequestException({
        code: 'RENDER_OUTPUT_FIELD_UNSUPPORTED',
        message: 'ZIP output target is fixed to the Object Catalog; the output field is not supported.',
      });
    }
  }

  async canExecute(ctx: ToolContext): Promise<boolean> {
    return Boolean(ctx?.userId);
  }

  async execute(
    args: Dict,
    ctx: ToolContext,
  ) {
    const payload: RenderPayload = {
      files: args.files,
      title: nonEmptyString(args.title),
    };

    const result = await this.dispatcher.render({
      toolName: 'package.render.zip',
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      requestId: ctx.requestId,
      source:
        typeof ctx.metadata?.source === 'string'
          ? ctx.metadata.source
          : 'agent',
      filename: nonEmptyString(args.filename),
      title: nonEmptyString(args.title),
      payload,
      meta: isRecord(args.meta)
        ? args.meta
        : undefined,
    });

    return this.delivery.persist({
      artifact: result.artifact,
      context: ctx,
      filename:
        nonEmptyString(args.filename) ??
        result.artifact.filename,
      tool: result.tool,
      meta: result.meta,
    });
  }

}
