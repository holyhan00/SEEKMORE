                                                 
import { api } from '../../../lib/api';
import type {
  McpDefinitionDetail,
  McpDefinitionDraft,
  McpInstallationItem,
  McpToolItem,
} from './mcp.types';

function unwrap<T>(value: unknown): T {
  const row = value as { data?: unknown } | null;
  return (row?.data ?? value) as T;
}

export async function listMcpDefinitions() {
  const { data } = await api.get('/mcp/definitions');
  return unwrap<McpDefinitionDetail[]>(data);
}

export async function getMcpDefinition(id: string) {
  const { data } = await api.get(`/mcp/definitions/${id}`);
  return unwrap<McpDefinitionDetail>(data);
}

function definitionPayload(draft: McpDefinitionDraft) {
  return {
    displayName: draft.displayName.trim(),
    description: draft.description.trim(),
    transport: draft.transport,
    endpoint: draft.transport === 'streamable_http' ? draft.endpoint.trim() : undefined,
    command: draft.transport === 'stdio' ? draft.command.trim() : undefined,
    args: draft.transport === 'stdio'
      ? draft.argsText.split('\n').map((item) => item.trim()).filter(Boolean)
      : [],
    workingDirectory: draft.transport === 'stdio' ? draft.workingDirectory.trim() || undefined : undefined,
    authKind: draft.authKind,
    headers: draft.transport === 'streamable_http'
      ? Object.fromEntries(draft.headersText.split('\n').map((item) => item.trim()).filter(Boolean).map((key) => [key, '']))
      : {},
    environment: draft.transport === 'stdio'
      ? Object.fromEntries(draft.environmentText.split('\n').map((item) => item.trim()).filter(Boolean).map((key) => [key, '']))
      : {},
    timeoutMs: draft.timeoutMs,
  };
}

export async function createMcpDefinition(draft: McpDefinitionDraft) {
  const { data } = await api.post('/mcp/definitions', definitionPayload(draft));
  return unwrap<McpDefinitionDetail>(data);
}

export async function updateMcpDefinition(id: string, draft: McpDefinitionDraft) {
  const { data } = await api.patch(`/mcp/definitions/${id}`, definitionPayload(draft));
  return unwrap<McpDefinitionDetail>(data);
}

export async function deleteMcpDefinition(id: string) {
  await api.delete(`/mcp/definitions/${id}`);
}

export async function previewMcpImport(config: unknown) {
  const { data } = await api.post('/mcp/definitions/import', {
    format: 'claude_desktop_json',
    config,
    commit: false,
  });
  return unwrap<Array<Record<string, unknown>>>(data);
}

export async function commitMcpImport(config: unknown) {
  const { data } = await api.post('/mcp/definitions/import', {
    format: 'claude_desktop_json',
    config,
    commit: true,
  });
  return unwrap<McpDefinitionDetail[]>(data);
}

export async function listMcpInstallations() {
  const { data } = await api.get('/mcp/installations');
  return unwrap<McpInstallationItem[]>(data);
}

export async function installMcpDefinition(serverId: string) {
  const { data } = await api.post(`/mcp/definitions/${serverId}/install`);
  return unwrap<McpInstallationItem>(data);
}

export async function uninstallMcpInstallation(id: string) {
  await api.delete(`/mcp/installations/${id}`);
}

export async function setMcpInstallationEnabled(id: string, enabled: boolean) {
  await api.patch(`/mcp/installations/${id}`, { enabled });
}

export async function configureMcpCredential(id: string, values: Record<string, string>) {
  await api.post(`/mcp/installations/${id}/credentials`, { values });
}


export async function initiateMcpOAuth(id: string) {
  const { data } = await api.post(`/mcp-runtime/oauth/installations/${id}/initiate`);
  return unwrap<{ authorizationUrl: string; state: string; installationId: string }>(data);
}

export async function getMcpOAuthStatus(id: string) {
  const { data } = await api.get(`/mcp-runtime/oauth/installations/${id}/status`);
  return unwrap<{
    status: 'authorization_required' | 'authorized' | 'expired' | 'revoked';
    expiresAt: string | null;
    requiredScopes: string[];
  }>(data);
}

export async function revokeMcpOAuth(id: string) {
  await api.post(`/mcp-runtime/oauth/installations/${id}/revoke`);
}

export async function connectMcpInstallation(id: string) {
  const { data } = await api.post(`/mcp/installations/${id}/connect`);
  return unwrap<{ status: 'connecting'; installationId: string }>(data);
}


export async function reconnectMcpInstallation(id: string) {
  const { data } = await api.post(`/mcp/installations/${id}/reconnect`);
  return unwrap<{ status: 'connecting'; installationId: string }>(data);
}

export async function refreshMcpTools(id: string) {
  await api.post(`/mcp/installations/${id}/tools/refresh`);
}

export async function listMcpTools(id: string) {
  const { data } = await api.get(`/mcp/installations/${id}/tools`);
  return unwrap<McpToolItem[]>(data);
}
