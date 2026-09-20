import { Inject, Injectable } from '@nestjs/common';
import { MCP_RUNTIME_CONFIG } from '../mcp-runtime.tokens';
import type {
  McpRuntimeConfig,
  McpServerConfig,
} from '../domain/mcp-runtime.types';
import { McpSecurityPolicyError } from '../domain/mcp-runtime.errors';

@Injectable()
export class McpStdioPolicyService {
  constructor(
    @Inject(MCP_RUNTIME_CONFIG)
    private readonly config: McpRuntimeConfig,
  ) {}

  assertAllowed(server: McpServerConfig): void {
    if (server.transport !== 'stdio') return;
    if (server.managedRuntime !== 'BACKEND_INTERNAL') {
      throw new McpSecurityPolicyError(
        'MCP_STDIO_DESKTOP_REQUIRED',
        'User stdio MCP must run in the Desktop Connector Host.',
      );
    }
    if (server.source !== 'SYSTEM' || server.reviewStatus !== 'approved') {
      throw new McpSecurityPolicyError(
        'MCP_STDIO_TRUST_DENIED',
        'Backend stdio is restricted to approved SEEK MORE integrations.',
      );
    }
    if (!server.command) {
      throw new McpSecurityPolicyError(
        'MCP_STDIO_COMMAND_REQUIRED',
        'stdio transport requires command.',
      );
    }
    const allowlist = this.config.stdioCommandAllowlist;
    if (allowlist.length > 0 && !allowlist.includes(server.command)) {
      throw new McpSecurityPolicyError(
        'MCP_STDIO_COMMAND_DENIED',
        `stdio command is not allowlisted: ${server.command}`,
      );
    }
  }
}
