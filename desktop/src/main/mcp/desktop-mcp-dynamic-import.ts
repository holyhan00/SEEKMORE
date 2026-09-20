import { webcrypto } from 'node:crypto';

export type DesktopMcpProtocolPreference = 'auto' | 'legacy' | 'modern';
export type DesktopMcpSdkGeneration = 'client_package' | 'sdk_package';
export type DesktopMcpListKind = 'tools' | 'resources' | 'prompts';

type LoadedDesktopMcpSdk = {
  generation: DesktopMcpSdkGeneration;
  Client: new (...args: any[]) => any;
  StdioClientTransport: new (...args: any[]) => any;
  ToolListChangedNotificationSchema?: unknown;
  ResourceListChangedNotificationSchema?: unknown;
  PromptListChangedNotificationSchema?: unknown;
};

export async function dynamicImport(
  moduleName: string,
): Promise<Record<string, any>> {
  const importer = new Function('name', 'return import(name)') as (
    name: string,
  ) => Promise<Record<string, any>>;
  return importer(moduleName);
}

export async function loadDesktopMcpSdk(
  preference?: string | null,
): Promise<LoadedDesktopMcpSdk> {
  ensureWebCrypto();
  const failures: string[] = [];
  const normalizedPreference = protocolPreference(preference);
  const loaders =
    normalizedPreference === 'modern'
      ? [loadClientPackageDesktopMcpSdk]
      : normalizedPreference === 'auto' || nodeMajorVersion() >= 20
        ? [loadClientPackageDesktopMcpSdk, loadSdkPackageDesktopMcpSdk]
        : [loadSdkPackageDesktopMcpSdk, loadClientPackageDesktopMcpSdk];

  for (const loader of loaders) {
    try {
      return await loader();
    } catch (error) {
      failures.push(errorMessage(error));
    }
  }

  throw Object.assign(new Error('MCP_CLIENT_SDK_NOT_INSTALLED'), {
    code: 'MCP_CLIENT_SDK_NOT_INSTALLED',
    detail: { failures },
  });
}

async function loadClientPackageDesktopMcpSdk(): Promise<LoadedDesktopMcpSdk> {
  try {
    const [clientPackage, stdioPackage] = await Promise.all([
      dynamicImport('@modelcontextprotocol/client'),
      dynamicImport('@modelcontextprotocol/client/stdio'),
    ]);
    if (!clientPackage.Client || !stdioPackage.StdioClientTransport) {
      throw new Error('MCP_CLIENT_PACKAGE_EXPORTS_MISSING');
    }
    return {
      generation: 'client_package',
      Client: clientPackage.Client,
      StdioClientTransport: stdioPackage.StdioClientTransport,
    };
  } catch (error) {
    throw new Error(`client_package:${errorMessage(error)}`);
  }
}

async function loadSdkPackageDesktopMcpSdk(): Promise<LoadedDesktopMcpSdk> {
  try {
    const [clientPackage, stdioPackage, typesPackage] = await Promise.all([
      dynamicImport('@modelcontextprotocol/sdk/client/index.js'),
      dynamicImport('@modelcontextprotocol/sdk/client/stdio.js'),
      dynamicImport('@modelcontextprotocol/sdk/types.js').catch(() => ({})),
    ]);
    const legacyTypes = typesPackage as Record<string, any>;
    if (!clientPackage.Client || !stdioPackage.StdioClientTransport) {
      throw new Error('MCP_SDK_PACKAGE_EXPORTS_MISSING');
    }
    return {
      generation: 'sdk_package',
      Client: clientPackage.Client,
      StdioClientTransport: stdioPackage.StdioClientTransport,
      ToolListChangedNotificationSchema:
        legacyTypes.ToolListChangedNotificationSchema,
      ResourceListChangedNotificationSchema:
        legacyTypes.ResourceListChangedNotificationSchema,
      PromptListChangedNotificationSchema:
        legacyTypes.PromptListChangedNotificationSchema,
    };
  } catch (error) {
    throw new Error(`sdk_package:${errorMessage(error)}`);
  }
}

export function createDesktopMcpClient(
  sdk: LoadedDesktopMcpSdk,
  identity: { name: string; version: string },
  preference: string | null | undefined,
  onListChanged?: (kind: DesktopMcpListKind) => void | Promise<void>,
): any {
  if (sdk.generation === 'client_package') {
    return new sdk.Client(identity, {
      versionNegotiation: versionNegotiation(preference),
      listChanged: onListChanged
        ? {
            tools: {
              onChanged: (error: unknown) => {
                if (!error) void Promise.resolve(onListChanged('tools')).catch(() => undefined);
              },
            },
            resources: {
              onChanged: (error: unknown) => {
                if (!error) void Promise.resolve(onListChanged('resources')).catch(() => undefined);
              },
            },
            prompts: {
              onChanged: (error: unknown) => {
                if (!error) void Promise.resolve(onListChanged('prompts')).catch(() => undefined);
              },
            },
          }
        : undefined,
    });
  }

  const client = new sdk.Client(identity, { capabilities: {} });
  if (onListChanged && typeof client.setNotificationHandler === 'function') {
    registerLegacy(
      client,
      sdk.ToolListChangedNotificationSchema,
      'tools',
      onListChanged,
    );
    registerLegacy(
      client,
      sdk.ResourceListChangedNotificationSchema,
      'resources',
      onListChanged,
    );
    registerLegacy(
      client,
      sdk.PromptListChangedNotificationSchema,
      'prompts',
      onListChanged,
    );
  }
  return client;
}

