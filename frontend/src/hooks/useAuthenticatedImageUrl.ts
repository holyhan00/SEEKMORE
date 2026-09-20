import { useEffect, useState } from 'react';

import {
  authFetch,
  getAbsoluteApiUrl,
} from '../lib/http';

function isAuthenticatedProfileUrl(
  value: string,
): boolean {
  return (
    (
      value.includes('/api/agent/')
      && value.includes('/profile/')
    )
    || value.includes('/api/user/avatar')
  );
}

function requestUrl(value: string): string {
  return value.startsWith('/api/')
    ? getAbsoluteApiUrl(value)
    : value;
}

export function useAuthenticatedImageUrl(
  sourceUrl?: string | null,
): string {
  const source = String(sourceUrl ?? '').trim();
  const requiresAuth =
    Boolean(source)
    && isAuthenticatedProfileUrl(source);

  const [resolvedUrl, setResolvedUrl] =
    useState<string>(
      requiresAuth ? '' : source,
    );

  useEffect(() => {
    if (!source) {
      setResolvedUrl('');
      return;
    }

    if (!requiresAuth) {
      setResolvedUrl(source);
      return;
    }

    const controller = new AbortController();
    let objectUrl = '';
    let active = true;

    setResolvedUrl('');

    void authFetch(
      requestUrl(source),
      {
        method: 'GET',
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `AGENT_PROFILE_IMAGE_LOAD_FAILED:${response.status}`,
          );
        }

        return response.blob();
      })
      .then((blob) => {
        if (!active) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setResolvedUrl(objectUrl);
      })
      .catch((error) => {
        if (
          active
          && !(error instanceof DOMException && error.name === 'AbortError')
        ) {
          setResolvedUrl('');
        }
      });

    return () => {
      active = false;
      controller.abort();

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [requiresAuth, source]);

  return resolvedUrl;
}
