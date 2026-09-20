                               

import { localizeText } from '../../../../localization/localization';
import type {
  SkillDocumentDiagnostic,
  SkillImportInspection,
  SkillValidationSummary,
} from '../types/skill.types';

export type SkillValidationDisplayState =
  | 'STANDARD'
  | 'COMPATIBLE'
  | 'REJECTED'
  | 'UNKNOWN';

type UnknownRecord = Record<
  string,
  unknown
>;

function asRecord(
  value: unknown,
): UnknownRecord | null {
  return value &&
    typeof value === 'object' &&
    !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function requestResponseData(
  reason: unknown,
): unknown {
  const reasonRecord =
    asRecord(reason);

  const response =
    asRecord(
      reasonRecord?.response,
    );

  return response?.data;
}

   
              
  
                    
    
                
              
              
                 
                
                    
        
      
    
  
              
    
                
              
                
                
                   
          
        
      
    
   
function requestBody(
  reason: unknown,
): UnknownRecord | null {
  const root =
    asRecord(
      requestResponseData(reason),
    );

  if (!root) {
    return null;
  }

  const nestedData =
    asRecord(root.data);

  return nestedData ?? root;
}

function isSkillDocumentDiagnostic(
  value: unknown,
): value is SkillDocumentDiagnostic {
  const record = asRecord(value);

  return Boolean(
    record &&
      typeof record.code ===
        'string' &&
      typeof record.message ===
        'string',
  );
}

function diagnosticArray(
  value: unknown,
): SkillDocumentDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    isSkillDocumentDiagnostic,
  );
}

function uniqueDiagnostics(
  diagnostics: SkillDocumentDiagnostic[],
): SkillDocumentDiagnostic[] {
  const seen = new Set<string>();

  return diagnostics.filter(
    (diagnostic) => {
      const key = [
        diagnostic.code,
        diagnostic.severity,
        diagnostic.field ?? '',
        diagnostic.line ?? '',
        diagnostic.column ?? '',
        diagnostic.message,
      ].join(':');

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    },
  );
}

export function requestIssues(
  reason: unknown,
): SkillDocumentDiagnostic[] {
  const body =
    requestBody(reason);

  if (!body) {
    return [];
  }

  const validation =
    asRecord(body.validation);

  const diagnostics =
    uniqueDiagnostics([
      ...diagnosticArray(
        body.issues,
      ),
      ...diagnosticArray(
        body.diagnostics,
      ),
      ...diagnosticArray(
        validation?.diagnostics,
      ),
    ]);

  return diagnostics;
}

export function requestValidation(
  reason: unknown,
): SkillValidationSummary | null {
  const body =
    requestBody(reason);

  const validation =
    asRecord(body?.validation);

  if (
    !validation ||
    typeof validation.accepted !==
      'boolean'
  ) {
    return null;
  }

  return validation as unknown as SkillValidationSummary;
}

function messageFromUnknown(
  value: unknown,
): string | null {
  if (
    typeof value === 'string' &&
    value.trim()
  ) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const messages = value
      .map((item) =>
        typeof item === 'string'
          ? item.trim()
          : null,
      )
      .filter(
        (
          item,
        ): item is string =>
          Boolean(item),
      );

    return messages.length > 0
      ? messages.join('；')
      : null;
  }

  const record = asRecord(value);

  if (!record) {
    return null;
  }

  return (
    messageFromUnknown(
      record.message,
    ) ??
    messageFromUnknown(
      record.error,
    ) ??
    null
  );
}

function skillRequestCodeMessage(
  code: string,
): string | null {
  switch (code) {
    case 'SKILL_NAME_CONFLICT':
      return localizeText('skills.error.nameConflict');

    case 'SKILL_NAME_RESERVED':
      return localizeText('skills.error.nameReserved');

    case 'SKILL_IMPORT_PACKAGE_CHANGED':
    case 'SKILL_IMPORT_CHECKSUM_MISMATCH':
    case 'SKILL_IMPORT_INSPECTION_EXPIRED':
      return localizeText('skills.error.importChanged');

    case 'SKILL_IMPORT_TOKEN_INVALID':
      return localizeText('skills.error.importTokenInvalid');

    case 'SKILL_VALIDATION_REQUIRED':
      return localizeText('skills.error.validationRequired');

    case 'SKILL_VALIDATION_FAILED':
      return localizeText('skills.error.validationFailed');

    case 'SKILL_SECURITY_REVIEW_REQUIRED':
      return localizeText('skills.error.securityReviewRequired');

    case 'SKILL_SECURITY_REJECTED':
      return localizeText('skills.error.securityRejected');

    case 'SKILL_NAME_IMMUTABLE':
      return localizeText('skills.error.nameImmutable');

    case 'SKILL_DRAFT_VERSION_NOT_FOUND':
    case 'SKILL_VERSION_NOT_FOUND':
      return localizeText('skills.error.draftVersionNotFound');

    case 'SKILL_VERSION_NOT_DRAFT':
      return localizeText('skills.error.versionNotDraft');

    case 'SKILL_VERSION_ALREADY_PUBLISHED':
      return localizeText('skills.error.versionAlreadyPublished');

    case 'SKILL_ALREADY_ACTIVE':
      return localizeText('skills.error.alreadyActive');

    case 'SKILL_REVISION_CONFLICT':
    case 'SKILL_VERSION_CONFLICT':
      return localizeText('skills.error.revisionConflict');

    case 'SKILL_DISPLAY_NAME_INVALID':
      return localizeText('skills.error.displayNameInvalid');

    case 'SKILL_PACKAGE_REJECTED':
      return localizeText('skills.error.packageRejected');

    case 'SKILL_RESOURCE_NOT_FOUND':
      return localizeText('skills.error.resourceNotFound');

    case 'SKILL_NOT_FOUND':
      return localizeText('skills.error.notFound');

    case 'SKILL_PERMISSION_DENIED':
    case 'SKILL_FORBIDDEN':
      return localizeText('skills.error.permissionDenied');

    default:
      return null;
  }
}

