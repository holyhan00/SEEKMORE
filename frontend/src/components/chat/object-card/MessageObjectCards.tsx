                                                                  

import type {
  ChatObjectCard,
} from '../../../utils/types';
import ImageBatchGallery from './ImageBatchGallery';
import ObjectCardIn from './ObjectCardIn';
import ObjectCardOut from './ObjectCardOut';
import {
  isImageObject,
} from './object-card.utils';

export interface MessageObjectCardsProps {
  objects: ChatObjectCard[];

  displayRole: 'user' | 'assistant';
  className?: string;
  imageGenerating?: boolean;
  pendingImageMedia?: ChatObjectCard['media'];
}

type AssistantRenderItem =
  | {
      type: 'object';
      key: string;
      object: ChatObjectCard;
    }
  | {
      type: 'image-batch';
      key: string;
      batchId: string;
      images: ChatObjectCard[];
    };

const ASSISTANT_IMAGE_BATCH_ID =
  'assistant-image-gallery';

export default function MessageObjectCards({
  objects,
    displayRole,
  className = '',
  imageGenerating = false,
  pendingImageMedia,
}: MessageObjectCardsProps) {
  if (
    !objects.length
    && !(
      displayRole === 'assistant'
      && imageGenerating
    )
  ) {
    return null;
  }

  if (displayRole === 'user') {
    return (
      <div
        className={[
          'flex w-full max-w-[560px] flex-col items-end gap-[10px]',
          className,
        ].join(' ').trim()}
      >
        {objects.map((object) => (
          <ObjectCardIn
            key={`${object.objectId}:${object.role}`}
            mode="message"
            object={object}
            relatedObjects={objects}

          />
        ))}
      </div>
    );
  }

  const renderItems =
    buildAssistantRenderItems(
      objects,
      imageGenerating,
    );

  return (
    <div
      className={[
        'flex w-full max-w-[560px] flex-col items-start gap-3',
        className,
      ].join(' ').trim()}
    >
      {renderItems.map((item) => (
        item.type === 'image-batch' ? (
          <ImageBatchGallery
            key={item.key}
            batchId={item.batchId}
            images={item.images}

            generating={
              imageGenerating
            }
            pendingMedia={
              pendingImageMedia
            }
          />
        ) : (
          <ObjectCardOut
            key={item.key}
            object={item.object}
            relatedObjects={objects}

          />
        )
      ))}
    </div>
  );
}

function buildAssistantRenderItems(
  objects: ChatObjectCard[],
  imageGenerating: boolean,
): AssistantRenderItem[] {
  const generatedImages =
    collectGeneratedImages(objects);

  const output:
    AssistantRenderItem[] = [];

  let imageBatchRendered = false;

  for (const object of objects) {
    if (isGeneratedImage(object)) {
      if (imageBatchRendered) {
        continue;
      }

      imageBatchRendered = true;

      output.push({
        type: 'image-batch',
        key: ASSISTANT_IMAGE_BATCH_ID,
        batchId:
          ASSISTANT_IMAGE_BATCH_ID,
        images: generatedImages,
      });

      continue;
    }

    output.push({
      type: 'object',
      key:
        `${object.objectId}:${object.role}`,
      object,
    });
  }

  if (
    imageGenerating
    && !imageBatchRendered
  ) {
    output.push({
      type: 'image-batch',
      key:
        ASSISTANT_IMAGE_BATCH_ID,
      batchId:
        ASSISTANT_IMAGE_BATCH_ID,
      images: generatedImages,
    });
  }

  return output;
}

function collectGeneratedImages(
  objects: ChatObjectCard[],
): ChatObjectCard[] {
  const uniqueImages =
    new Map<
      string,
      ChatObjectCard
    >();

  for (const object of objects) {
    if (!isGeneratedImage(object)) {
      continue;
    }

    const key =
      `${object.objectId}:${object.role}`;

    if (!uniqueImages.has(key)) {
      uniqueImages.set(
        key,
        object,
      );
    }
  }

  return Array.from(
    uniqueImages.values(),
  );
}

function isGeneratedImage(
  object: ChatObjectCard,
): boolean {
  if (
    object.role
      !== 'assistant_output'
    || !isImageObject(
      object.objectKind,
      object.mimeType,
    )
  ) {
    return false;
  }

  const sourceTool = String(
    object.sourceTool ?? '',
  )
    .trim()
    .toLowerCase();

  const generationBatchId = String(
    object.generationBatchId ?? '',
  ).trim();

  return sourceTool
      === 'image.generate'
    || Boolean(
      generationBatchId,
    );
}