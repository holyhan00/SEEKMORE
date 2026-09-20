import type {
  DesktopMcpSetup,
  DesktopMcpSetupAdapter,
  DesktopMcpSetupContext,
  DesktopMcpSetupResult,
} from './desktop-mcp-setup.types';

export class DesktopMcpSetupRegistry {
  private readonly adapters = new Map<string, DesktopMcpSetupAdapter>();

  constructor(adapters: DesktopMcpSetupAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: DesktopMcpSetupAdapter): void {
    const kind = String(adapter.kind ?? '').trim();
    if (!kind) {
      throw new Error('MCP_DESKTOP_SETUP_KIND_REQUIRED');
    }
    if (this.adapters.has(kind)) {
      throw new Error(`MCP_DESKTOP_SETUP_DUPLICATE:${kind}`);
    }
    this.adapters.set(kind, adapter);
  }

  validate(value: unknown): DesktopMcpSetup | null {
    if (value === undefined || value === null) return null;
    const kind = this.kind(value);
    return this.mustGet(kind).validate(value);
  }

  async prepare(
    setup: DesktopMcpSetup,
    context: DesktopMcpSetupContext,
  ): Promise<DesktopMcpSetupResult> {
    return this.mustGet(setup.kind).prepare(setup, context);
  }

  private mustGet(kind: string): DesktopMcpSetupAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw Object.assign(
        new Error(`Unsupported Desktop MCP setup adapter: ${kind}`),
        { code: 'MCP_DESKTOP_SETUP_UNSUPPORTED' },
      );
    }
    return adapter;
  }

  private kind(value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw Object.assign(new Error('Invalid Desktop MCP setup.'), {
        code: 'MCP_DESKTOP_SETUP_INVALID',
      });
    }
    const kind = String((value as Record<string, unknown>).kind ?? '').trim();
    if (!kind) {
      throw Object.assign(new Error('Desktop MCP setup kind is required.'), {
        code: 'MCP_DESKTOP_SETUP_KIND_REQUIRED',
      });
    }
    return kind;
  }
}
