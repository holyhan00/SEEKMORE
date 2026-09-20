import { useLocalize } from '../../../localization/useLocalize';
                                                                 

import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

import type {
  ChatObjectCard,
} from '../../../utils/types';
import ImageGenerationPlaceholder
  from '../ChatMessage/parts/ImageGenerationPlaceholder';
import ObjectCardOut from './ObjectCardOut';
import {
  calculateImageBatchPageLayout,
  getImageBatchPage,
  getImageBatchPageCount,
  sortImageBatch,
} from './image-batch-layout';

const GALLERY_MAX_SIZE = 360;
const GALLERY_PADDING = 8;
const GALLERY_GAP = 8;

type ImageBatchRenderItem =
  | {
      type: 'image';
      key: string;
      image: ChatObjectCard;
      media?: ChatObjectCard['media'];
    }
  | {
      type: 'placeholder';
      key: 'image-generation-placeholder';
      media?: ChatObjectCard['media'];
    };

export default function ImageBatchGallery({
  batchId,
  images,
    generating = false,
  pendingMedia,
}: {
  batchId: string;
  images: ChatObjectCard[];

  generating?: boolean;
  pendingMedia?: ChatObjectCard['media'];
}) {
  const localize = useLocalize();
  const sortedImages = useMemo(
    () => sortImageBatch(images),
    [images],
  );

  const resolvedPendingMedia = useMemo(
    () => {
      const requestedMedia =
        normalizeLayoutMedia(
          pendingMedia,
        );

      if (requestedMedia) {
        return requestedMedia;
      }

      const lastImage =
        sortedImages[
          sortedImages.length - 1
        ];

      const lastImageMedia =
        normalizeLayoutMedia(
          lastImage?.media,
        );

      if (lastImageMedia) {
        return lastImageMedia;
      }

      return {
        width: 1,
        height: 1,
      };
    },
    [
      pendingMedia,
      sortedImages,
    ],
  );

  const renderItems =
    useMemo<ImageBatchRenderItem[]>(
      () => [
        ...sortedImages.map(
          (image) => ({
            type: 'image' as const,
            key:
              `${image.objectId}:${image.role}`,
            image,
            media: image.media,
          }),
        ),
        ...(generating
          ? [
              {
                type:
                  'placeholder' as const,
                key:
                  'image-generation-placeholder' as const,
                media:
                  resolvedPendingMedia,
              },
            ]
          : []),
      ],
      [
        generating,
        resolvedPendingMedia,
        sortedImages,
      ],
    );

  const pageCount =
    getImageBatchPageCount(
      renderItems.length,
    );

  const [pageIndex, setPageIndex] =
    useState(0);

  useEffect(() => {
    setPageIndex((current) => {
      if (generating) {
        return Math.max(
          0,
          pageCount - 1,
        );
      }

      return Math.min(
        current,
        Math.max(
          0,
          pageCount - 1,
        ),
      );
    });
  }, [
    generating,
    pageCount,
    renderItems.length,
  ]);

  const pageItems = useMemo(
    () => getImageBatchPage(
      renderItems,
      pageIndex,
    ),
    [
      pageIndex,
      renderItems,
    ],
  );

  const pageLayout = useMemo(
    () => calculateImageBatchPageLayout(
      pageItems,
      GALLERY_MAX_SIZE
        - GALLERY_PADDING * 2,
      GALLERY_MAX_SIZE
        - GALLERY_PADDING * 2,
      GALLERY_GAP,
    ),
    [pageItems],
  );

  if (!pageItems.length) {
    return null;
  }

  const outerWidth =
    pageLayout.width
    + GALLERY_PADDING * 2;

  const outerHeight =
    pageLayout.height
    + GALLERY_PADDING * 2;

  const previous = () => {
    setPageIndex((current) => Math.max(
      0,
      current - 1,
    ));
  };

  const next = () => {
    setPageIndex((current) => Math.min(
      pageCount - 1,
      current + 1,
    ));
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLElement>,
  ) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    }
  };

  return (
    <section
      data-image-generation-batch={batchId}
      className="max-w-full"
      style={{
        width: `${outerWidth}px`,
      }}
      tabIndex={
        pageCount > 1
          ? 0
          : -1
      }
      onKeyDown={onKeyDown}
    >
      <div
        className={[
          'relative w-full overflow-hidden rounded-[12px]',
          'bg-surface-chat ',
        ].join(' ')}
        style={{
          aspectRatio:
            `${outerWidth} / ${outerHeight}`,
        }}
      >
        {pageLayout.tiles.map(
          (tile) => {
            const item =
              pageItems[
                tile.imageIndex
              ];

            if (!item) {
              return null;
            }

            return (
              <div
                key={item.key}
                className={[
                  'absolute overflow-hidden rounded-[10px]',
                  'bg-[#FFFFFF] dark:bg-[#262626]',
                ].join(' ')}
                style={{
                  left: toPercent(
                    GALLERY_PADDING
                      + tile.x,
                    outerWidth,
                  ),
                  top: toPercent(
                    GALLERY_PADDING
                      + tile.y,
                    outerHeight,
                  ),
                  width: toPercent(
                    tile.width,
                    outerWidth,
                  ),
                  height: toPercent(
                    tile.height,
                    outerHeight,
                  ),
                }}
              >
                {item.type === 'image' ? (
                  <ObjectCardOut
                    object={item.image}

                    layout="gallery"
                    fit="contain"
                  />
                ) : (
                  <ImageGenerationPlaceholder />
                )}
              </div>
            );
          },
        )}

        {pageCount > 1 ? (
          <div
            className={[
              'absolute bottom-[14px] right-[14px] z-10',
              'flex h-[28px] items-center gap-[6px]',
              'rounded-[9px] bg-[#000000]/45 px-[4px]',
              'backdrop-blur-[6px]',
            ].join(' ')}
          >
            <button
              type="button"
              aria-label={localize('common.pagination.previous')}
              disabled={
                pageIndex === 0
              }
              onClick={previous}
              className={[
                'inline-flex h-[22px] w-[22px]',
                'items-center justify-center',
                'rounded-[7px] border-0',
                'bg-transparent p-0 text-[#ffffff]',
                'transition-opacity',
                pageIndex === 0
                  ? 'cursor-default opacity-30'
                  : 'cursor-pointer opacity-75 hover:opacity-100',
              ].join(' ')}
            >
              <ChevronLeft
                size={13}
                strokeWidth={1.8}
              />
            </button>

            <span
              className={[
                'min-w-[38px] text-center',
                'text-[10px] text-[#ffffff]/75',
              ].join(' ')}
            >
              {pageIndex + 1}
              {' / '}
              {pageCount}
            </span>

            <button
              type="button"
              aria-label={localize('common.pagination.next')}
              disabled={
                pageIndex
                >= pageCount - 1
              }
              onClick={next}
              className={[
                'inline-flex h-[22px] w-[22px]',
                'items-center justify-center',
                'rounded-[7px] border-0',
                'bg-transparent p-0 text-[#ffffff]',
                'transition-opacity',
                pageIndex
                  >= pageCount - 1
                  ? 'cursor-default opacity-30'
                  : 'cursor-pointer opacity-75 hover:opacity-100',
              ].join(' ')}
            >
              <ChevronRight
                size={13}
                strokeWidth={1.8}
              />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function normalizeLayoutMedia(
  value: unknown,
): {
  width: number;
  height: number;
} | null {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
  ) {
    return null;
  }

  const media =
    value as Record<
      string,
      unknown
    >;

  const width =
    positiveNumber(media.width);

  const height =
    positiveNumber(media.height);

  if (!width || !height) {
    return null;
  }

  return {
    width,
    height,
  };
}

function positiveNumber(
  value: unknown,
): number | null {
  const number = Number(value);

  return Number.isFinite(number)
    && number > 0
      ? number
      : null;
}

function toPercent(
  value: number,
  total: number,
): string {
  if (
    !Number.isFinite(value)
    || !Number.isFinite(total)
    || total <= 0
  ) {
    return '0%';
  }

  return `${(
    value / total
  ) * 100}%`;
}