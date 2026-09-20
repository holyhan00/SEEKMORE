                                                
                                                                                                          

import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { RenderRegistry } from './render.registry';
import {
  RenderDispatchResult,
  RenderRequest,
  RenderToolName,
} from './render.types';

@Injectable()
export class RenderDispatcher {
  private readonly logger = new Logger(RenderDispatcher.name);

  constructor(private readonly registry: RenderRegistry) {}

  listTools() {
    return this.registry.listEnabled();
  }

  health() {
    return this.registry.health();
  }

  async render(request: RenderRequest): Promise<RenderDispatchResult> {
    const startedAt = Date.now();

    this.validateRequest(request);

    const toolName = request.toolName as RenderToolName;
    const tool = this.registry.resolve(toolName);

    if (!tool.canHandle(request)) {
      throw new BadRequestException({
        code: 'RENDER_TOOL_CANNOT_HANDLE_REQUEST',
        message: `render tool cannot handle request: ${request.toolName}`,
        params: { toolName: request.toolName },
      });
    }

    this.logger.log(
      [
        '[RenderDispatcher] render start',
        `tool=${request.toolName}`,
        `user=${request.userId ?? '-'}`,
        `conv=${request.conversationId ?? '-'}`,
        `req=${request.requestId ?? '-'}`,
        `source=${request.source ?? '-'}`,
      ].join(' '),
    );

    const artifact = await tool.render(request as never);
    const durationMs = Date.now() - startedAt;

    const artifactWithUrl = {
      ...artifact,
      url: artifact.url ?? artifact.publicUrl ?? artifact.relativeUrl ?? null,
    };

    this.logger.log(
      [
        '[RenderDispatcher] render done',
        `tool=${request.toolName}`,
        `artifact=${artifact.artifactId ?? 'pending'}`,
        `file=${artifact.filename}`,
        `bufferBytes=${Buffer.isBuffer(artifact.buffer) ? artifact.buffer.byteLength : 0}`,
        `size=${artifact.sizeBytes ?? 'pending'}`,
        `duration=${durationMs}ms`,
      ].join(' '),
    );

    return {
      ok: true,
      artifact: artifactWithUrl,
      tool: tool.descriptor,
      meta: {
        toolName,
        durationMs,
        requestId: request.requestId,
        conversationId: request.conversationId,
        userId: request.userId,
        source: request.source,
      },
    };
  }

  private validateRequest(request: RenderRequest): void {
    if (!request || typeof request !== 'object') {
      throw new BadRequestException({ code: 'RENDER_REQUEST_OBJECT_REQUIRED', message: 'render request must be an object' });
    }

    if (!request.toolName) {
      throw new BadRequestException({ code: 'RENDER_TOOL_NAME_REQUIRED', message: 'render request missing toolName' });
    }

    if (!request.payload || typeof request.payload !== 'object') {
      throw new BadRequestException({ code: 'RENDER_PAYLOAD_OBJECT_REQUIRED', message: 'render request payload must be an object' });
    }

    if (Array.isArray(request.payload)) {
      throw new BadRequestException({ code: 'RENDER_PAYLOAD_ARRAY_FORBIDDEN', message: 'render request payload cannot be an array' });
    }

    if (
      request.filename != null &&
      typeof request.filename !== 'string'
    ) {
      throw new BadRequestException({ code: 'RENDER_FILENAME_STRING_REQUIRED', message: 'render request filename must be a string' });
    }

    if (
      request.title != null &&
      typeof request.title !== 'string'
    ) {
      throw new BadRequestException({ code: 'RENDER_TITLE_STRING_REQUIRED', message: 'render request title must be a string' });
    }

    if (
      request.meta != null &&
      (typeof request.meta !== 'object' || Array.isArray(request.meta))
    ) {
      throw new BadRequestException({ code: 'RENDER_META_OBJECT_REQUIRED', message: 'render request meta must be an object' });
    }
  }
}