                                                         
import { localizeText } from '../../../../localization/localization';
import { api } from '../../../../lib/api';

import type {
  AgentSkillBindingInput,
  AgentSkillBindingsResponse,
  EffectiveAgentSkillActivationMode,
  SkillDetail,
  SkillDependencyInput,
  SkillEditorDraft,
  SkillFileRecord,
  SkillDependenciesResponse,
  SkillListParams,
  SkillListResponse,
  SkillAclEntry,
  SkillUsageEvent,
  SkillSchemaRecord,
  SkillSummary,
  SkillVersionSummary,
  SkillGenerationInput,
  SkillGenerationResult,
  SkillImportInspectResult,
  SkillImportSourceInput,
  SkillCapabilityCatalogResponse,
  SkillDeleteResult,
  SkillPermanentDeleteResult,
  SkillFileRevisionResult,
  SkillFileBatchRevisionResult,
  SkillFileUploadEntry,
} from '../types/skill.types';

function unwrap<T>(
  data: unknown,
): T {
  const record = data as {
    data?: unknown;
  } | null;

  return (
    record?.data ?? data
  ) as T;
}

function toTimestamp(
  value:
    | string
    | null
    | undefined,
): number {
  if (!value) {
    return 0;
  }

  const timestamp =
    new Date(value).getTime();

  return Number.isNaN(timestamp)
    ? 0
    : timestamp;
}

function sortSkillItems(
  items: SkillSummary[],
  sort: SkillListParams['sort'],
): SkillSummary[] {
  if (!sort) {
    return items;
  }

  return [...items].sort(
    (left, right) => {
      if (sort === 'created_desc') {
        return (
          toTimestamp(
            right.createdAt,
          ) -
            toTimestamp(
              left.createdAt,
            ) ||
          right.id.localeCompare(
            left.id,
          )
        );
      }

      if (sort === 'created_asc') {
        return (
          toTimestamp(
            left.createdAt,
          ) -
            toTimestamp(
              right.createdAt,
            ) ||
          left.id.localeCompare(
            right.id,
          )
        );
      }

      if (sort === 'updated_desc') {
        return (
          toTimestamp(
            right.updatedAt,
          ) -
            toTimestamp(
              left.updatedAt,
            ) ||
          right.id.localeCompare(
            left.id,
          )
        );
      }

      return (
        toTimestamp(
          left.updatedAt,
        ) -
          toTimestamp(
            right.updatedAt,
          ) ||
        left.id.localeCompare(
          right.id,
        )
      );
    },
  );
}

function validationIssueMessage(
  validation: {
    structuralIssues: unknown[];
    securityIssues: unknown[];
    dependencyIssues: unknown[];
    capabilityIssues: unknown[];
  },
): string | null {
  const firstIssue = [
    ...validation.structuralIssues,
    ...validation.securityIssues,
    ...validation.dependencyIssues,
    ...validation.capabilityIssues,
  ][0];

  if (
    firstIssue &&
    typeof firstIssue === 'object' &&
    'message' in firstIssue &&
    typeof (
      firstIssue as {
        message?: unknown;
      }
    ).message === 'string'
  ) {
    return (
      firstIssue as {
        message: string;
      }
    ).message;
  }

  if (typeof firstIssue === 'string') {
    return firstIssue;
  }

  return null;
}

export async function listSkills(
  params: SkillListParams = {},
) {
  const {
    sort,
    ...requestParams
  } = params;

  const { data } = await api.get(
    '/skills',
    {
      params: requestParams,
    },
  );

  const response =
    unwrap<SkillListResponse>(
      data,
    );

  return {
    ...response,
    items: sortSkillItems(
      response.items,
      sort,
    ),
  };
}

export async function getSkill(
  skillId: string,
) {
  const { data } = await api.get(
    `/skills/${skillId}`,
  );

  return unwrap<SkillDetail>(
    data,
  );
}

export async function getDeletedSkill(
  skillId: string,
) {
  const { data } = await api.get(
    `/skills/${skillId}/deleted`,
  );

  return unwrap<SkillDetail>(
    data,
  );
}

export async function listSkillCapabilities() {
  const { data } = await api.get(
    '/skills/catalog/capabilities',
  );

  return unwrap<SkillCapabilityCatalogResponse>(
    data,
  );
}

