import { localizeApiError } from '../localization/localizeApiError';

export function resolveMcpRequestError(
  cause: unknown,
  fallbackKey = 'errors.mcp.operationFailed',
): string {
  return localizeApiError(cause, fallbackKey);
}
