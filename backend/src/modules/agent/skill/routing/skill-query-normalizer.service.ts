import { Injectable } from '@nestjs/common';

@Injectable()
export class SkillQueryNormalizerService {
  normalize(value: string): {
    normalized: string;
    tokens: string[];
    phrases: string[];
  } {
    const normalized = String(value ?? '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const latin = normalized.match(/[a-z0-9][a-z0-9._+/#-]*/g) ?? [];
    const cjkRuns = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? [];
    const cjkTokens: string[] = [];
    for (const run of cjkRuns) {
      if (run.length <= 4) cjkTokens.push(run);
      for (let size = 2; size <= Math.min(4, run.length); size += 1) {
        for (let index = 0; index <= run.length - size; index += 1) {
          cjkTokens.push(run.slice(index, index + size));
        }
      }
    }

    const tokens = [...new Set([...latin, ...cjkTokens])].slice(0, 160);
    const phrases = [...new Set([
      normalized,
      ...normalized.split(/[，。！？；,!?;:\n]/).map((item) => item.trim()).filter(Boolean),
      ...cjkRuns,
    ])].slice(0, 40);

    return { normalized, tokens, phrases };
  }
}
