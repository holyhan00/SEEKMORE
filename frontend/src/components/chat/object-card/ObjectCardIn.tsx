import { useLocalize } from '../../../localization/useLocalize';
import type {
  ChatObjectCard,
} from '../../../utils/types';
import type {
  ChatPendingFile,
} from '../file-upload.types';
import { useObjectPreview } from '../object-preview/ObjectPreviewProvider';
import ObjectCard from './ObjectCard';
import ObjectRemoveButton from './ObjectRemoveButton';
import {
  isAudioObject,
  isImageObject,
} from './object-card.utils';
import ImageObjectPreview from './previews/ImageObjectPreview';

export type ObjectCardInProps =
  | {
      mode: 'composer';
      file: ChatPendingFile;
      onRemove?: () => void;
    }
  | {
      mode: 'message';
      object: ChatObjectCard;
      relatedObjects?: ChatObjectCard[];
    };

export default function ObjectCardIn(
  props: ObjectCardInProps,
) {
  if (props.mode === 'composer') {
    return (
      <ComposerObjectCard
        file={props.file}
        onRemove={props.onRemove}
      />
    );
  }

  return (
    <MessageObjectCard
      object={props.object}
      relatedObjects={props.relatedObjects}
    />
  );
}

function MessageObjectCard({
  object,
  relatedObjects,
}: {
  object: ChatObjectCard;
  relatedObjects?: ChatObjectCard[];
}) {
  const localize = useLocalize();
  const { openObject } = useObjectPreview();

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

        displayRole="user"
        authenticated
        onOpen={() =>
          openObject(
            object,
            relatedObjects,
          )
        }
      />
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
      onClick={() =>
        openObject(
          object,
          relatedObjects,
        )
      }
      fileType={
        isAudioObject(
          object.objectKind,
          object.mimeType,
        )
          ? 'audio'
          : object.extension
            ?? object.objectKind
      }

    />
  );
}

function ComposerObjectCard({
  file,
    onRemove,
}: {
  file: ChatPendingFile;

  onRemove?: () => void;
}) {
  const localize = useLocalize();

  const processing =
    file.status === 'validating'
    || file.status === 'uploading'
    || file.status === 'processing';

  const failed =
    file.status === 'failed'
    || file.status === 'unsupported';

  const statusText =
    file.status === 'validating'
      ? localize('object.validating')
      : file.status === 'uploading'
        ? localize('object.uploadProgress', { progress: Math.max(0, Math.min(100, Math.round(file.uploadProgress ?? 0))) })
        : file.status === 'processing'
          ? localize('object.preparingPreview')
          : file.status === 'failed'
            ? file.error || localize('object.uploadOrProcessFailed')
            : file.status === 'unsupported'
              ? file.error || localize('object.unsupportedType')
              : localize('object.ready');

  if (
    isImageObject(
      file.objectKind,
      file.mimeType,
    )
  ) {
    return (
      <ImageObjectPreview
        title={file.displayName}
        originalName={file.originalName}
        source={
          file.localUrl
          || file.previewUrl
          || file.downloadUrl
        }
        media={file.media}

        displayRole="user"
        composer
        statusText={
          file.status === 'ready'
            ? undefined
            : statusText
        }
        statusError={failed}
        onRemove={onRemove}
        removeDisabled={processing}
      />
    );
  }

  const audio = isAudioObject(
    file.objectKind,
    file.mimeType,
  );

  return (
    <ObjectCard
      title={file.displayName}
      filename={file.originalName}
      size={file.sizeText}
      statusText={statusText}
      fileType={
        audio
          ? 'audio'
          : file.extension
            || file.objectKind
      }

      interactive={false}
      action={
        onRemove ? (
          <ObjectRemoveButton
            disabled={processing}
            onRemove={onRemove}
          />
        ) : null
      }
    />
  );
}
