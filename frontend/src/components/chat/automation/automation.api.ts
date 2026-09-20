import { api } from '../../../lib/http';
import type { AutomationSnapshot, AutomationUpdatePayload } from './automation.types';

export async function fetchConversationAutomations(conversationId: string): Promise<AutomationSnapshot[]> {
  const { data } = await api.get<{ items?: AutomationSnapshot[] }>('/automation', {
    params: { conversationId },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchAutomationSummary(conversationId: string): Promise<{ activeCount: number }> {
  const { data } = await api.get<{ activeCount?: number }>(
    `/automation/conversation/${encodeURIComponent(conversationId)}/summary`,
  );
  return { activeCount: Number(data?.activeCount ?? 0) || 0 };
}

export async function updateAutomation(id: string, payload: AutomationUpdatePayload): Promise<AutomationSnapshot> {
  const { data } = await api.patch<AutomationSnapshot>(`/automation/${encodeURIComponent(id)}`, payload);
  return data;
}

export async function pauseAutomation(id: string): Promise<AutomationSnapshot> {
  const { data } = await api.post<AutomationSnapshot>(`/automation/${encodeURIComponent(id)}/pause`, {});
  return data;
}

export async function resumeAutomation(id: string): Promise<AutomationSnapshot> {
  const { data } = await api.post<AutomationSnapshot>(`/automation/${encodeURIComponent(id)}/resume`, {});
  return data;
}

export async function cancelAutomation(id: string): Promise<AutomationSnapshot> {
  const { data } = await api.post<AutomationSnapshot>(`/automation/${encodeURIComponent(id)}/cancel`, {
    reason: 'user_cancelled',
  });
  return data;
}
