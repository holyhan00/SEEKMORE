import type {
  ListMemoryParams,
  MemoryFactRecord,
  MemoryPage,
  MemoryScopeQuery,
} from './memory.types';
import { authFetch } from '../../../lib/http';
import { FRONTEND_RUNTIME_CONFIG } from '../../../runtime-config';

const API_BASE = FRONTEND_RUNTIME_CONFIG.apiBaseUrl.replace(/\/$/, '');

function buildQuery(params: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const value = query.toString();
  return value ? `?${value}` : '';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');

  const res = await authFetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body?.message || body?.error || message;
    } catch {
                                   
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const memoryApi = {
  async listFacts(params: ListMemoryParams): Promise<MemoryPage<MemoryFactRecord>> {
    const query = buildQuery(params as Record<string, unknown>);
    return request<MemoryPage<MemoryFactRecord>>(
      `/memory/admin/facts${query}`,
    );
  },

  async deleteFact(
    memoryId: string,
    input?: { reason?: string; scope?: MemoryScopeQuery },
  ): Promise<unknown> {
    return request(`/memory/admin/facts/${encodeURIComponent(memoryId)}`, {
      method: 'DELETE',
      body: JSON.stringify({
        reason: input?.reason ?? 'memory_ui_delete',
        scope: input?.scope ?? {},
      }),
    });
  },

  async restoreFact(
    memoryId: string,
    input?: { reason?: string; scope?: MemoryScopeQuery },
  ): Promise<MemoryFactRecord> {
    return request(`/memory/admin/facts/${encodeURIComponent(memoryId)}/restore`, {
      method: 'POST',
      body: JSON.stringify({
        reason: input?.reason ?? 'memory_ui_restore',
        scope: input?.scope ?? {},
      }),
    });
  },

  async promoteFact(
    memoryId: string,
    input?: { reason?: string; scope?: MemoryScopeQuery },
  ): Promise<MemoryFactRecord> {
    return request(`/memory/admin/facts/${encodeURIComponent(memoryId)}/promote`, {
      method: 'POST',
      body: JSON.stringify({
        reason: input?.reason ?? 'memory_ui_promote',
        scope: input?.scope ?? {},
      }),
    });
  },

  async purgeFact(
    memoryId: string,
    input?: { reason?: string; scope?: MemoryScopeQuery },
  ): Promise<unknown> {
    return request(`/memory/admin/facts/${encodeURIComponent(memoryId)}/purge`, {
      method: 'DELETE',
      body: JSON.stringify({
        reason: input?.reason ?? 'memory_ui_purge',
        scope: input?.scope ?? {},
      }),
    });
  },
};
