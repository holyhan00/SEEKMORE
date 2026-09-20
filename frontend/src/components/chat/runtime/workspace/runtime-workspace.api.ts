                                                                          

import { localizeText } from '../../../../localization/localization';
import { api } from '../../../../lib/api';
import type {
  RuntimeConversationSettingsView,
  RuntimePermissionMode,
  RuntimeWorkspaceView,
} from './runtime-workspace.types';

function maskPath(value: unknown): string | null {
  const text = String(value ?? '').trim();

  if (!text) {
    return null;
  }

  const home = text.match(/^\/Users\/([^/]+)(\/.*)?$/);

  if (home) {
    return `~${home[2] ?? ''}`;
  }

  return text;
}

function unwrapData<T = unknown>(value: unknown): T {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return value as T;
  }

  const container = value as Record<string, unknown>;
  const responseData = container.data;

  if (
    responseData &&
    typeof responseData === 'object' &&
    !Array.isArray(responseData)
  ) {
    const nestedData = responseData as Record<
      string,
      unknown
    >;

    if ('data' in nestedData) {
      return nestedData.data as T;
    }
  }

  if ('data' in container) {
    return responseData as T;
  }

  return value as T;
}

function normalizeTrustLevel(
  value: unknown,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();

  return normalized || null;
}

export function normalizePermissionMode(
  value: unknown,
): RuntimePermissionMode | undefined {
  if (
    value === 'confirm_required' ||
    value === 'audit_autorun' ||
    value === 'full_access'
  ) {
    return value;
  }

  return undefined;
}

function normalizeWorkspaceStatus(
  value: unknown,
): RuntimeWorkspaceView['status'] {
  if (
    typeof value === 'string' &&
    value.trim()
  ) {
      
                                                 
                                   
                                    
       
    return value.trim() as RuntimeWorkspaceView['status'];
  }

  return 'active';
}

function extractWorkspaceInput(
  data: unknown,
): unknown {
  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    'workspace' in data
  ) {
    return (
      data as {
        workspace?: unknown;
      }
    ).workspace;
  }

  return data;
}

export function normalizeRuntimeWorkspace(
  input: unknown,
): RuntimeWorkspaceView | null {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return null;
  }

  const record = input as Record<string, unknown>;

  const id = String(
    record.id ??
      record.workspaceId ??
      '',
  ).trim();

  if (!id) {
    return null;
  }

  const rawDisplay = String(
    record.displayName ??
      record.name ??
      record.title ??
      id,
  ).trim();

  const rawPath =
    record.rootPathMasked ??
    record.maskedRootPath ??
    record.rootPathDisplay ??
    record.rootPath ??
    record.path;

  const trustLevel = normalizeTrustLevel(
    record.trustLevel ??
      record.trust_level,
  );

  const defaultPermissionMode =
    normalizePermissionMode(
      record.defaultPermissionMode,
    );

  return {
    id,
    workspaceId: id,

    name:
      typeof record.name === 'string' &&
      record.name.trim()
        ? record.name.trim()
        : rawDisplay || id,

    displayName: rawDisplay || id,

    rootPathMasked: maskPath(rawPath),

    trustLevel,

    writable: Boolean(
      record.writable ??
        record.canWrite ??
        true,
    ),

    status: normalizeWorkspaceStatus(
      record.status,
    ),

    defaultPermissionMode,
  };
}

export async function listRuntimeWorkspaces(): Promise<
  RuntimeWorkspaceView[]
> {
  const response = await api.get(
    '/systemruntime/workspaces',
  );

  const data = unwrapData<unknown>(response);

  let list: unknown[] = [];

  if (Array.isArray(data)) {
    list = data;
  } else if (
    data &&
    typeof data === 'object'
  ) {
    const record = data as Record<string, unknown>;

    if (Array.isArray(record.items)) {
      list = record.items;
    } else if (
      Array.isArray(record.workspaces)
    ) {
      list = record.workspaces;
    }
  }

  return list
    .map(normalizeRuntimeWorkspace)
    .filter(
      (
        workspace,
      ): workspace is RuntimeWorkspaceView =>
        workspace !== null,
    );
}

export async function createRuntimeWorkspace(
  input: {
    name: string;
    rootPath: string;
    source?: 'desktop_picker';
  },
): Promise<RuntimeWorkspaceView> {
  const response = await api.post(
    '/systemruntime/workspaces',
    input,
  );

  const data = unwrapData<unknown>(response);

  const normalized =
    normalizeRuntimeWorkspace(
      extractWorkspaceInput(data),
    );

  if (!normalized) {
    throw new Error(
      localizeText('runtime.workspace.invalidResponse'),
    );
  }

  return normalized;
}


