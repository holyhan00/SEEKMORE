// frontend/src/components/chat/object-card/previews/AudioObjectPreview.tsx

import {
  useEffect,
  useState,
} from 'react';

import type {
  ChatObjectCard,
} from '../../../../utils/types';

import {
  useLocalize,
} from '../../../../localization/useLocalize';

import {
  fetchObjectPreviewBlob,
  getObjectPreviewManifest,
} from '../../object-preview/object-preview.client';

export default function AudioObjectPreview({
  object,
}: {
  object: ChatObjectCard;
}) {
  const localize = useLocalize();

  const [
    audioUrl,
    setAudioUrl,
  ] = useState('');

  const [
    failed,
    setFailed,
  ] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    setAudioUrl('');
    setFailed(false);

    const load = async () => {
      try {
        const manifest =
          await getObjectPreviewManifest(
            object.objectId,
          );

        const preview =
          manifest.preview;

        if (
          !preview.available
          || preview.kind !== 'audio'
          || !preview.url
        ) {
          if (!cancelled) {
            setFailed(true);
          }

          return;
        }

        const blob =
          await fetchObjectPreviewBlob(
            preview.url,
          );

        const nextObjectUrl =
          URL.createObjectURL(
            blob,
          );

        if (cancelled) {
          URL.revokeObjectURL(
            nextObjectUrl,
          );

          return;
        }

        objectUrl =
          nextObjectUrl;

        setAudioUrl(
          nextObjectUrl,
        );
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;

      if (objectUrl) {
        URL.revokeObjectURL(
          objectUrl,
        );
      }
    };
  }, [
    object.objectId,
  ]);

  const metadata = [
    object.media?.format,
    durationText(
      object.media?.durationMs,
    ),
    hzText(
      object.media?.sampleRate,
    ),
    channelText(
      object.media?.channels,
    ),
    bitrateText(
      object.media?.bitrate,
    ),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="min-w-0">
      {audioUrl && !failed ? (
        <audio
          className="h-10 w-full"
          controls
          preload="metadata"
          src={audioUrl}
          onError={() => {
            setFailed(true);
          }}
        >
          {localize(
            'chat.audio.unsupportedBrowser',
          )}
        </audio>
      ) : (
        <div className="h-10 w-full" />
      )}

      {metadata ? (
        <div className="mt-2 min-w-0 truncate text-[10px] opacity-60">
          {metadata}
        </div>
      ) : null}
    </div>
  );
}

function durationText(
  value?: number,
): string {
  if (
    !value
    || value <= 0
  ) {
    return '';
  }

  const seconds =
    Math.round(
      value / 1000,
    );

  const minutes =
    Math.floor(
      seconds / 60,
    );

  return `${minutes}:${String(
    seconds % 60,
  ).padStart(2, '0')}`;
}

function hzText(
  value?: number,
): string {
  if (
    !value
    || value <= 0
  ) {
    return '';
  }

  return `${Math.round(
    value,
  )}Hz`;
}

function channelText(
  value?: number,
): string {
  if (
    !value
    || value <= 0
  ) {
    return '';
  }

  if (value === 1) {
    return 'Mono';
  }

  if (value === 2) {
    return 'Stereo';
  }

  return `${value}ch`;
}

function bitrateText(
  value?: number,
): string {
  if (
    !value
    || value <= 0
  ) {
    return '';
  }

  return `${Math.round(
    value / 1000,
  )}kbps`;
}