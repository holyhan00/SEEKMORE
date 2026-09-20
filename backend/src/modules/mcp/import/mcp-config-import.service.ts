import { BadRequestException, Injectable } from '@nestjs/common';

export interface CanonicalImportedMcpDefinition {
  name: string;
  displayName: string;
  description?: string;
  transport: 'stdio' | 'streamable_http';
  endpoint?: string;
  command?: string;
  args: string[];
  workingDirectory?: string;
  envKeys: string[];
  headerKeys: string[];
  authKind: 'none' | 'bearer' | 'api_key' | 'custom_headers' | 'environment';
  originType: 'CLAUDE_DESKTOP_JSON';
}

@Injectable()
export class McpConfigImportService {
  parseClaudeDesktopJson(value: unknown): CanonicalImportedMcpDefinition[] {
    const root = this.record(value);
    const rawServers = this.record(root.mcpServers ?? root.servers);
    const entries = Object.entries(rawServers);
    if (entries.length > 100) throw new BadRequestException('MCP_IMPORT_TOO_MANY_SERVERS');
    const output: CanonicalImportedMcpDefinition[] = [];
    for (const [key, entry] of entries) {
      const row = this.record(entry);
      const command = this.optionalString(row.command);
      const url = this.optionalString(row.url ?? row.endpoint);
      if (command && url) throw new BadRequestException({ code: 'MCP_IMPORT_TRANSPORT_AMBIGUOUS', message: 'MCP_IMPORT_TRANSPORT_AMBIGUOUS', params: { server: key } });
      if (!command && !url) throw new BadRequestException({ code: 'MCP_IMPORT_TRANSPORT_REQUIRED', message: 'MCP_IMPORT_TRANSPORT_REQUIRED', params: { server: key } });
      const args = Array.isArray(row.args) ? row.args.map((item) => String(item)) : [];
      if (args.length > 128 || args.some((item) => item.length > 8_192 || /[\0\r\n]/.test(item))) {
        throw new BadRequestException({ code: 'MCP_IMPORT_ARGS_INVALID', message: 'MCP_IMPORT_ARGS_INVALID', params: { server: key } });
      }
      const env = this.stringRecord(row.env, 64, /^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
      const headers = this.stringRecord(row.headers, 64, /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/);
      this.assertSafeCommand(command, key);
      output.push({
        name: this.normalizeKey(key),
        displayName: this.optionalString(row.displayName) ?? key,
        description: this.optionalString(row.description) ?? undefined,
        transport: command ? 'stdio' : 'streamable_http',
        endpoint: url ?? undefined,
        command: command ?? undefined,
        args,
        workingDirectory: this.optionalString(row.cwd ?? row.workingDirectory) ?? undefined,
        envKeys: Object.keys(env),
        headerKeys: Object.keys(headers),
        authKind: command
          ? (Object.keys(env).length > 0 ? 'environment' : 'none')
          : (Object.keys(headers).length > 0 ? 'custom_headers' : 'none'),
        originType: 'CLAUDE_DESKTOP_JSON',
      });
    }
    if (output.length === 0) throw new BadRequestException('MCP_IMPORT_EMPTY');
    return output;
  }

  private assertSafeCommand(command: string | null, key: string): void {
    if (!command) return;
    if (/\r|\n|\0/.test(command) || command.length > 512) {
      throw new BadRequestException({ code: 'MCP_IMPORT_COMMAND_INVALID', message: 'MCP_IMPORT_COMMAND_INVALID', params: { server: key } });
    }
  }

  private normalizeKey(value: string): string {
    const key = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!key || key.length > 160) throw new BadRequestException('MCP_IMPORT_NAME_INVALID');
    return key;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private stringRecord(
    value: unknown,
    maximumEntries: number,
    keyPattern: RegExp,
  ): Record<string, string> {
    const entries = Object.entries(this.record(value));
    if (entries.length > maximumEntries) throw new BadRequestException('MCP_IMPORT_SECRET_DECLARATIONS_INVALID');
    const output: Record<string, string> = {};
    for (const [rawKey, item] of entries) {
      const key = rawKey.trim();
      const text = String(item ?? '');
      if (!keyPattern.test(key) || text.length > 16_384 || /\0/.test(text)) {
        throw new BadRequestException('MCP_IMPORT_SECRET_DECLARATIONS_INVALID');
      }
      output[key] = text;
    }
    return output;
  }

  private optionalString(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
  }
}
