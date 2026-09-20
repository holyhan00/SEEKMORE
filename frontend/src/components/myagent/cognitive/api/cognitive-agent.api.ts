import { api } from '../../../../lib/api';
import type {
  CognitiveAgent,
  CognitiveAgentKnowledgeFile,
  CognitiveAgentKnowledgeUploadPayload,
  CognitiveAgentValidationResult,
  CreateCognitiveAgentPayload,
  UpdateCognitiveAgentPayload,
} from './cognitive-agent.types';

function unwrap<T>(data: unknown): T {
  const record = data as { data?: unknown } | null;
  return (record?.data ?? data) as T;
}

function appendSpecs(form: FormData, specs?: unknown[]) {
  if (specs?.length) {
    form.append('knowledgeFileSpecs', JSON.stringify(specs));
  }
}

function appendFiles(form: FormData, files?: File[]) {
  for (const file of files ?? []) {
    form.append('knowledgeObjects', file);
  }
}

const KNOWLEDGE_UPLOAD_BATCH_SIZE = 10;

function appendCommon(
  form: FormData,
  payload: CreateCognitiveAgentPayload | UpdateCognitiveAgentPayload,
) {
  form.append('name', payload.name);
  form.append('description', payload.description || '');
  form.append('rolePrompt', payload.rolePrompt);


  if (payload.capabilities?.length) {
    form.append('capabilities', JSON.stringify(payload.capabilities));
  }

  if (payload.avatarFile) {
    form.append('avatarFile', payload.avatarFile);
  }

  if (payload.coverFile) {
    form.append('coverFile', payload.coverFile);
  }

}

export async function createCognitiveAgent(
  payload: CreateCognitiveAgentPayload,
) {
  const form = new FormData();
  appendCommon(form, payload);

  const { data } = await api.post('/agents/cognitive', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  const agent = unwrap<CognitiveAgent>(data);

  if (!payload.knowledgeFiles.length) {
    return agent;
  }

  try {
    const knowledgeObjects =
      await uploadCognitiveAgentKnowledge(
        agent.id,
        {
          files: payload.knowledgeFiles,
          specs: payload.knowledgeFileSpecs ?? [],
        },
      );

    return {
      ...agent,
      knowledgeFiles: knowledgeObjects,
      knowledgeObjects,
      knowledgeFileCount: knowledgeObjects.length,
    };
  } catch (reason) {
    await permanentlyDeleteCognitiveAgent(
      agent.id,
    ).catch(() => undefined);

    throw reason;
  }
}

export async function updateCognitiveAgent(
  agentId: string,
  payload: UpdateCognitiveAgentPayload,
) {
  const form = new FormData();
  appendCommon(form, payload);

  const { data } = await api.patch(`/agents/cognitive/${agentId}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  const agent = unwrap<CognitiveAgent>(data);
  const knowledgeFiles = payload.knowledgeFiles ?? [];

  if (!knowledgeFiles.length) {
    return agent;
  }

  const knowledgeObjects =
    await uploadCognitiveAgentKnowledge(
      agentId,
      {
        files: knowledgeFiles,
        specs: payload.knowledgeFileSpecs ?? [],
      },
    );

  return {
    ...agent,
    knowledgeFiles: knowledgeObjects,
    knowledgeObjects,
    knowledgeFileCount: knowledgeObjects.length,
  };
}

export async function listMyCognitiveAgents() {
  const { data } = await api.get('/agents/cognitive/my');
  return unwrap<CognitiveAgent[]>(data);
}

export async function listDeletedCognitiveAgents() {
  const { data } = await api.get('/agents/cognitive/deleted');
  return unwrap<CognitiveAgent[]>(data);
}

export async function getCognitiveAgent(agentId: string) {
  const { data } = await api.get(`/agents/cognitive/${agentId}`);
  return unwrap<CognitiveAgent>(data);
}

export async function restoreCognitiveAgent(agentId: string) {
  const { data } = await api.post(`/agents/cognitive/${agentId}/restore`);
  return unwrap<CognitiveAgent>(data);
}

export async function permanentlyDeleteCognitiveAgent(
  agentId: string,
) {
  const { data } = await api.delete(
    `/agents/cognitive/${agentId}/permanent`,
  );

  return unwrap<{
    id: string;
    permanentlyDeleted: true;
    conversationCount: number;
    messageCount: number;
    runtimeObjectCount: number;
  }>(data);
}

async function uploadCognitiveAgentKnowledgeBatch(
  agentId: string,
  files: File[],
  specs: CognitiveAgentKnowledgeUploadPayload['specs'],
) {
  const form = new FormData();
  appendFiles(form, files);
  appendSpecs(form, specs);

  const { data } = await api.post(
    `/agents/cognitive/${agentId}/knowledge/upload`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );

  return unwrap<{ objects: CognitiveAgentKnowledgeFile[] }>(data).objects;
}

export async function uploadCognitiveAgentKnowledge(
  agentId: string,
  payload: CognitiveAgentKnowledgeUploadPayload,
) {
  if (!payload.files.length) {
    return listCognitiveAgentKnowledge(agentId);
  }

  let objects: CognitiveAgentKnowledgeFile[] = [];

  for (
    let start = 0;
    start < payload.files.length;
    start += KNOWLEDGE_UPLOAD_BATCH_SIZE
  ) {
    const files = payload.files.slice(
      start,
      start + KNOWLEDGE_UPLOAD_BATCH_SIZE,
    );

    const specs = payload.specs
      .slice(
        start,
        start + KNOWLEDGE_UPLOAD_BATCH_SIZE,
      )
      .map((spec, fileIndex) => ({
        ...spec,
        fileIndex,
      }));

    objects = await uploadCognitiveAgentKnowledgeBatch(
      agentId,
      files,
      specs,
    );
  }

  return objects;
}

export async function listCognitiveAgentKnowledge(agentId: string) {
  const { data } = await api.get(`/agents/cognitive/${agentId}/knowledge`);
  return unwrap<CognitiveAgentKnowledgeFile[]>(data);
}

export async function validateCognitiveAgent(agentId: string) {
  const { data } = await api.post(`/agents/cognitive/${agentId}/validate`);
  return unwrap<CognitiveAgentValidationResult>(data);
}

export async function reparseCognitiveAgentKnowledge(agentId: string) {
  const { data } = await api.post(
    `/agents/cognitive/${agentId}/knowledge/reparse`,
  );
  return unwrap<{ ok: boolean; status: string }>(data);
}

export async function deleteCognitiveAgentKnowledge(
  agentId: string,
  fileId: string,
) {
  const { data } = await api.delete(
    `/agents/cognitive/${agentId}/knowledge/${fileId}`,
  );
  return unwrap<{ ok: boolean }>(data);
}

export async function deleteCognitiveAgent(agentId: string) {
  const { data } = await api.delete(`/agents/cognitive/${agentId}`);
  return unwrap<{ ok: boolean; deletedAt: string; purgeAfter: string }>(data);
}
