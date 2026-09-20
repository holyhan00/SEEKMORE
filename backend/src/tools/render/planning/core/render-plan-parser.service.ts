import { Injectable } from '@nestjs/common';
import { failure, success, type RenderStageResult } from './render-plan-diagnostics.types';
import { isRecord } from './render-plan.util';

@Injectable()
export class RenderPlanParserService {
  parse(raw: unknown): RenderStageResult<Record<string, unknown>> {
    if (isRecord(raw)) return success(raw);
    if (typeof raw !== 'string' || !raw.trim()) {
      return failure([{
        stage: 'parsing',
        code: 'RENDER_PLAN_EMPTY_RESPONSE',
        message: 'Planning model returned no JSON content.',
        severity: 'error',
        repairable: true,
      }]);
    }

    const extracted = this.extractJsonObject(raw);
    if (!extracted) {
      return failure([{
        stage: 'parsing',
        code: 'RENDER_PLAN_JSON_NOT_FOUND',
        message: 'No complete JSON object was found in the planning response.',
        severity: 'error',
        repairable: true,
      }]);
    }

    try {
      const parsed = JSON.parse(extracted);
      if (!isRecord(parsed)) throw new Error('root must be an object');
      return success(parsed);
    } catch (error) {
      return failure([{
        stage: 'parsing',
        code: 'RENDER_PLAN_JSON_INVALID',
        message: error instanceof Error ? error.message : String(error),
        severity: 'error',
        repairable: true,
      }]);
    }
  }

  private extractJsonObject(input: string): string | null {
    const text = input
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');

    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') inString = false;
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') {
        if (depth === 0) start = index;
        depth += 1;
        continue;
      }
      if (char === '}') {
        depth -= 1;
        if (depth === 0 && start >= 0) return text.slice(start, index + 1);
      }
    }
    return null;
  }
}
