                                                                 

import type {
  ChatObjectCard,
} from '../../../utils/types';

export const IMAGE_BATCH_PAGE_SIZE = 4;

export type ImageBatchLayout =
  | 'single'
  | 'double'
  | 'triple'
  | 'quad';

export interface ImageBatchLayoutSource {
  media?: {
    width?: number;
    height?: number;
  };
}

export interface ImageBatchTileLayout {
  imageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageBatchPageLayout {
  width: number;
  height: number;
  tiles: ImageBatchTileLayout[];
}

export function getImageBatchPageCount(
  imageCount: number,
): number {
  return Math.max(
    1,
    Math.ceil(
      Math.max(0, imageCount)
      / IMAGE_BATCH_PAGE_SIZE,
    ),
  );
}

export function getImageBatchPage<T>(
  items: T[],
  pageIndex: number,
): T[] {
  const safePageIndex = Math.max(
    0,
    Math.min(
      getImageBatchPageCount(
        items.length,
      ) - 1,
      Math.floor(pageIndex),
    ),
  );

  const start =
    safePageIndex
    * IMAGE_BATCH_PAGE_SIZE;

  return items.slice(
    start,
    start + IMAGE_BATCH_PAGE_SIZE,
  );
}

export function getImageBatchLayout(
  imageCount: number,
): ImageBatchLayout {
  if (imageCount <= 1) {
    return 'single';
  }

  if (imageCount === 2) {
    return 'double';
  }

  if (imageCount === 3) {
    return 'triple';
  }

  return 'quad';
}

export function calculateImageBatchPageLayout(
  images: ImageBatchLayoutSource[],
  maxWidth: number,
  maxHeight: number,
  gap: number,
): ImageBatchPageLayout {
  const safeImages = images.slice(
    0,
    IMAGE_BATCH_PAGE_SIZE,
  );

  const safeMaxWidth =
    positiveNumber(maxWidth) ?? 1;

  const safeMaxHeight =
    positiveNumber(maxHeight) ?? 1;

  const safeGap = Math.max(
    0,
    positiveNumber(gap) ?? 0,
  );

  if (!safeImages.length) {
    return {
      width: 1,
      height: 1,
      tiles: [],
    };
  }

  if (safeImages.length === 1) {
    return calculateSingleLayout(
      safeImages,
      safeMaxWidth,
      safeMaxHeight,
    );
  }

  if (safeImages.length === 2) {
    return calculateDoubleLayout(
      safeImages,
      safeMaxWidth,
      safeMaxHeight,
      safeGap,
    );
  }

  if (safeImages.length === 3) {
    return calculateTripleLayout(
      safeImages,
      safeMaxWidth,
      safeMaxHeight,
      safeGap,
    );
  }

  return calculateQuadLayout(
    safeImages,
    safeMaxWidth,
    safeMaxHeight,
    safeGap,
  );
}

export function sortImageBatch(
  images: ChatObjectCard[],
): ChatObjectCard[] {
  return [...images].sort(
    (left, right) => {
      const leftIndex =
        nonNegativeInteger(
          left.generationIndex,
        );

      const rightIndex =
        nonNegativeInteger(
          right.generationIndex,
        );

      if (
        leftIndex !== null
        || rightIndex !== null
      ) {
        return (
          (leftIndex
            ?? Number.MAX_SAFE_INTEGER)
          - (rightIndex
            ?? Number.MAX_SAFE_INTEGER)
          || left.position
            - right.position
          || left.objectId.localeCompare(
            right.objectId,
          )
        );
      }

      return (
        left.position - right.position
        || Date.parse(left.createdAt)
          - Date.parse(right.createdAt)
        || left.objectId.localeCompare(
          right.objectId,
        )
      );
    },
  );
}

function calculateSingleLayout(
  images: ImageBatchLayoutSource[],
  maxWidth: number,
  maxHeight: number,
): ImageBatchPageLayout {
  const ratio = resolveImageRatio(
    images[0],
  );

  const size = fitRatioWithinBounds(
    ratio,
    maxWidth,
    maxHeight,
  );

  return {
    width: size.width,
    height: size.height,
    tiles: [
      {
        imageIndex: 0,
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
      },
    ],
  };
}

function calculateDoubleLayout(
  images: ImageBatchLayoutSource[],
  maxWidth: number,
  maxHeight: number,
  gap: number,
): ImageBatchPageLayout {
  const firstRatio =
    resolveImageRatio(images[0]);

  const secondRatio =
    resolveImageRatio(images[1]);

  const ratioTotal =
    firstRatio + secondRatio;

  const availableWidth = Math.max(
    1,
    maxWidth - gap,
  );

  const height = Math.max(
    1,
    Math.min(
      maxHeight,
      availableWidth / ratioTotal,
    ),
  );

  const firstWidth =
    firstRatio * height;

  const secondWidth =
    secondRatio * height;

  return roundLayout({
    width:
      firstWidth
      + gap
      + secondWidth,
    height,
    tiles: [
      {
        imageIndex: 0,
        x: 0,
        y: 0,
        width: firstWidth,
        height,
      },
      {
        imageIndex: 1,
        x: firstWidth + gap,
        y: 0,
        width: secondWidth,
        height,
      },
    ],
  });
}

function calculateTripleLayout(
  images: ImageBatchLayoutSource[],
  maxWidth: number,
  maxHeight: number,
  gap: number,
): ImageBatchPageLayout {
  const leftRatio =
    resolveImageRatio(images[0]);

  const topRatio =
    resolveImageRatio(images[1]);

  const bottomRatio =
    resolveImageRatio(images[2]);

  const rightHeightFactor =
    (1 / topRatio)
    + (1 / bottomRatio);

  const rightWidthFactor =
    1 / rightHeightFactor;

  const widthDenominator =
    leftRatio + rightWidthFactor;

  const widthOffset =
    gap * (1 - rightWidthFactor);

  const heightByWidth = Math.max(
    gap + 1,
    (
      maxWidth - widthOffset
    ) / widthDenominator,
  );

  const layoutHeight = Math.max(
    gap + 1,
    Math.min(
      maxHeight,
      heightByWidth,
    ),
  );

  const rightWidth = Math.max(
    1,
    rightWidthFactor
    * (layoutHeight - gap),
  );

  const leftWidth =
    leftRatio * layoutHeight;

  const topHeight =
    rightWidth / topRatio;

  const bottomHeight =
    rightWidth / bottomRatio;

  return roundLayout({
    width:
      leftWidth
      + gap
      + rightWidth,
    height: layoutHeight,
    tiles: [
      {
        imageIndex: 0,
        x: 0,
        y: 0,
        width: leftWidth,
        height: layoutHeight,
      },
      {
        imageIndex: 1,
        x: leftWidth + gap,
        y: 0,
        width: rightWidth,
        height: topHeight,
      },
      {
        imageIndex: 2,
        x: leftWidth + gap,
        y: topHeight + gap,
        width: rightWidth,
        height: bottomHeight,
      },
    ],
  });
}

function calculateQuadLayout(
  images: ImageBatchLayoutSource[],
  maxWidth: number,
  maxHeight: number,
  gap: number,
): ImageBatchPageLayout {
  const firstRatio =
    resolveImageRatio(images[0]);

  const secondRatio =
    resolveImageRatio(images[1]);

  const thirdRatio =
    resolveImageRatio(images[2]);

  const fourthRatio =
    resolveImageRatio(images[3]);

  const topRatioTotal =
    firstRatio + secondRatio;

  const bottomRatioTotal =
    thirdRatio + fourthRatio;

  const heightFactor =
    (1 / topRatioTotal)
    + (1 / bottomRatioTotal);

  const widthByHeight =
    gap
    + (
      Math.max(
        1,
        maxHeight - gap,
      ) / heightFactor
    );

  const layoutWidth = Math.max(
    gap + 1,
    Math.min(
      maxWidth,
      widthByHeight,
    ),
  );

  const rowWidth = Math.max(
    1,
    layoutWidth - gap,
  );

  const topHeight =
    rowWidth / topRatioTotal;

  const bottomHeight =
    rowWidth / bottomRatioTotal;

  const firstWidth =
    firstRatio * topHeight;

  const secondWidth =
    secondRatio * topHeight;

  const thirdWidth =
    thirdRatio * bottomHeight;

  const fourthWidth =
    fourthRatio * bottomHeight;

  return roundLayout({
    width: layoutWidth,
    height:
      topHeight
      + gap
      + bottomHeight,
    tiles: [
      {
        imageIndex: 0,
        x: 0,
        y: 0,
        width: firstWidth,
        height: topHeight,
      },
      {
        imageIndex: 1,
        x: firstWidth + gap,
        y: 0,
        width: secondWidth,
        height: topHeight,
      },
      {
        imageIndex: 2,
        x: 0,
        y: topHeight + gap,
        width: thirdWidth,
        height: bottomHeight,
      },
      {
        imageIndex: 3,
        x: thirdWidth + gap,
        y: topHeight + gap,
        width: fourthWidth,
        height: bottomHeight,
      },
    ],
  });
}

function fitRatioWithinBounds(
  ratio: number,
  maxWidth: number,
  maxHeight: number,
): {
  width: number;
  height: number;
} {
  const boundsRatio =
    maxWidth / maxHeight;

  if (ratio >= boundsRatio) {
    return {
      width: maxWidth,
      height: maxWidth / ratio,
    };
  }

  return {
    width: maxHeight * ratio,
    height: maxHeight,
  };
}

function resolveImageRatio(
  image?: ImageBatchLayoutSource,
): number {
  const width = positiveNumber(
    image?.media?.width,
  );

  const height = positiveNumber(
    image?.media?.height,
  );

  if (!width || !height) {
    return 1;
  }

  return width / height;
}

function roundLayout(
  layout: ImageBatchPageLayout,
): ImageBatchPageLayout {
  return {
    width: round(layout.width),
    height: round(layout.height),
    tiles: layout.tiles.map(
      (tile) => ({
        ...tile,
        x: round(tile.x),
        y: round(tile.y),
        width: round(tile.width),
        height: round(tile.height),
      }),
    ),
  };
}

function round(value: number): number {
  return Math.round(
    value * 1000,
  ) / 1000;
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

function nonNegativeInteger(
  value: unknown,
): number | null {
  const number = Number(value);

  return Number.isInteger(number)
    && number >= 0
      ? number
      : null;
}