import { Injectable } from '@nestjs/common';
import { RuntimeObjectService } from '../../modules/object-runtime/object/object.service';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';
import { objectToolPartition } from '../object/object-tool-context';
import { CodeProjectArchiveService } from './code-project-archive.service';
import { CodeProjectInspectService } from './code-project-inspect.service';

@Injectable()
export class CodeProjectInspectTool implements Tool {
  name = 'code_project.inspect';
  version = '1.0.0';
  description = 'Inspect an uploaded ZIP code project in the current user, agent, and conversation partition. Returns a bounded project map, languages, manifests, symbols, and dependency edges; use file.read for specific workspace files.';
  tags = ['code', 'project', 'archive', 'inspect'];
  timeoutMs = 90_000;
  maxOutputBytes = 2 * 1024 * 1024;
  requiredSurfaces: NonNullable<Tool['requiredSurfaces']> = ['conversation'];
  parallelism: NonNullable<Tool['parallelism']> = 'resource_serial';
  conflictKeyFields = ['objectId'];
  supportsAbort = false;
  latencyClass: NonNullable<Tool['latencyClass']> = 'long';

  inputSchema = {
    type: 'object',
    required: ['objectId'],
    properties: { objectId: { type: 'string', minLength: 1, maxLength: 180 } },
    additionalProperties: false,
  };

  constructor(
    private readonly objects: RuntimeObjectService,
    private readonly archives: CodeProjectArchiveService,
    private readonly inspector: CodeProjectInspectService,
  ) {}

  async execute(args: Dict, ctx: ToolContext) {
    const objectId = String(args.objectId ?? '').trim();
    if (!objectId) throw new ToolError('CODE_PROJECT_OBJECT_ID_REQUIRED', 'code_project.inspect requires objectId');
    const partition = objectToolPartition(ctx);
    const { object, buffer } = await this.objects.readBuffer(partition, objectId, Number(process.env.CODE_PROJECT_MAX_ARCHIVE_BYTES ?? 100 * 1024 * 1024));
    if (object.objectKind !== 'archive' && String(object.extension).toLowerCase() !== 'zip') {
      throw new ToolError('CODE_PROJECT_OBJECT_UNSUPPORTED', 'code_project.inspect requires an uploaded ZIP archive');
    }
    return this.archives.withExtractedProject({ objectId, fileName: object.originalName, buffer }, (root, manifest) =>
      this.inspector.inspect({ objectId, extractedRoot: root, manifest }),
    );
  }
}
