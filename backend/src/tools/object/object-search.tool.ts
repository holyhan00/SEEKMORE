import { Injectable } from '@nestjs/common';
import { RuntimeObjectService } from '../../modules/object-runtime/object/object.service';
import type { ObjectKind, RuntimeObjectOriginType } from '../../modules/object-runtime/object/object.types';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { objectToolPartition } from './object-tool-context';

@Injectable()
export class ObjectSearchTool implements Tool {
  name = 'object.search';
  version = '1.1.0';
  description = 'Search existing RuntimeObjects referenced on the current message branch, including user-uploaded objects and previously generated outputs, by filename or searchable metadata. Reuse an existing relevant object when the user refers to something provided or created earlier instead of recreating an equivalent object. This tool never reads file contents.';
  tags = ['object', 'catalog', 'search', 'reuse'];
  timeoutMs = 10_000;
  maxOutputBytes = 256 * 1024;
  requiredSurfaces: NonNullable<Tool['requiredSurfaces']> = ['conversation'];
  parallelism: NonNullable<Tool['parallelism']> = 'parallel_safe';
  supportsAbort = false;
  latencyClass: NonNullable<Tool['latencyClass']> = 'instant';

  inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', maxLength: 240, description: 'Optional filename or searchable metadata text.' },
      objectKind: {
        type: 'string',
        enum: ['document', 'spreadsheet', 'presentation', 'pdf', 'html', 'markdown', 'text', 'image', 'audio', 'video', 'archive', 'code', 'binary', 'unknown'],
      },
      originType: {
        type: 'string',
        enum: ['user_upload', 'runtime_generated'],
        description: 'Optional source filter for user-uploaded or runtime-generated objects.',
      },
      extension: { type: 'string', maxLength: 32, description: 'Optional extension without a leading dot.' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      cursor: { type: 'string', maxLength: 180 },
    },
    additionalProperties: false,
  };

  outputSchema = {
    type: 'object',
    required: ['objects', 'nextCursor'],
    properties: {
      objects: { type: 'array' },
      nextCursor: { type: ['string', 'null'] },
    },
    additionalProperties: false,
  };

  constructor(private readonly objects: RuntimeObjectService) {}

  execute(args: Dict, ctx: ToolContext) {
    const partition = objectToolPartition(ctx);
    const branchObjectIds = Array.isArray(ctx.metadata?.branchObjectIds)
      ? [...new Set(ctx.metadata.branchObjectIds.map((value) => String(value ?? '').trim()).filter(Boolean))]
      : undefined;
    return this.objects.search({
      ...partition,
      ...(branchObjectIds ? { objectIds: branchObjectIds } : {}),
      query: this.optionalString(args.query),
      objectKind: this.optionalString(args.objectKind) as ObjectKind | null,
      originType: this.optionalString(args.originType) as RuntimeObjectOriginType | null,
      extension: this.optionalString(args.extension),
      cursor: this.optionalString(args.cursor),
      limit: this.limit(args.limit),
    });
  }

  private optionalString(value: unknown): string | null {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || null;
  }

  private limit(value: unknown): number {
    const numeric = Number(value ?? 20);
    return Number.isFinite(numeric) ? Math.max(1, Math.min(Math.floor(numeric), 50)) : 20;
  }
}
