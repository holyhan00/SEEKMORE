//frontend/src/components/chat/object-card/previews/ImageObjectPreview.tsx
import { useLocalize } from '../../../../localization/useLocalize';                                                                         
import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import ObjectRemoveButton from '../ObjectRemoveButton';
import {
  resolveRuntimeObjectUrl,
} from '../../../../utils/runtime-object-url';
import {
  buildSeekmoreDownloadFilename,
} from '../../../../utils/download-filename';
import {
  acquireAuthenticatedImage,
  type AcquiredImageResource,
} from './image-resource-cache';

const COMPOSER_IMAGE_SIZE = 96;
const USER_IMAGE_MAX_WIDTH = 168;
const ASSISTANT_IMAGE_MAX_WIDTH = 280;
const USER_IMAGE_MAX_HEIGHT = 260;
const ASSISTANT_IMAGE_MAX_HEIGHT = 440;
const FALLBACK_IMAGE_RATIO = 4 / 3;

export interface ImageObjectPreviewProps {
  title: string;
  originalName?: string;
  source?: string;
  cacheKey?: string;
  media?: {
    width?: number;
    height?: number;
  };

  displayRole: 'user' | 'assistant';
  layout?: 'natural' | 'gallery';
  fit?: 'contain' | 'cover';
  composer?: boolean;
  authenticated?: boolean;
  statusText?: string;
  statusError?: boolean;
  onOpen?: () => void;
  onRemove?: () => void;
  removeDisabled?: boolean;
}