export async function generateSkill(
  payload: SkillGenerationInput,
) {
  const { data } = await api.post(
    '/skills/ai-create',
    payload,
  );

  return unwrap<SkillGenerationResult>(
    data,
  );
}

function skillImportForm(
  input: SkillImportSourceInput,
  packageChecksum?: string,
) {
  const form = new FormData();

  if (input.file) {
    form.append(
      'file',
      input.file,
    );
  }

  if (
    input.repositoryUrl?.trim()
  ) {
    form.append(
      'repositoryUrl',
      input.repositoryUrl.trim(),
    );
  }

  if (
    typeof input.content ===
      'string' &&
    input.content.length > 0
  ) {
    form.append(
      'content',
      input.content,
    );
  }

  if (packageChecksum) {
    form.append(
      'packageChecksum',
      packageChecksum,
    );
  }

  return form;
}

export async function inspectSkillImport(
  input: SkillImportSourceInput,
) {
  const { data } = await api.post(
    '/skills/import/inspect',
    skillImportForm(input),
    {
      headers: {
        'Content-Type':
          'multipart/form-data',
      },
    },
  );

  return unwrap<SkillImportInspectResult>(
    data,
  );
}

export async function commitSkillImport(
  input: SkillImportSourceInput,
  packageChecksum: string,
) {
  const { data } = await api.post(
    '/skills/import/commit',
    skillImportForm(
      input,
      packageChecksum,
    ),
    {
      headers: {
        'Content-Type':
          'multipart/form-data',
      },
    },
  );

  return unwrap<SkillDetail>(
    data,
  );
}

export async function createSkill(
  payload: SkillEditorDraft,
) {
  const { data } = await api.post(
    '/skills',
    {
      displayName:
        payload.displayName,
      skillMarkdown:
        payload.skillMarkdown,
    },
  );

  return unwrap<SkillDetail>(
    data,
  );
}

export async function updateSkill(
  skillId: string,
  payload: {
    displayName?: string;
    visibility?: string;
    defaultActivationMode?: string;
    expectedRevision?: number;
  },
) {
  const { data } = await api.patch(
    `/skills/${skillId}`,
    payload,
  );

  return unwrap<SkillSummary>(
    data,
  );
}

export async function createSkillDraftVersion(
  skillId: string,
  payload: {
    skillMarkdown: string;
    changeLog?: string;
  },
) {
  const { data } = await api.post(
    `/skills/${skillId}/versions`,
    payload,
  );

  return unwrap<SkillVersionSummary>(
    data,
  );
}

export async function updateSkillDraftVersion(
  skillId: string,
  versionId: string,
  payload: {
    skillMarkdown: string;
    changeLog?: string;
    expectedRevision?: number;
    displayName?: string;
    expectedSkillRevision?: number;
    validationPolicy?: Record<
      string,
      unknown
    >;
    failurePolicy?: Record<
      string,
      unknown
    >;
    executionPolicy?: Record<
      string,
      unknown
    >;
  },
) {
  const { data } = await api.patch(
    `/skills/${skillId}/versions/${versionId}`,
    payload,
  );

  return unwrap<SkillVersionSummary>(
    data,
  );
}

export async function validateSkill(
  skillId: string,
  versionId?: string,
) {
  const { data } = await api.post(
    `/skills/${skillId}/validate`,
    {
      versionId,
    },
  );

  return unwrap<{
    valid: boolean;
    versionId: string;
    structuralIssues: unknown[];
    securityIssues: unknown[];
    dependencyIssues: unknown[];
    capabilityIssues: unknown[];
  }>(data);
}

export async function activateSkillVersion(
  skillId: string,
  versionId?: string,
) {
  const { data } = await api.post(
    `/skills/${skillId}/publish`,
    {
      versionId,
    },
  );

  return unwrap<{
    skill: SkillSummary;
    version: SkillVersionSummary;
  }>(data);
}

export async function validateAndActivateSkill(
  skillId: string,
  versionId?: string,
) {
  const validation =
    await validateSkill(
      skillId,
      versionId,
    );

  if (!validation.valid) {
    const message =
      validationIssueMessage(
        validation,
      );

    throw new Error(
      message
        ? localizeText('skills.validation.failedWithMessage', { message })
        : localizeText('skills.validation.failed'),
    );
  }

  return activateSkillVersion(
    skillId,
    versionId,
  );
}