export function desktopMcpConnectionMetadata(
  client: any,
  generation: DesktopMcpSdkGeneration,
): {
  protocolEra: string | null;
  protocolVersion: string | null;
  serverInfo: Record<string, unknown> | null;
  capabilities: Record<string, unknown>;
  instructions: string | null;
} {
  return {
    protocolEra:
      typeof client?.getProtocolEra === 'function'
        ? nullableString(client.getProtocolEra())
        : generation === 'sdk_package'
          ? 'legacy'
          : null,
    protocolVersion:
      typeof client?.getNegotiatedProtocolVersion === 'function'
        ? nullableString(client.getNegotiatedProtocolVersion())
        : typeof client?.getProtocolVersion === 'function'
          ? nullableString(client.getProtocolVersion())
          : null,
    serverInfo:
      typeof client?.getServerVersion === 'function'
        ? nullableRecord(client.getServerVersion())
        : null,
    capabilities:
      typeof client?.getServerCapabilities === 'function'
        ? record(client.getServerCapabilities())
        : {},
    instructions:
      typeof client?.getInstructions === 'function'
        ? nullableString(client.getInstructions())
        : null,
  };
}

export async function listDesktopMcpItems(
  client: any,
  kind: DesktopMcpListKind,
  maximumItems = 10_000,
): Promise<Record<string, unknown>[]> {
  const methodName =
    kind === 'tools'
      ? 'listTools'
      : kind === 'resources'
        ? 'listResources'
        : 'listPrompts';
  const method = client?.[methodName];
  if (typeof method !== 'function') return [];

  const items: Record<string, unknown>[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const page = await method.call(client, cursor ? { cursor } : {});
    const pageItems = Array.isArray(page?.[kind]) ? page[kind] : [];
    items.push(
      ...pageItems.filter(
        (item: unknown): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      ),
    );
    if (items.length > maximumItems) {
      throw Object.assign(new Error(`MCP_${kind.toUpperCase()}_LIST_TOO_LARGE`), {
        code: `MCP_${kind.toUpperCase()}_LIST_TOO_LARGE`,
      });
    }
    const nextCursor = nullableString(page?.nextCursor) ?? '';
    if (!nextCursor) break;
    if (seenCursors.has(nextCursor)) {
      throw Object.assign(new Error(`MCP_${kind.toUpperCase()}_LIST_CURSOR_CYCLE`), {
        code: `MCP_${kind.toUpperCase()}_LIST_CURSOR_CYCLE`,
      });
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return items;
}

export function desktopHasMcpCapability(
  capabilities: Record<string, unknown>,
  kind: DesktopMcpListKind,
): boolean {
  return Object.prototype.hasOwnProperty.call(capabilities, kind);
}

function versionNegotiation(preference: string | null | undefined): Record<string, unknown> {
  const normalized = protocolPreference(preference);
  if (normalized === 'auto') return { mode: 'auto' };
  if (normalized === 'modern') return { mode: { pin: '2026-07-28' } };
  return { mode: 'legacy' };
}

function registerLegacy(
  client: any,
  schema: unknown,
  kind: DesktopMcpListKind,
  onListChanged: (kind: DesktopMcpListKind) => void | Promise<void>,
): void {
  if (!schema) return;
  try {
    client.setNotificationHandler(schema, () =>
      Promise.resolve(onListChanged(kind)).then(() => undefined),
    );
  } catch {
                                                               
  }
}

function protocolPreference(
  value: string | null | undefined,
): DesktopMcpProtocolPreference {
  const normalized = String(value ?? 'legacy').trim().toLowerCase();
  return normalized === 'auto' || normalized === 'modern'
    ? normalized
    : 'legacy';
}

function nodeMajorVersion(): number {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : 0;
}

function ensureWebCrypto(): void {
  if (typeof (globalThis as any).crypto === 'undefined') {
    (globalThis as any).crypto = webcrypto;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nullableRecord(value: unknown): Record<string, unknown> | null {
  const valueRecord = record(value);
  return Object.keys(valueRecord).length > 0 ? valueRecord : null;
}

function nullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean || null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
