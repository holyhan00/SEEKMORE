import { api } from '../../../../lib/api';
import type { ActiveWorkflowSnapshot } from './workflow.types';

export async function getActiveWorkflow(
  agentId: string,
  conversationId: string,
): Promise<ActiveWorkflowSnapshot | null> {
  const response = await api.get('/seekmore-workflows/active', {
    params: { agentId, conversationId },
  });
  return (response.data?.data ?? null) as ActiveWorkflowSnapshot | null;
}