export async function setSkillLifecycle(
  skillId: string,
  action:
    | 'disable'
    | 'archive'
    | 'restore',
) {
  const { data } = await api.post(
    `/skills/${skillId}/${action}`,
  );

  return unwrap<SkillSummary>(
    data,
  );
}

export async function restoreDeletedSkill(
  skillId: string,
) {
  const { data } = await api.post(
    `/skills/${skillId}/restore-deleted`,
  );

  return unwrap<SkillSummary>(
    data,
  );
}

export async function deleteSkill(
  skillId: string,
) {
  const { data } = await api.delete(
    `/skills/${skillId}`,
  );

  return unwrap<SkillDeleteResult>(
    data,
  );
}

export async function permanentlyDeleteSkill(
  skillId: string,
) {
  const { data } = await api.delete(
    `/skills/${skillId}/permanent`,
  );

  return unwrap<SkillPermanentDeleteResult>(
    data,
  );
}

export async function listSkillFiles(
  skillId: string,
  versionId: string,
) {
  const { data } = await api.get(
    `/skills/${skillId}/versions/${versionId}/files`,
  );

  return unwrap<SkillFileRecord[]>(
    data,
  );
}

export async function uploadSkillFile(
  skillId: string,
  versionId: string,
  file: File,
  path: string,
  fileType?: string,
) {
  const form = new FormData();

  form.append(
    'file',
    file,
  );

  form.append(
    'path',
    path,
  );

  if (fileType) {
    form.append(
      'fileType',
      fileType,
    );
  }

  const { data } = await api.post(
    `/skills/${skillId}/versions/${versionId}/files`,
    form,
    {
      headers: {
        'Content-Type':
          'multipart/form-data',
      },
    },
  );

  return unwrap<SkillFileRevisionResult>(
    data,
  );
}

export async function deleteSkillFile(
  skillId: string,
  versionId: string,
  fileId: string,
) {
  const { data } = await api.delete(
    `/skills/${skillId}/versions/${versionId}/files/${fileId}`,
  );

  return unwrap<SkillFileRevisionResult>(
    data,
  );
}

export async function uploadSkillFiles(
  skillId: string,
  versionId: string,
  entries: SkillFileUploadEntry[],
) {
  const form = new FormData();

  for (const entry of entries) {
    form.append(
      'files',
      entry.file,
    );
  }

  form.append(
    'entries',
    JSON.stringify(
      entries.map((entry) => ({
        path: entry.path,
        fileType: entry.fileType,
      })),
    ),
  );

  const { data } = await api.post(
    `/skills/${skillId}/versions/${versionId}/files/batch`,
    form,
    {
      headers: {
        'Content-Type':
          'multipart/form-data',
      },
    },
  );

  return unwrap<SkillFileBatchRevisionResult>(
    data,
  );
}

export async function deleteSkillFiles(
  skillId: string,
  versionId: string,
  fileIds: string[],
) {
  const { data } = await api.delete(
    `/skills/${skillId}/versions/${versionId}/files/batch`,
    {
      data: {
        fileIds,
      },
    },
  );

  return unwrap<SkillFileBatchRevisionResult>(
    data,
  );
}

export async function getAgentSkillBindings(
  agentId: string,
) {
  const { data } = await api.get(
    `/agents/cognitive/${agentId}/skills`,
  );

  return unwrap<AgentSkillBindingsResponse>(
    data,
  );
}

export async function replaceAgentSkillBindings(
  input: {
    agentId: string;
    expectedRevision: number;
    defaultActivationMode: EffectiveAgentSkillActivationMode;
    bindings: AgentSkillBindingInput[];
  },
) {
  const {
    agentId,
    ...payload
  } = input;

  try {
    const { data } = await api.put(
      `/agents/cognitive/${agentId}/skills`,
      payload,
    );

    return unwrap<AgentSkillBindingsResponse>(
      data,
    );
  } catch (reason) {
    const responseData =
      reason && typeof reason === 'object'
        ? (
            reason as {
              response?: {
                data?: unknown;
              };
            }
          ).response?.data
        : undefined;

    const root =
      responseData && typeof responseData === 'object'
        ? responseData as Record<string, unknown>
        : null;
    const body =
      root?.data && typeof root.data === 'object'
        ? root.data as Record<string, unknown>
        : root;
    const code =
      typeof body?.code === 'string'
        ? body.code
        : '';

    if (code === 'SKILL_DELETED_RESTORE_REQUIRED') {
      throw new Error(
        localizeText('skills.deleted.restoreFirst'),
      );
    }

    if (code === 'SKILL_DELETED_CANNOT_BIND') {
      throw new Error(
        localizeText('skills.deleted.bindingBlocked'),
      );
    }

    if (
      typeof body?.message === 'string' &&
      body.message.trim()
    ) {
      throw new Error(body.message);
    }

    throw reason;
  }
}