export default function ImageObjectPreview({
  title,
  originalName,
  source,
  cacheKey,
  media,
    displayRole,
  layout = 'natural',
  fit = 'contain',
  composer = false,
  authenticated = false,
  statusText,
  statusError = false,
  onOpen,
  onRemove,
  removeDisabled = false,
}: ImageObjectPreviewProps) {
  const localize = useLocalize();
  const sourceUrl = useMemo(
    () => resolveRuntimeObjectUrl(source),
    [source],
  );

  const dimensions = useMemo(
    () => resolveDisplayDimensions({
      composer,
      displayRole,
      width: media?.width,
      height: media?.height,
    }),
    [
      composer,
      displayRole,
      media?.height,
      media?.width,
    ],
  );

  const [imageUrl, setImageUrl] =
    useState('');

  const [failed, setFailed] =
    useState(false);

  useEffect(() => {
    let alive = true;

    let acquired:
      AcquiredImageResource
      | null = null;

    setFailed(false);
    setImageUrl('');

    const load = async () => {
      if (!sourceUrl) {
        if (alive) {
          setFailed(true);
        }

        return;
      }

      if (
        !authenticated
        || sourceUrl.startsWith('blob:')
        || sourceUrl.startsWith('data:')
      ) {
        if (alive) {
          setImageUrl(sourceUrl);
        }

        return;
      }

      try {
        acquired =
          await acquireAuthenticatedImage(
            cacheKey || sourceUrl,
            sourceUrl,
          );

        if (alive) {
          setImageUrl(acquired.url);
        } else {
          acquired.release();
          acquired = null;
        }
      } catch {
        if (alive) {
          setFailed(true);
        }
      }
    };

    void load();

    return () => {
      alive = false;
      acquired?.release();
    };
  }, [
    authenticated,
    cacheKey,
    sourceUrl,
  ]);

  const activate = () => {
    if (composer || !imageUrl) {
      return;
    }

    if (onOpen) {
      onOpen();
      return;
    }

    const anchor =
      document.createElement('a');

    anchor.href = imageUrl;
    anchor.download =
      buildSeekmoreDownloadFilename(
        originalName
        || title
        || 'image',
      );

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const gallery =
    layout === 'gallery';

  const resolvedFit = gallery
    ? 'contain'
    : fit;

  const borderRadiusClass = gallery
    ? 'rounded-none'
    : 'rounded-[10px]';

  return (
    <div
      className={[
        'group/image block text-left',
        gallery
          ? 'h-full w-full min-h-0 min-w-0 overflow-hidden'
          : 'shrink-0',
        !composer && !gallery
          ? 'hover:shadow-lg'
          : '',
      ].join(' ')}
      style={
        gallery
          ? {
              width: '100%',
              height: '100%',
              minWidth: 0,
              minHeight: 0,
            }
          : {
              width:
                `${dimensions.width}px`,
              maxWidth: '100%',
              aspectRatio:
                `${dimensions.width} / ${dimensions.height}`,
              ...(composer
                ? {
                    height:
                      `${dimensions.height}px`,
                  }
                : {}),
            }
      }
    >
      <div
        className={[
          'relative h-full w-full overflow-hidden',
          borderRadiusClass,
        ].join(' ')}
      >
        <button
          type="button"
          disabled={
            composer || !imageUrl
          }
          onClick={activate}
          className={[
            'block h-full w-full cursor-pointer overflow-hidden',
            'bg-transparent p-0 text-left disabled:cursor-default',
            borderRadiusClass,
          ].join(' ')}
          style={{
            width: '100%',
            height: '100%',
            padding: 0,
            border: 0,
            background: 'transparent',
          }}
        >
          {imageUrl && !failed ? (
            <img
              src={imageUrl}
              alt={title}
              width={
                gallery
                  ? undefined
                  : dimensions.width
              }
              height={
                gallery
                  ? undefined
                  : dimensions.height
              }
              draggable={false}
              decoding="async"
              loading="eager"
              onError={() => {
                setFailed(true);
              }}
              className={[
                'block h-full w-full',
                borderRadiusClass,
              ].join(' ')}
              style={{
                width: '100%',
                height: '100%',
                objectFit: resolvedFit,
                objectPosition: 'center',
              }}
            />
          ) : (
            <div
              className={[
                'flex h-full w-full items-center justify-center text-[11px]',
                borderRadiusClass,
                'bg-[#ececec] text-gray-400 dark:bg-[#2b2b2b] dark:text-gray-500',
              ].join(' ')}
            >
              {failed
                ? localize('object.imageLoadFailed')
                : null}
            </div>
          )}
        </button>

        {statusText ? (
          <div
            className={[
              'pointer-events-none absolute inset-0 flex items-end p-2',
              borderRadiusClass,
              statusError
                ? 'bg-red-950/55'
                : 'bg-[#000000]/35',
            ].join(' ')}
          >
            <span className="rounded-[6px] bg-[#000000]/55 px-2 py-1 text-[10px] text-[#ffffff]">
              {statusText}
            </span>
          </div>
        ) : null}

        {onRemove ? (
          <div className="absolute right-[2px] top-[2px] z-30">
            <ObjectRemoveButton
              disabled={removeDisabled}
              onRemove={onRemove}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function resolveDisplayDimensions(input: {
  composer: boolean;
  displayRole: 'user' | 'assistant';
  width?: number;
  height?: number;
}): {
  width: number;
  height: number;
} {
  if (input.composer) {
    return {
      width: COMPOSER_IMAGE_SIZE,
      height: COMPOSER_IMAGE_SIZE,
    };
  }

  const maximumWidth =
    input.displayRole === 'user'
      ? USER_IMAGE_MAX_WIDTH
      : ASSISTANT_IMAGE_MAX_WIDTH;

  const maximumHeight =
    input.displayRole === 'user'
      ? USER_IMAGE_MAX_HEIGHT
      : ASSISTANT_IMAGE_MAX_HEIGHT;

  const sourceWidth =
    finitePositive(input.width);

  const sourceHeight =
    finitePositive(input.height);

  if (!sourceWidth || !sourceHeight) {
    return {
      width: maximumWidth,
      height: Math.min(
        maximumHeight,
        Math.round(
          maximumWidth
          / FALLBACK_IMAGE_RATIO,
        ),
      ),
    };
  }

  const scale = Math.min(
    1,
    maximumWidth / sourceWidth,
    maximumHeight / sourceHeight,
  );

  return {
    width: Math.max(
      1,
      Math.round(
        sourceWidth * scale,
      ),
    ),
    height: Math.max(
      1,
      Math.round(
        sourceHeight * scale,
      ),
    ),
  };
}

function finitePositive(
  value: unknown,
): number | null {
  const number = Number(value);

  return Number.isFinite(number)
    && number > 0
      ? number
      : null;
}