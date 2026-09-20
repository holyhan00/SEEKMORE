import { api } from '../../../lib/api';
import { authFetch } from '../../../lib/http';
import { localizeText } from '../../../localization/localization';
import { buildSeekmoreDownloadFilename } from '../../../utils/download-filename';
import { resolveRuntimeObjectUrl } from '../../../utils/runtime-object-url';
import type { ObjectPreviewManifest } from './object-preview.types';

export async function getObjectPreviewManifest(
  objectId: string,
): Promise<ObjectPreviewManifest> {
  const { data } = await api.get(
    `/objects/${encodeURIComponent(objectId)}/preview-manifest`,
  );

  return data?.data as ObjectPreviewManifest;
}

export async function fetchObjectPreviewBlob(
  url: string,
): Promise<Blob> {
  const resolved = resolveRuntimeObjectUrl(url);
  const response = await authFetch(resolved, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(
      `OBJECT_PREVIEW_FETCH_FAILED:${response.status}`,
    );
  }

  return response.blob();
}

export async function fetchObjectPreviewText(
  url: string,
): Promise<string> {
  const resolved = resolveRuntimeObjectUrl(url);
  const response = await authFetch(resolved, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(
      `OBJECT_PREVIEW_FETCH_FAILED:${response.status}`,
    );
  }

  return response.text();
}

export async function downloadObjectFile(
  url: string,
  filename: string,
): Promise<void> {
  const resolved = resolveRuntimeObjectUrl(url);
  if (!resolved) return;

  if (
    resolved.startsWith('blob:')
    || resolved.startsWith('data:')
  ) {
    const anchor =
      document.createElement('a');
    anchor.href = resolved;
    anchor.download =
      buildSeekmoreDownloadFilename(filename);
    anchor.click();
    return;
  }

  const response = await authFetch(
    resolved,
    { method: 'GET' },
  );

  if (!response.ok) {
    const text = await response
      .text()
      .catch(() => '');

    throw new Error(
      text
      || localizeText(
        'chat.download.failedStatus',
        { status: response.status },
      ),
    );
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = objectUrl;
  anchor.download =
    buildSeekmoreDownloadFilename(filename);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  window.setTimeout(
    () => URL.revokeObjectURL(objectUrl),
    3000,
  );
}
