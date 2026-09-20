                                                                          
import { Injectable } from '@nestjs/common';

export type MemoryCommandIntent = 'remember' | 'forget' | 'restore';

export type MemoryCommandClassification = {
  intent: MemoryCommandIntent | null;
  explicitness: 'explicit' | 'implicit';
  confidence: number;
  targetText?: string;
};

@Injectable()
export class MemoryCommandClassifier {
  classify(input: { text?: string | null }): MemoryCommandClassification {
    const rawText = this.normalize(input.text);

    if (!rawText) {
      return this.implicit(0);
    }

    const compact = this.compact(rawText);

    const forget = this.classifyForget(rawText, compact);
    if (forget) return forget;

    const restore = this.classifyRestore(rawText, compact);
    if (restore) return restore;

    const remember = this.classifyRemember(rawText, compact);
    if (remember) return remember;

    return this.implicit(0.5);
  }

  private classifyForget(
    rawText: string,
    compact: string,
  ): MemoryCommandClassification | null {
    const hasForgetVerb = this.hasAny(compact, [
      '忘掉',
      '忘记',
      '删除',
      '删掉',
      '清除',
      '移除',
      '取消保存',
      '不要再记',
      '别再记',
    ]);

    if (!hasForgetVerb) return null;

    const hasMemoryObject = this.hasAny(compact, [
      '记忆',
      '保存的',
      '记住的',
      '那条',
      '这条',
      '那个',
      '这个',
      '偏好',
      '要求',
      '习惯',
      '信息',
    ]);

    if (!hasMemoryObject) return null;

    return {
      intent: 'forget',
      explicitness: 'explicit',
      confidence: 0.92,
      targetText: this.extractTargetText(rawText),
    };
  }

  private classifyRestore(
    rawText: string,
    compact: string,
  ): MemoryCommandClassification | null {
    const hasRestoreVerb = this.hasAny(compact, [
      '恢复',
      '还原',
      '重新启用',
      '重新打开',
      '取消删除',
    ]);

    if (!hasRestoreVerb) return null;

    const hasMemoryObject = this.hasAny(compact, [
      '记忆',
      '那条',
      '这条',
      '那个',
      '这个',
      '偏好',
      '要求',
      '习惯',
      '信息',
    ]);

    if (!hasMemoryObject) return null;

    return {
      intent: 'restore',
      explicitness: 'explicit',
      confidence: 0.9,
      targetText: this.extractTargetText(rawText),
    };
  }

  private classifyRemember(
    rawText: string,
    compact: string,
  ): MemoryCommandClassification | null {
    const hasRememberVerb = this.hasAny(compact, [
      '记住',
      '保存',
      '以后记住',
      '以后都要',
      '你要记住',
      '帮我记住',
    ]);

    const hasPreferenceDeclaration = this.hasAny(compact, [
      '这是我的偏好',
      '这是我的习惯',
      '这是我的要求',
      '以后按照这个',
      '以后按这个',
      '以后写代码',
      '以后回答',
      '以后生成',
    ]);

    if (!hasRememberVerb && !hasPreferenceDeclaration) {
      return null;
    }

    return {
      intent: 'remember',
      explicitness: 'explicit',
      confidence: 0.9,
      targetText: this.extractTargetText(rawText),
    };
  }

  private extractTargetText(text: string): string {
    return text
      .replace(/^(请|帮我|麻烦你|你要|以后)?(记住|保存|忘掉|忘记|删除|删掉|清除|移除|恢复|还原)/, '')
      .replace(/记忆$/, '')
      .replace(/[“”"]/g, '')
      .trim();
  }

  private implicit(confidence: number): MemoryCommandClassification {
    return {
      intent: null,
      explicitness: 'implicit',
      confidence,
    };
  }

  private hasAny(text: string, terms: string[]): boolean {
    return terms.some((term) => text.includes(term));
  }

  private compact(text: string): string {
    return text.replace(/\s+/g, '');
  }

  private normalize(value: unknown): string {
    return String(value ?? '').trim();
  }
}