                                                        

import { Injectable } from '@nestjs/common';
import { ToolError } from '../toolstypes';

@Injectable()
export class TerminalPolicyService {
  assertAllowed(command: string): void {
    const text = String(command ?? '').trim();
    if (!text) throw new ToolError('EMPTY_COMMAND', 'Command is required');
    const compact = text.replace(/\s+/g, ' ').toLowerCase();

    const deniedPatterns: Array<{ pattern: RegExp; code: string; message: string }> = [
      { pattern: /(^|\s)sudo(\s|$)/, code: 'SUDO_BLOCKED', message: 'sudo commands are blocked by the terminal safety policy' },
      { pattern: /rm\s+-[^\n;|&]*r[^\n;|&]*f\s+\//, code: 'DESTRUCTIVE_COMMAND_BLOCKED', message: 'destructive root deletion is blocked' },
      { pattern: /curl\b[^\n]*(\||>)\s*(sh|bash)\b/, code: 'PIPE_TO_SHELL_BLOCKED', message: 'curl piped to shell is blocked' },
      { pattern: /wget\b[^\n]*(\||>)\s*(sh|bash)\b/, code: 'PIPE_TO_SHELL_BLOCKED', message: 'wget piped to shell is blocked' },
      { pattern: /chmod\s+-r\s+777\b/, code: 'UNSAFE_CHMOD_BLOCKED', message: 'recursive chmod 777 is blocked' },
      { pattern: />\s*~\/\.ssh\//, code: 'CREDENTIAL_PATH_BLOCKED', message: 'writing credential paths is blocked' },
    ];

    for (const rule of deniedPatterns) {
      if (rule.pattern.test(compact)) {
        throw new ToolError(rule.code, rule.message, { command: text });
      }
    }
  }
}
