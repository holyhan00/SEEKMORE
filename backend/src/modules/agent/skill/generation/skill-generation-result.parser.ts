import { BadGatewayException, Injectable } from '@nestjs/common';

@Injectable()
export class SkillGenerationResultParser {
  parse(content: string): string {
    const source = String(content ?? '').trim();
    if (!source) throw new BadGatewayException('SKILL_GENERATION_EMPTY_RESULT');

    const fenced = /^```(?:markdown|md|yaml)?\s*\n([\s\S]*?)\n```$/i.exec(source);
    return fenced?.[1] ?? source;
  }
}