function isGenericHttpErrorMessage(
  message: string,
): boolean {
  return (
    /^Request failed with status code \d+$/i.test(
      message.trim(),
    ) ||
    /^Network Error$/i.test(
      message.trim(),
    )
  );
}

export function requestErrorMessage(
  reason: unknown,
  fallback: string,
): string {
  const issues =
    requestIssues(reason);

  if (issues[0]?.message) {
    return issues[0].message;
  }

  const body =
    requestBody(reason);

  const code =
    typeof body?.code === 'string'
      ? body.code.trim()
      : '';

  const backendMessage =
    messageFromUnknown(
      body?.message,
    ) ??
    messageFromUnknown(
      body?.error,
    );

  if (backendMessage) {
    const localizedMessage =
      code
        ? skillRequestCodeMessage(
            code,
          )
        : null;

    if (localizedMessage) {
      return localizedMessage;
    }

    return code &&
      !backendMessage.includes(
        code,
      )
      ? localizeText('skills.error.withCode', { message: backendMessage, code })
      : backendMessage;
  }

  if (code) {
    return (
      skillRequestCodeMessage(
        code,
      ) ??
      localizeText('skills.error.requestWithCode', { code })
    );
  }

  if (
    reason instanceof Error &&
    reason.message &&
    !isGenericHttpErrorMessage(
      reason.message,
    )
  ) {
    return reason.message;
  }

  const reasonRecord =
    asRecord(reason);

  const response =
    asRecord(
      reasonRecord?.response,
    );

  const status =
    typeof response?.status ===
      'number'
      ? response.status
      : null;

  if (status === 409) {
    return localizeText('skills.error.stateConflict');
  }

  if (status === 400) {
    return localizeText('skills.error.badRequest');
  }

  if (status === 403) {
    return localizeText('skills.error.permissionDenied');
  }

  if (status === 404) {
    return localizeText('skills.error.versionMissing');
  }

  if (status === 413) {
    return localizeText('skills.error.packageTooLarge');
  }

  if (
    typeof status === 'number'
  ) {
    return localizeText('skills.error.httpStatus', { message: fallback, status });
  }

  return fallback;
}

export function metadataObject(
  rows: Array<{
    key: string;
    value: string;
  }>,
): Record<string, string> {
  const result: Record<
    string,
    string
  > = {};

  for (const row of rows) {
    const key =
      row.key.trim();

    if (!key) {
      continue;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        result,
        key,
      )
    ) {
      throw new Error(
        localizeText('skills.error.metadataDuplicate', { key }),
      );
    }

    result[key] = row.value;
  }

  return result;
}

export function actualSkillMarkdown(
  value: {
    currentVersion?: {
      skillMarkdown?: string;
    } | null;

    versions?: Array<{
      skillMarkdown?: string;
    }>;
  },
): string {
  return (
    value.currentVersion
      ?.skillMarkdown ??
    value.versions?.[0]
      ?.skillMarkdown ??
    ''
  );
}

export function draftVersionId(
  value: {
    currentVersion?: {
      id?: string;
      status?: string;
    } | null;

    versions?: Array<{
      id?: string;
      status?: string;
    }>;
  },
): string | null {
  const draftVersion =
    value.versions?.find(
      (version) =>
        version.status ===
          'DRAFT' &&
        Boolean(version.id),
    );

  if (draftVersion?.id) {
    return draftVersion.id;
  }

  if (
    value.currentVersion?.id &&
    value.currentVersion
      .status === 'DRAFT'
  ) {
    return value.currentVersion.id;
  }

  return (
    value.currentVersion?.id ??
    value.versions?.find(
      (version) =>
        Boolean(version.id),
    )?.id ??
    null
  );
}

export function metadataRowsValid(
  rows: Array<{
    key: string;
    value: string;
  }>,
): boolean {
  const seen =
    new Set<string>();

  for (const row of rows) {
    const key =
      row.key.trim();

    if (!key) {
      continue;
    }

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
  }

  return true;
}

export function hasBlockingDiagnostics(
  diagnostics: SkillDocumentDiagnostic[],
): boolean {
  return diagnostics.some(
    (item) =>
      item.severity ===
        'ERROR' ||
      item.severity ===
        'CRITICAL',
  );
}

export function importInspectionAccepted(
  inspection:
    | SkillImportInspection
    | null,
): boolean {
  if (!inspection) {
    return false;
  }

  return Boolean(
    inspection.validation
      .accepted &&
      !hasBlockingDiagnostics(
        inspection.validation
          .diagnostics ?? [],
      ),
  );
}

export function validationDisplayState(
  validation:
    | SkillValidationSummary
    | null
    | undefined,
): SkillValidationDisplayState {
  if (!validation) {
    return 'UNKNOWN';
  }

  if (!validation.accepted) {
    return 'REJECTED';
  }

  return validation.specCompliant
    ? 'STANDARD'
    : 'COMPATIBLE';
}