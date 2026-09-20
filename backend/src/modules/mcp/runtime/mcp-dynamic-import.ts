import { webcrypto } from 'node:crypto';

export type DynamicImport = (specifier: string) => Promise<Record<string, any>>;
export type McpSdkGeneration = 'client_package' | 'sdk_package';
export type McpClientTransportKind = 'stdio' | 'streamable_http';
export type McpProtocolPreference = 'auto' | 'legacy' | 'modern';
export type McpListKind = 'tools' | 'resources' | 'prompts';

export interface LoadedMcpClientSdk {
  generation: McpSdkGeneration;
  Client: new (...args: any[]) => any;
  Transport: new (...args: any[]) => any;
  ToolListChangedNotificationSchema?: unknown;
  ResourceListChangedNotificationSchema?: unknown;
  PromptListChangedNotificationSchema?: unknown;
}

export interface McpClientConnectionMetadata {
  protocolEra: string | null;
  protocolVersion: string | null;
  serverInfo: Record<string, unknown> | null;
  capabilities: Record<string, unknown>;
  instructions: string | null;
}

                                                                            
                                                                        
                                                             
export const dynamicImport: DynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as DynamicImport;

export async function loadMcpClientSdk(
  transport: McpClientTransportKind,
  preference?: string | null,
): Promise<LoadedMcpClientSdk> {
  ensureWebCrypto();
  const failures: string[] = [];
  const normalizedPreference = protocolPreference(preference);
  const loaders =
    normalizedPreference === 'modern'
      ? [loadClientPackageSdk]
      : normalizedPreference === 'auto' || nodeMajorVersion() >= 20
        ? [loadClientPackageSdk, loadSdkPackageClient]
        : [loadSdkPackageClient, loadClientPackageSdk];

  for (const loader of loaders) {
    try {
      return await loader(transport);
    } catch (error) {
      failures.push(errorMessage(error));
    }
  }

  throw Object.assign(new Error('MCP_CLIENT_SDK_NOT_INSTALLED'), {
    code: 'MCP_CLIENT_SDK_NOT_INSTALLED',
    detail: { failures },
  });
}

async function loadClientPackageSdk(
  transport: McpClientTransportKind,
): Promise<LoadedMcpClientSdk> {
  try {
    const clientPackage = await dynamicImport('@modelcontextprotocol/client');
    const transportPackage =
      transport === 'stdio'
        ? await dynamicImport('@modelcontextprotocol/client/stdio')
        : clientPackage;
    const Transport =
      transport === 'stdio'
        ? transportPackage.StdioClientTransport
        : clientPackage.StreamableHTTPClientTransport;

    if (!clientPackage.Client || !Transport) {
      throw new Error('MCP_CLIENT_PACKAGE_EXPORTS_MISSING');
    }

    return {
      generation: 'client_package',
      Client: clientPackage.Client,
      Transport,
    };
  } catch (error) {
    throw new Error(`client_package:${errorMessage(error)}`);
  }
}

