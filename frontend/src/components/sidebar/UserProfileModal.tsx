                                                       

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { useAuth } from '../../hooks/auth/useAuth';
import { useAuthenticatedImageUrl } from '../../hooks/useAuthenticatedImageUrl';
import { useLocalize } from '../../localization/useLocalize';
import { localizeApiError } from '../../localization/localizeApiError';
import { getAvatarInitial } from '../../utils/avatar-initial';
import { resolveAssetUrl } from '../../utils/asset-url';

interface UserProfileModalProps {
  open: boolean;
  onClose: () => void;
}

function useObjectUrl(
  file: File | null,
): string {
  const url = useMemo(() => {
    if (!file) {
      return '';
    }

    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [url]);

  return url;
}

const UserProfileModal: React.FC<
  UserProfileModalProps
> = ({
  open,
  onClose,
}) => {
  const localize = useLocalize();

  const {
    profile,
    updateProfile,
  } = useAuth();

  const [username, setUsername] =
    useState('');

  const [avatarFile, setAvatarFile] =
    useState<File | null>(null);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState('');

  const fileInputRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  const existingAvatarUrl =
    useAuthenticatedImageUrl(
      resolveAssetUrl(
        profile?.avatarUrl,
        {
          version:
            profile?.avatarUpdatedAt,
        },
      ),
    );

  const selectedAvatarUrl =
    useObjectUrl(avatarFile);

  const avatarUrl =
    selectedAvatarUrl ||
    existingAvatarUrl;

  const avatarInitial =
    getAvatarInitial(
      profile?.username,
      'S',
    );

  useEffect(() => {
    if (!open) {
      return;
    }

    setUsername(
      profile?.username ?? '',
    );

    setAvatarFile(null);
    setError('');
  }, [
    open,
    profile?.username,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === 'Escape' &&
        !saving
      ) {
        onClose();
      }
    };

    document.addEventListener(
      'keydown',
      handleKeyDown,
    );

    return () => {
      document.removeEventListener(
        'keydown',
        handleKeyDown,
      );
    };
  }, [
    open,
    saving,
    onClose,
  ]);

  if (!open) {
    return null;
  }

  const save = async () => {
    const normalizedUsername =
      username.trim();

    if (
      !normalizedUsername ||
      saving
    ) {
      return;
    }

    if (
      normalizedUsername ===
        profile?.username &&
      !avatarFile
    ) {
      onClose();
      return;
    }

    setSaving(true);
    setError('');

    try {
      await updateProfile({
        username:
          normalizedUsername,
        avatarFile,
      });

      onClose();
    } catch (reason) {
      setError(
        localizeApiError(
          reason,
          'sidebar.user.saveFailed',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      data-desktop-no-drag
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-[#000000]/35 backdrop-blur-[2px]"
      onMouseDown={() => {
        if (!saving) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={localize(
          'sidebar.user.profileTitle',
        )}
        className="w-[360px] select-none rounded-[18px] bg-surface-raised p-[20px] text-theme-primary shadow-[0_22px_70px_rgba(0,0,0,0.22)]"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="flex w-full justify-center">
          <div className="relative h-[96px] w-[96px]">
            <button
              type="button"
              className="flex h-[96px] w-[96px] items-center justify-center overflow-hidden rounded-[14px] bg-[#0c5cfb] p-0 text-[34px] font-normal text-[#ffffff]"
              onClick={() => {
                fileInputRef.current?.click();
              }}
              title={localize(
                'sidebar.user.changeAvatar',
              )}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={localize(
                    'sidebar.user.avatarAlt',
                  )}
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                avatarInitial
              )}
            </button>

            <button
              type="button"
              className="absolute bottom-[25px] right-[-75px] z-10 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#ffffff] p-0 text-[#555555] shadow-sm"
              onClick={() => {
                fileInputRef.current?.click();
              }}
              title={localize(
                'sidebar.user.changeAvatar',
              )}
            >
              <img
                src={resolveAssetUrl('/icons/camera.svg')}
                alt=""
                className="h-[16px] w-[16px]"
                draggable={false}
              />
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                setAvatarFile(
                  event.currentTarget
                    .files?.[0] ?? null,
                );

                event.currentTarget.value =
                  '';
              }}
            />
          </div>
        </div>

        <div className="mt-[28px]">
          <label className="block text-[10px] font-normal text-theme-muted">
            {localize(
              'sidebar.user.username',
            )}

            <input
              value={username}
              onChange={(event) => {
                setUsername(
                  event.target.value,
                );
              }}
              maxLength={255}
              className="mt-[6px] h-[40px] w-full select-text rounded-[11px] border border-edge-soft bg-surface-soft px-[12px] text-[12px] font-normal text-theme-primary outline-none focus:border-[#0c5cfb]/55"
              placeholder={localize(
                'sidebar.user.usernamePlaceholder',
              )}
            />
          </label>
        </div>

        {error ? (
          <div className="mt-[10px] text-[10px] font-normal text-red-500">
            {error}
          </div>
        ) : null}

        <div className="mt-[28px] flex justify-end gap-[10px]">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="flex h-[36px] min-w-[72px] items-center justify-center rounded-[10px] bg-surface-card px-[16px] py-0 text-[11px] font-normal text-theme-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {localize(
              'common.actions.cancel',
            )}
          </button>

          <button
            type="button"
            disabled={
              saving ||
              !username.trim()
            }
            onClick={() => {
              void save();
            }}
            className="flex h-[36px] min-w-[72px] items-center justify-center rounded-[10px] bg-action-primary px-[16px] py-0 text-[11px] font-normal text-[#ffffff] transition hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {localize(
              'common.actions.save',
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default UserProfileModal;