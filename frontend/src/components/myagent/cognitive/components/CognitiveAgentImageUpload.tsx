                                                                                     
import { useLocalize } from '../../../../localization/useLocalize';
import { getAvatarInitial } from '../../../../utils/avatar-initial';

import React, {
  useEffect,
  useMemo,
} from 'react';

import {
  useAuthenticatedImageUrl,
} from '../../../../hooks/useAuthenticatedImageUrl';

interface Props {
  avatarFile: File | null;
  coverFile: File | null;
  existingAvatarUrl?: string | null;
  existingCoverUrl?: string | null;
  avatarFallbackText?: string | null;
  onAvatarChange: (
    file: File | null,
  ) => void;
  onCoverChange: (
    file: File | null,
  ) => void;

}

function useObjectUrl(
  file: File | null,
): string {
  const objectUrl = useMemo(() => {
    if (!file) {
      return '';
    }

    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  return objectUrl;
}

function handleImageInputChange(
  event: React.ChangeEvent<HTMLInputElement>,
  onChange: (
    file: File | null,
  ) => void,
  _field: 'avatar' | 'cover',
): void {
  const file =
    event.currentTarget.files?.[0] ??
    null;

              
                               
     
            
                               
                               
                               
      
    

  onChange(file);

  event.currentTarget.value = '';
}

const CognitiveAgentImageUpload: React.FC<
  Props
> = ({
  avatarFile,
  coverFile,
  existingAvatarUrl,
  existingCoverUrl,
  avatarFallbackText,
  onAvatarChange,
  onCoverChange,
  }) => {
  const localize = useLocalize();
  const avatarFileUrl =
    useObjectUrl(avatarFile);
  const coverFileUrl =
    useObjectUrl(coverFile);
  const existingAvatarImageUrl =
    useAuthenticatedImageUrl(existingAvatarUrl);
  const existingCoverImageUrl =
    useAuthenticatedImageUrl(existingCoverUrl);

  const avatarUrl =
    avatarFileUrl || existingAvatarImageUrl;
  const coverUrl =
    coverFileUrl || existingCoverImageUrl;
  const avatarInitial =
    getAvatarInitial(avatarFallbackText);

  const cardClass = [
    'relative',
    'h-[96px]',
    'overflow-hidden',
    'rounded-[14px]',
    'transition-all',
    'bg-[#fafafa] hover:bg-[#ffffff] dark:bg-[#151515] dark:hover:bg-[#181818]',
  ].join(' ');

  const hintClass = 'text-theme-muted-strong ';

  return (
    <div
      className="
        flex
        h-[96px]
        min-w-0
        gap-[10px]
      "
    >
      {            }
      <label
        className={`
          ${cardClass}
          w-[96px]
          shrink-0
          cursor-pointer
        `}
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) =>
            handleImageInputChange(
              event,
              onAvatarChange,
              'avatar',
            )
          }
        />

        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={localize('agents.image.avatarPreview')}
            className="
              h-full
              w-full
              object-cover
            "
            draggable={false}
          />
        ) : avatarInitial ? (
          <div
            className="
              flex
              h-full
              w-full
              items-center
              justify-center
              bg-accent-surface
              text-[28px]
              font-semibold
              leading-none
              text-accent-foreground
            "
          >
            {avatarInitial}
          </div>
        ) : (
          <div
            className="
              flex
              h-full
              w-full
              flex-col
              items-center
              justify-center
              text-center
            "
          >
            <div className="text-[22px] leading-none">
              +
            </div>

            <div
              className={`
                mt-[8px]
                text-[12px]
                ${hintClass}
              `}
            >
              {localize('agents.image.avatar')}
            </div>
          </div>
        )}
      </label>

      {                   }
      <label
        className={`
          ${cardClass}
          min-w-0
          flex-1
          cursor-pointer
        `}
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) =>
            handleImageInputChange(
              event,
              onCoverChange,
              'cover',
            )
          }
        />

        {coverUrl ? (
          <img
            src={coverUrl}
            alt={localize('agents.image.coverPreview')}
            className="
              h-full
              w-full
              object-cover
            "
            draggable={false}
          />
        ) : (
          <div
            className="
              flex
              h-full
              w-full
              flex-col
              items-center
              justify-center
              text-center
            "
          >
            <div className="text-[22px] leading-none">
              +
            </div>

            <div
              className={`
                mt-[8px]
                text-[12px]
                ${hintClass}
              `}
            >
              {localize('agents.image.cover')}
            </div>
          </div>
        )}
      </label>
    </div>
  );
};

export default CognitiveAgentImageUpload;
