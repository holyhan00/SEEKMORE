                                                   

import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { TerminalSessionStore } from './terminal-session.store';

@Injectable()
export class TerminalKillTool implements Tool {
  name = 'terminal.kill';
  version = '1.0.0';
  description = 'Terminate a background terminal session.';
  tags = ['terminal', 'local', 'execution'];
  timeoutMs = 5_000;
  inputSchema = {
    type: 'object',
    required: ['sessionId'],
    properties: { sessionId: { type: 'string' } },
    additionalProperties: false,
  };

  constructor(private readonly sessions: TerminalSessionStore) {}

  async execute(args: Dict, ctx: ToolContext) {
    return this.sessions.kill(String(args.sessionId ?? ''), ctx);
  }
}