export async function registerRuntimeWorkspace(
  input: {
    rootPath: string;
    name?: string;
  },
): Promise<RuntimeWorkspaceView> {
  const response = await api.post(
    '/systemruntime/workspaces/register',
    input,
  );

  const data = unwrapData<unknown>(response);
  const normalized = normalizeRuntimeWorkspace(
    extractWorkspaceInput(data),
  );

  if (!normalized) {
    throw new Error(localizeText('runtime.workspace.invalidResponse'));
  }

  return normalized;
}

export async function removeRuntimeWorkspace(
  workspaceId: string,
): Promise<void> {
  const normalizedWorkspaceId =
    workspaceId.trim();

  if (!normalizedWorkspaceId) {
    throw new Error(localizeText('runtime.workspace.idRequired'));
  }

  await api.delete(
    `/systemruntime/workspaces/${encodeURIComponent(
      normalizedWorkspaceId,
    )}`,
  );
}

export async function getRuntimeWorkspace(
  workspaceId: string,
): Promise<RuntimeWorkspaceView> {
  const normalizedWorkspaceId =
    workspaceId.trim();

  if (!normalizedWorkspaceId) {
    throw new Error(localizeText('runtime.workspace.idRequired'));
  }

  const response = await api.get(
    `/systemruntime/workspaces/${encodeURIComponent(
      normalizedWorkspaceId,
    )}`,
  );

  const data = unwrapData<unknown>(response);

  const normalized =
    normalizeRuntimeWorkspace(
      extractWorkspaceInput(data),
    );

  if (!normalized) {
    throw new Error(localizeText('runtime.workspace.notFound'));
  }

  return normalized;
}

export async function verifyRuntimeWorkspace(
  workspaceId: string,
): Promise<{
  ok: boolean;
  reasonCodes: string[];
  workspace: RuntimeWorkspaceView | null;
}> {
  const normalizedWorkspaceId =
    workspaceId.trim();

  if (!normalizedWorkspaceId) {
    return {
      ok: false,
      reasonCodes: [
        'runtime_workspace:workspace_id_required',
      ],
      workspace: null,
    };
  }

  const response = await api.post(
    `/systemruntime/workspaces/${encodeURIComponent(
      normalizedWorkspaceId,
    )}/verify`,
  );

  const data = unwrapData<unknown>(response);

  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    return {
      ok: false,
      reasonCodes: [
        'runtime_workspace:invalid_verify_response',
      ],
      workspace: null,
    };
  }

  const record = data as Record<string, unknown>;

  return {
    ok:
      typeof record.ok === 'boolean'
        ? record.ok
        : typeof record.verified === 'boolean'
          ? record.verified
          : false,

    reasonCodes: Array.isArray(
      record.reasonCodes,
    )
      ? record.reasonCodes
          .map((reasonCode) =>
            String(reasonCode).trim(),
          )
          .filter(Boolean)
      : [],

    workspace: normalizeRuntimeWorkspace(
      record.workspace ?? data,
    ),
  };
}

export async function setDefaultRuntimeWorkspace(
  workspaceId: string,
): Promise<RuntimeWorkspaceView | null> {
  const normalizedWorkspaceId =
    workspaceId.trim();

  if (!normalizedWorkspaceId) {
    throw new Error(localizeText('runtime.workspace.idRequired'));
  }

  const response = await api.post(
    '/systemruntime/workspaces/default',
    {
      workspaceId: normalizedWorkspaceId,
    },
  );

  const data = unwrapData<unknown>(response);

  return normalizeRuntimeWorkspace(
    extractWorkspaceInput(data),
  );
}

export function normalizeConversationRuntimeSettings(
  input: unknown,
  conversationIdFallback = '',
): RuntimeConversationSettingsView {
  const record = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const conversationId = String(
    record.conversationId ?? conversationIdFallback,
  ).trim() || conversationIdFallback;
  const workspace = normalizeRuntimeWorkspace(record.workspace);
  const workspaceId = String(
    record.workspaceId ?? workspace?.id ?? '',
  ).trim() || null;

  return {
    conversationId,
    workspaceId,
    workspace,
    permissionMode: normalizePermissionMode(record.permissionMode)
      ?? 'confirm_required',
    version: Math.max(1, Number(record.version ?? 1) || 1),
    updatedAt: typeof record.updatedAt === 'string'
      ? record.updatedAt
      : null,
  };
}

export async function updateConversationRuntimeSettings(
  conversationId: string,
  patch: {
    workspaceId?: string | null;
    permissionMode?: RuntimePermissionMode;
  },
): Promise<RuntimeConversationSettingsView> {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) {
    throw new Error(localizeText('runtime.workspace.conversationIdRequired'));
  }

  const response = await api.patch(
    `/chat/${encodeURIComponent(normalizedConversationId)}/runtime-settings`,
    patch,
  );
  const data = unwrapData<unknown>(response);
  return normalizeConversationRuntimeSettings(data, normalizedConversationId);
}
