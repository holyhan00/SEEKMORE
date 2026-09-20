                                                   

import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { TerminalSessionStore } from './terminal-session.store';

@Injectable()
export class TerminalReadTool implements Tool {
  name = 'terminal.read';
  version = '1.0.0';
  description = 'Read output from a background terminal session.';
  tags = ['terminal', 'local', 'execution'];
  timeoutMs = 5_000;
  inputSchema = {
    type: 'object',
    required: ['sessionId'],
    properties: {
      sessionId: { type: 'string' },
      maxOutputChars: { type: 'number', minimum: 1000, maximum: 200000 },
    },
    additionalProperties: false,
  };

  constructor(private readonly sessions: TerminalSessionStore) {}

  async execute(args: Dict, ctx: ToolContext) {
    return this.sessions.read(String(args.sessionId ?? ''), Math.max(1000, Math.min(Number(args.maxOutputChars ?? 40000), 200000)), ctx);
  }
}