export async function getSkillDependencies(
  skillId: string,
  versionId: string,
) {
  const { data } = await api.get(
    `/skills/${skillId}/versions/${versionId}/dependencies`,
  );

  return unwrap<SkillDependenciesResponse>(
    data,
  );
}

export async function replaceSkillDependencies(
  skillId: string,
  versionId: string,
  payload: {
    skillDependencies: SkillDependencyInput[];
    toolDependencies: SkillDependencyInput[];
    mcpDependencies: SkillDependencyInput[];
  },
) {
  const { data } = await api.put(
    `/skills/${skillId}/versions/${versionId}/dependencies`,
    payload,
  );

  return unwrap<SkillDependenciesResponse>(
    data,
  );
}

export async function getSkillSchemas(
  skillId: string,
  versionId: string,
) {
  const { data } = await api.get(
    `/skills/${skillId}/versions/${versionId}/schemas`,
  );

  return unwrap<SkillSchemaRecord[]>(
    data,
  );
}

export async function replaceSkillSchemas(
  skillId: string,
  versionId: string,
  schemas: Array<{
    kind:
      | 'INPUT'
      | 'OUTPUT'
      | 'CONFIG';
    schema: Record<
      string,
      unknown
    >;
  }>,
) {
  const { data } = await api.put(
    `/skills/${skillId}/versions/${versionId}/schemas`,
    {
      schemas,
    },
  );

  return unwrap<SkillSchemaRecord[]>(
    data,
  );
}

export async function updateSkillSource(
  skillId: string,
  payload: {
    kind: string;
    sourceRef?:
      | string
      | null;
    sourceRevision?:
      | string
      | null;
    provenance?: Record<
      string,
      unknown
    >;
    lockData?: Record<
      string,
      unknown
    >;
    checksum?:
      | string
      | null;
  },
) {
  const { data } = await api.patch(
    `/skills/${skillId}/source`,
    payload,
  );

  return unwrap<unknown>(
    data,
  );
}

export async function getSkillPermissions(
  skillId: string,
) {
  const { data } = await api.get(
    `/skills/${skillId}/permissions`,
  );

  return unwrap<SkillAclEntry[]>(
    data,
  );
}

export async function replaceSkillPermissions(
  skillId: string,
  entries: SkillAclEntry[],
) {
  const { data } = await api.post(
    `/skills/${skillId}/permissions`,
    {
      entries,
    },
  );

  return unwrap<SkillAclEntry[]>(
    data,
  );
}

export async function getSkillUsage(
  skillId: string,
  limit = 50,
) {
  const { data } = await api.get(
    `/skills/${skillId}/usage`,
    {
      params: {
        limit,
      },
    },
  );

  return unwrap<SkillUsageEvent[]>(
    data,
  );
}

export async function quarantineSkill(
  skillId: string,
  reason: string,
) {
  const { data } = await api.post(
    `/skills/${skillId}/quarantine`,
    {
      reason,
    },
  );

  return unwrap<SkillSummary>(
    data,
  );
}

export async function restoreSkillSecurity(
  skillId: string,
) {
  const { data } = await api.post(
    `/skills/${skillId}/security-restore`,
  );

  return unwrap<SkillSummary>(
    data,
  );
}

export async function setSkillPinned(
  skillId: string,
  pinned: boolean,
) {
  const { data } = pinned
    ? await api.post(
        `/skills/${skillId}/pin`,
      )
    : await api.delete(
        `/skills/${skillId}/pin`,
      );

  return unwrap<SkillSummary>(
    data,
  );
}