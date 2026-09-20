import { api } from '../../lib/api';
import type {
  ExploreAgentItem,
  ExploreResourceItem,
  ExploreSkillItem,
} from './explore.types';

function unwrap<T>(value: unknown): T {
  const row = value as { data?: unknown } | null;
  return (row?.data ?? value) as T;
}

export async function listExploreAgents(query = '') {
  const { data } = await api.get('/explore/agents', { params: query ? { q: query } : undefined });
  return unwrap<ExploreAgentItem[]>(data);
}

export async function listExploreSkills(query = '') {
  const { data } = await api.get('/explore/skills', { params: query ? { q: query } : undefined });
  return unwrap<ExploreSkillItem[]>(data);
}

export async function listFeaturedResources() {
  const { data } = await api.get('/explore/featured');
  return unwrap<ExploreResourceItem[]>(data);
}

export async function listPopularResources() {
  const { data } = await api.get('/explore/popular');
  return unwrap<ExploreResourceItem[]>(data);
}

export async function joinAgent(item: ExploreAgentItem) {
  const endpoint = item.visibility === 'PUBLIC_PAID'
    ? `/agent/store/${item.id}/authorize`
    : `/agent/store/${item.id}/claim`;
  await api.post(endpoint);
}

export async function installSkill(skillId: string) {
  await api.post(`/skills/${skillId}/install`);
}

export async function installMcp(serverId: string) {
  const { data } = await api.post(`/mcp/definitions/${serverId}/install`);
  return unwrap<{ installationId?: string; id?: string }>(data);
}

export async function connectMcp(installationId: string) {
  await api.post(`/mcp/installations/${installationId}/connect`);
}

export async function reconnectMcp(installationId: string) {
  await api.post(`/mcp/installations/${installationId}/reconnect`);
}


export async function initiateMcpOAuth(installationId: string) {
  const { data } = await api.post(`/mcp-runtime/oauth/installations/${installationId}/initiate`);
  return unwrap<{ authorizationUrl: string; installationId: string }>(data);
}

export async function getMcpOAuthStatus(installationId: string) {
  const { data } = await api.get(`/mcp-runtime/oauth/installations/${installationId}/status`);
  return unwrap<{
    status: 'authorization_required' | 'authorized' | 'expired' | 'revoked';
    expiresAt: string | null;
    requiredScopes: string[];
  }>(data);
}
