import { api } from '../../../../lib/api';
import type { ToolRegistryResponse } from './tool-registry.types';

export async function listRuntimeTools(): Promise<ToolRegistryResponse> {
  const { data } = await api.get<ToolRegistryResponse>('/tools/registry');
  return data;
}

export async function updateRuntimeToolEnabled(
  toolName: string,
  enabled: boolean,
): Promise<ToolRegistryResponse> {
  const encodedToolName = encodeURIComponent(
    String(toolName ?? '').trim(),
  );

  const { data } = await api.patch<ToolRegistryResponse>(
    `/tools/registry/${encodedToolName}/enabled`,
    { enabled },
  );

  return data;
}
