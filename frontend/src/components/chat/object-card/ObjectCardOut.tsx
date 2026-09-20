// frontend/src/components/chat/object-card/ObjectCardOut.tsx
import { useLocalize } from '../../../localization/useLocalize';
import type {
  ChatObjectCard,
} from '../../../utils/types';
import { useObjectPreview } from '../object-preview/ObjectPreviewProvider';
import ObjectCard from './ObjectCard';
import {
  isAudioObject,
  isImageObject,
} from './object-card.utils';
import AudioObjectPreview from './previews/AudioObjectPreview';
import ImageObjectPreview from './previews/ImageObjectPreview';

export default function ObjectCardOut({
  object,
  relatedObjects,
    layout = 'natural',
  fit,
}: {
  object: ChatObjectCard;
  relatedObjects?: ChatObjectCard[];
  layout?: 'natural' | 'gallery';
  fit?: 'contain' | 'cover';
}) {
  const localize = useLocalize();
  const { openObject } = useObjectPreview();
  const openPreview = () =>
    openObject(
      object,
      relatedObjects,
    );

  if (
    isImageObject(
      object.objectKind,
      object.mimeType,
    )
  ) {
    return (
      <ImageObjectPreview
        title={object.displayName}
        originalName={
          object.originalName
        }
        source={
          object.previewUrl
          || object.downloadUrl
        }
        media={object.media}
        cacheKey={[
          object.objectId,
          object.contentHash
            || object.versionNo
            || object.previewUrl
            || object.downloadUrl,
        ].join(':')}

        displayRole="assistant"
        layout={layout}
        fit={
          layout === 'gallery'
            ? 'contain'
            : fit ?? 'contain'
        }
        authenticated
        onOpen={openPreview}
      />
    );
  }

  if (
    isAudioObject(
      object.objectKind,
      object.mimeType,
    )
  ) {
    return (
      <ObjectCard
        title={object.displayName}
        filename={
          object.originalName
          ?? object.displayName
        }
        size={object.sizeBytes}
        statusText={localize('object.preview.open')}
        onClick={openPreview}
        fileType="audio"

        layout="wide"
      >
        <AudioObjectPreview
          object={object}
        />
      </ObjectCard>
    );
  }

  return (
    <ObjectCard
      title={object.displayName}
      filename={
        object.originalName
        ?? object.displayName
      }
      size={object.sizeBytes}
      statusText={localize('object.preview.open')}
      onClick={openPreview}
      fileType={
        object.extension
        ?? object.objectKind
      }

    />
  );
}
