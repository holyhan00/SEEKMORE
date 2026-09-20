import { BadRequestException, Injectable } from '@nestjs/common';
import type { Dict } from '../../toolstypes';
import type { RenderPlanFormat, RenderPlanKind, RenderPlanningRequest } from '../planning/core/render-plan.types';
import {
  firstRenderSourcePlaceholder,
  isRecord,
  nonEmptyString,
  stringArray,
} from '../planning/core/render-plan.util';

@Injectable()
export class RenderPlanningToolRequestFactory {
  build(
    kind: RenderPlanKind,
    format: RenderPlanFormat,
    args: Dict,
  ): RenderPlanningRequest {
    this.validate(args);
    const source = isRecord(args.source) ? args.source : {};
    const requirements = isRecord(args.requirements) ? args.requirements : {};
    const sourceBlocks = Array.isArray(source.blocks)
      ? source.blocks
      : undefined;
    const placeholder = firstRenderSourcePlaceholder(sourceBlocks);

    if (placeholder) {
      throw new BadRequestException({
        code: 'RENDER_SOURCE_PLACEHOLDER_NOT_ALLOWED',
        message: 'Render source blocks must contain the real final content, not block placeholders.',
        path: placeholder.path,
      });
    }

    return {
      kind,
      plan: isRecord(args.plan)
        ? args.plan as unknown as import('../planning/core/render-plan.types').RenderPlanBase
        : undefined,
      instruction: nonEmptyString(args.instruction) ?? 'Execute the supplied render plan.',
      source: {
        content: nonEmptyString(source.content),
        markdown: nonEmptyString(source.markdown),
        data: source.data,
        blocks: sourceBlocks,
        references: Array.isArray(source.references) ? source.references : undefined,
        assets: Array.isArray(source.assets) ? source.assets : undefined,
      },
      requirements: {
        content: stringArray(requirements.content),
        layout: stringArray(requirements.layout),
        style: stringArray(requirements.style),
        forbidden: stringArray(requirements.forbidden),
      },
      output: {
        format,
        filename: nonEmptyString(args.filename),
      },
      context: {
        locale: nonEmptyString(args.locale),
        audience: nonEmptyString(args.audience),
        usage: nonEmptyString(args.usage),
      },
      meta: isRecord(args.meta) ? args.meta : undefined,
    };
  }

  validate(args: Dict): void {
    if (!isRecord(args)) throw new BadRequestException({ code: 'RENDER_PLANNING_ARGS_OBJECT_REQUIRED', message: 'Render planning args must be an object' });
    if (!nonEmptyString(args.instruction) && !isRecord(args.plan)) {
      throw new BadRequestException({ code: 'RENDER_INSTRUCTION_OR_PLAN_REQUIRED', message: 'Render requires either instruction or plan' });
    }
    if (args.source != null && !isRecord(args.source)) {
      throw new BadRequestException({ code: 'RENDER_SOURCE_OBJECT_REQUIRED', message: 'source must be an object' });
    }
    if (args.requirements != null && !isRecord(args.requirements)) {
      throw new BadRequestException({ code: 'RENDER_REQUIREMENTS_OBJECT_REQUIRED', message: 'requirements must be an object' });
    }
    if (Object.prototype.hasOwnProperty.call(args, 'output')) {
      throw new BadRequestException({
        code: 'RENDER_OUTPUT_FIELD_UNSUPPORTED',
        message: 'Render output target is fixed to the Object Catalog; the output field is not supported.',
      });
    }
  }
}

export function renderPlanningToolInputSchema(format: RenderPlanFormat): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    anyOf: [{ required: ['instruction'] }, { required: ['plan'] }],
    properties: {
      plan: { type: 'object', description: 'Optional complete RenderPlan. When supplied, planning is skipped.' },
      instruction: {
        type: 'string',
        minLength: 1,
        description: 'Complete output goal. Include what must be created and any important constraints.',
      },
      source: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string' },
          markdown: { type: 'string' },
          data: {},
          blocks: { type: 'array' },
          references: { type: 'array' },
          assets: { type: 'array' },
        },
        description: 'Grounded source material already collected or written by the agent.',
      },
      requirements: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'array', items: { type: 'string' } },
          layout: { type: 'array', items: { type: 'string' } },
          style: { type: 'array', items: { type: 'string' } },
          forbidden: { type: 'array', items: { type: 'string' } },
        },
      },
      filename: { type: 'string', description: `Optional output filename ending in .${format}.` },
      audience: { type: 'string' },
      usage: { type: 'string' },
      locale: { type: 'string' },
      meta: { type: 'object' },
    },
  };
}
