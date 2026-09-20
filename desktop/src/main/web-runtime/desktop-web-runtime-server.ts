import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DesktopWebRuntimeDescriptor, DesktopWebRuntimeRequest, DesktopWebRuntimeResponse, DesktopWebSessionMode } from './desktop-web-runtime.types';
import { DesktopWebSessionManager } from './desktop-web-session-manager';
import { PublicWebFetcher } from './public-web-fetcher';
import type { DesktopMcpStdioHost } from '../mcp/desktop-mcp-stdio-host';
import type { DesktopMcpSecretStore } from '../mcp/desktop-mcp-secret-store';

const DESCRIPTOR_FILENAME = 'seekmore-desktop-web-runtime.json';

export class DesktopWebRuntimeServer {
  private readonly sessions = new DesktopWebSessionManager();
  private readonly fetcher = new PublicWebFetcher();
  private readonly token = randomBytes(32).toString('hex');
  private readonly startedAt = new Date().toISOString();
  private server: Server | null = null;
  private descriptorPath: string | null = null;

  constructor(
    private readonly mcpHost: DesktopMcpStdioHost,
    private readonly mcpSecrets: DesktopMcpSecretStore,
  ) {}

  async start(options: { descriptorPath?: string } = {}): Promise<void> {
    if (this.server) return;
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Unable to resolve Desktop Web Runtime address.');
    this.descriptorPath = options.descriptorPath
      ? path.resolve(options.descriptorPath)
      : path.join(os.tmpdir(), DESCRIPTOR_FILENAME);
    await fs.mkdir(path.dirname(this.descriptorPath), {
      recursive: true,
      mode: 0o700,
    });
    const descriptor: DesktopWebRuntimeDescriptor = {
      pid: process.pid,
      port: address.port,
      token: this.token,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
    };
    const temporaryDescriptorPath = `${this.descriptorPath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryDescriptorPath, JSON.stringify(descriptor), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryDescriptorPath, this.descriptorPath);
    await fs.chmod(this.descriptorPath, 0o600);
                                                                                                              
  }

  async stop(): Promise<void> {
    this.sessions.closeAll();
    await this.mcpHost.closeAll();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (this.descriptorPath) await fs.unlink(this.descriptorPath).catch(() => undefined);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== '/v1/invoke') {
      this.respond(response, 404, { ok: false, error: { code: 'DESKTOP_WEB_ROUTE_NOT_FOUND', message: 'Route not found.' } });
      return;
    }
    const authorization = String(request.headers.authorization ?? '');
    if (authorization !== `Bearer ${this.token}`) {
      this.respond(response, 401, { ok: false, error: { code: 'DESKTOP_WEB_UNAUTHORIZED', message: 'Invalid Desktop Web Runtime token.' } });
      return;
    }
    try {
      const body = await this.readBody(request);
      const result = await this.invoke(body);
      this.respond(response, 200, { ok: true, data: result });
    } catch (error) {
      const value = error as Error & { code?: string; detail?: unknown };
      this.respond(response, 400, {
        ok: false,
        error: {
          code: value.code ?? 'DESKTOP_WEB_RUNTIME_ERROR',
          message: value.message || 'Desktop Web Runtime operation failed.',
          detail: value.detail,
        },
      });
    }
  }

  private async invoke(request: DesktopWebRuntimeRequest): Promise<unknown> {
    const payload = request.payload ?? {};
    switch (request.operation) {
      case 'health':
        return this.sessions.health();
      case 'fetch_public_page':
        return this.fetcher.fetch({
          url: String(payload.url ?? ''),
          timeoutMs: Number(payload.timeoutMs ?? 10_000),
          maxBytes: Number(payload.maxBytes ?? 2_000_000),
          headers: this.stringRecord(payload.headers),
        });
      case 'create_session':
        return this.sessions.create({
          mode: this.sessionMode(payload.mode),
          profileId: this.optionalString(payload.profileId),
          visible: payload.visible === true,
        });
      case 'navigate':
        return this.sessions.navigate({ sessionId: String(payload.sessionId ?? ''), url: String(payload.url ?? ''), timeoutMs: Number(payload.timeoutMs ?? 15_000) });
      case 'snapshot':
        return this.sessions.snapshot({ sessionId: String(payload.sessionId ?? '') });
      case 'act':
        return this.sessions.act({
          sessionId: String(payload.sessionId ?? ''),
          action: String(payload.action ?? ''),
          target: this.record(payload.target),
          value: payload.value,
          metadata: this.record(payload.metadata),
        });
      case 'get_content':
        return this.sessions.getContent({ sessionId: String(payload.sessionId ?? '') });
      case 'capture':
        return this.sessions.capture({ sessionId: String(payload.sessionId ?? '') });
      case 'close_session':
        this.sessions.close(String(payload.sessionId ?? ''));
        return { closed: true };
      case 'mcp_health':
        return this.mcpHost.health();
      case 'mcp_store_secret':
        return this.mcpSecrets.put(
          String(payload.installationId ?? ''),
          this.stringRecord(payload.values) ?? {},
        );
      case 'mcp_delete_secret':
        await this.mcpSecrets.deleteForInstallation(
          String(payload.installationId ?? ''),
        );
        return { deleted: true };
      case 'mcp_connect':
        return this.mcpHost.connect({
          installationId: String(payload.installationId ?? ''),
          displayName: String(payload.displayName ?? ''),
          command: String(payload.command ?? ''),
          args: Array.isArray(payload.args) ? payload.args.map(String) : [],
          workingDirectory: this.optionalString(payload.workingDirectory),
          timeoutMs: Number(payload.timeoutMs ?? 60_000),
          protocolPreference: this.optionalString(payload.protocolPreference),
          secretRef: this.optionalString(payload.secretRef),
          environment: this.stringRecord(payload.environment) ?? {},
          desktopSetup: this.record(payload.desktopSetup),
        });
      case 'mcp_disconnect':
        return this.mcpHost.disconnect(String(payload.installationId ?? ''));
      case 'mcp_discover':
        return this.mcpHost.discover(
          String(payload.installationId ?? ''),
          Number(payload.timeoutMs ?? 120_000),
        );
      case 'mcp_list_tools':
        return this.mcpHost.listTools(String(payload.installationId ?? ''));
      case 'mcp_consume_tool_changes':
        return this.mcpHost.consumeToolChanges(String(payload.installationId ?? ''));
      case 'mcp_call_tool':
        return this.mcpHost.callTool(
          String(payload.installationId ?? ''),
          String(payload.name ?? ''),
          this.record(payload.arguments) ?? {},
          Number(payload.timeoutMs ?? 60_000),
          this.optionalString(payload.requestId),
        );
      case 'mcp_cancel_tool':
        return this.mcpHost.cancelCall(String(payload.requestId ?? ''));
      case 'mcp_status':
        return this.mcpHost.status(String(payload.installationId ?? ''));
      default:
        throw Object.assign(new Error(`Unsupported Desktop Web Runtime operation: ${String(request.operation)}`), { code: 'DESKTOP_WEB_OPERATION_UNSUPPORTED' });
    }
  }

  private readBody(request: IncomingMessage): Promise<DesktopWebRuntimeRequest> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      request.on('data', (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > 1_000_000) {
          reject(Object.assign(new Error('Request body is too large.'), { code: 'DESKTOP_WEB_REQUEST_TOO_LARGE' }));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          resolve(parsed as DesktopWebRuntimeRequest);
        } catch {
          reject(Object.assign(new Error('Invalid JSON request body.'), { code: 'DESKTOP_WEB_REQUEST_INVALID' }));
        }
      });
      request.on('error', reject);
    });
  }

  private respond(response: ServerResponse, statusCode: number, body: DesktopWebRuntimeResponse): void {
    const json = JSON.stringify(body);
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
      'Cache-Control': 'no-store',
    });
    response.end(json);
  }

  private sessionMode(value: unknown): DesktopWebSessionMode {
    return value === 'INTERACTIVE_BROWSER' ? 'INTERACTIVE_BROWSER' : 'BACKGROUND_SEARCH';
  }

  private optionalString(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
  }

  private record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  private stringRecord(value: unknown): Record<string, string> | undefined {
    const record = this.record(value);
    if (!record) return undefined;
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, String(item ?? '')]));
  }
}