async function loadSdkPackageClient(
  transport: McpClientTransportKind,
): Promise<LoadedMcpClientSdk> {
  try {
    const [clientPackage, transportPackage, typesPackage] = await Promise.all([
      dynamicImport('@modelcontextprotocol/sdk/client/index.js'),
      dynamicImport(
        transport === 'stdio'
          ? '@modelcontextprotocol/sdk/client/stdio.js'
          : '@modelcontextprotocol/sdk/client/streamableHttp.js',
      ),
      dynamicImport('@modelcontextprotocol/sdk/types.js').catch(() => ({})),
    ]);
    const legacyTypes = typesPackage as Record<string, any>;
    const Transport =
      transport === 'stdio'
        ? transportPackage.StdioClientTransport
        : transportPackage.StreamableHTTPClientTransport;

    if (!clientPackage.Client || !Transport) {
      throw new Error('MCP_SDK_PACKAGE_EXPORTS_MISSING');
    }

    return {
      generation: 'sdk_package',
      Client: clientPackage.Client,
      Transport,
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

export function createMcpClient(
  sdk: LoadedMcpClientSdk,
  identity: { name: string; version: string },
  preference: string | null | undefined,
  onListChanged?: (kind: McpListKind) => void | Promise<void>,
): any {
  if (sdk.generation === 'client_package') {
    const listChanged = onListChanged
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
      : undefined;

    return new sdk.Client(identity, {
      versionNegotiation: versionNegotiation(preference),
      listChanged,
    });
  }

  const client = new sdk.Client(identity, { capabilities: {} });
  if (onListChanged && typeof client.setNotificationHandler === 'function') {
    registerLegacyListChanged(
      client,
      sdk.ToolListChangedNotificationSchema,
      'tools',
      onListChanged,
    );
    registerLegacyListChanged(
      client,
      sdk.ResourceListChangedNotificationSchema,
      'resources',
      onListChanged,
    );
    registerLegacyListChanged(
      client,
      sdk.PromptListChangedNotificationSchema,
      'prompts',
      onListChanged,
    );
  }
  return client;
}

export function mcpConnectionMetadata(
  client: any,
  generation: McpSdkGeneration,
): McpClientConnectionMetadata {
  const protocolEra =
    typeof client?.getProtocolEra === 'function'
      ? nullableString(client.getProtocolEra())
      : generation === 'sdk_package'
        ? 'legacy'
        : null;
  const protocolVersion =
    typeof client?.getNegotiatedProtocolVersion === 'function'
      ? nullableString(client.getNegotiatedProtocolVersion())
      : typeof client?.getProtocolVersion === 'function'
        ? nullableString(client.getProtocolVersion())
        : null;
  const serverInfo =
    typeof client?.getServerVersion === 'function'
      ? nullableRecord(client.getServerVersion())
      : null;
  const capabilities =
    typeof client?.getServerCapabilities === 'function'
      ? record(client.getServerCapabilities())
      : {};
  const instructions =
    typeof client?.getInstructions === 'function'
      ? nullableString(client.getInstructions())
      : null;

  return {
    protocolEra,
    protocolVersion,
    serverInfo,
    capabilities,
    instructions,
  };
}

export async function listMcpItems(
  client: any,
  kind: McpListKind,
  maximumItems = 10_000,
): Promise<Record<string, unknown>[]> {
  const methodName =
    kind === 'tools'
      ? 'listTools'
      : kind === 'resources'
        ? 'listResources'
        : 'listPrompts';
  const resultKey = kind;
  const method = client?.[methodName];
  if (typeof method !== 'function') return [];

  const items: Record<string, unknown>[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const page = await method.call(client, cursor ? { cursor } : {});
    const pageItems = Array.isArray(page?.[resultKey]) ? page[resultKey] : [];
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

export function hasMcpCapability(
  capabilities: Record<string, unknown>,
  kind: McpListKind,
): boolean {
  return Object.prototype.hasOwnProperty.call(capabilities, kind);
}

function versionNegotiation(preference: string | null | undefined): Record<string, unknown> {
  const normalized = protocolPreference(preference);
  if (normalized === 'auto') return { mode: 'auto' };
  if (normalized === 'modern') {
    return { mode: { pin: '2026-07-28' } };
  }
  return { mode: 'legacy' };
}

function registerLegacyListChanged(
  client: any,
  schema: unknown,
  kind: McpListKind,
  onListChanged: (kind: McpListKind) => void | Promise<void>,
): void {
  if (!schema) return;
  try {
    client.setNotificationHandler(schema, () =>
      Promise.resolve(onListChanged(kind)).then(() => undefined),
    );
  } catch {
                                                                        
  }
}

function protocolPreference(value: string | null | undefined): McpProtocolPreference {
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
  const item = record(value);
  return Object.keys(item).length > 0 ? item : null;
}

function nullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean || null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
