import { Injectable } from '@nestjs/common';
import { RuntimeObjectService } from '../../modules/object-runtime/object/object.service';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';
import { objectToolPartition } from './object-tool-context';

@Injectable()
export class ObjectInspectTool implements Tool {
  name = 'object.inspect';
  version = '1.1.0';
  description = 'Inspect metadata for one existing RuntimeObject in the current user, agent, and conversation partition. The object may be user-uploaded or previously generated. This tool does not parse file contents.';
  tags = ['object', 'catalog', 'inspect'];
  timeoutMs = 10_000;
  maxOutputBytes = 64 * 1024;
  requiredSurfaces: NonNullable<Tool['requiredSurfaces']> = ['conversation'];
  parallelism: NonNullable<Tool['parallelism']> = 'parallel_safe';
  supportsAbort = false;
  latencyClass: NonNullable<Tool['latencyClass']> = 'instant';

  inputSchema = {
    type: 'object',
    required: ['objectId'],
    properties: {
      objectId: { type: 'string', minLength: 1, maxLength: 180 },
    },
    additionalProperties: false,
  };

  outputSchema = {
    type: 'object',
    required: ['objectId', 'agentId', 'conversationId', 'originalName', 'displayName', 'objectKind', 'originType', 'visibility', 'extension', 'mimeType', 'sizeBytes', 'contentHash', 'versionNo', 'status', 'downloadUrl', 'createdAt', 'updatedAt'],
    properties: {
      objectId: { type: 'string' },
      agentId: { type: 'string' },
      conversationId: { type: 'string' },
      originalName: { type: 'string' },
      displayName: { type: 'string' },
      objectKind: { type: 'string' },
      originType: { type: 'string' },
      visibility: { type: 'string' },
      generationIntent: { type: ['string', 'null'] },
      extension: { type: 'string' },
      mimeType: { type: 'string' },
      sizeBytes: { type: 'integer', minimum: 0 },
      contentHash: { type: 'string' },
      versionNo: { type: 'integer', minimum: 0 },
      status: { type: 'string' },
      downloadUrl: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
    additionalProperties: false,
  };

  constructor(private readonly objects: RuntimeObjectService) {}

  execute(args: Dict, ctx: ToolContext) {
    const objectId = String(args.objectId ?? '').trim();
    if (!objectId) throw new ToolError('OBJECT_ID_REQUIRED', 'object.inspect requires objectId');
    return this.objects.inspectCard(objectToolPartition(ctx), objectId);
  }
}
