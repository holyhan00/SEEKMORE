import { resolveAssetUrl } from '../../../utils/asset-url';
import { useAppearance } from '../../../theme/useAppearance';
                                                

import React from 'react';
import { useLocalize } from '../../../localization/useLocalize';
import { useSystemResourcePresentation } from '../../../localization/useSystemResourcePresentation';
import { getAvatarInitial } from '../../../utils/avatar-initial';

import {
  useAuthenticatedImageUrl,
} from '../../../hooks/useAuthenticatedImageUrl';

interface AgentCardProps {
  name: string;
  description?: string | null;
  type: 'COGNITIVE';
  agentKey?: string | null;
  isSuper?: boolean;
  avatarUrl?: string | null;
  coverUrl?: string | null;

  onClick?: () => void;
  onGoChat?: () => void;
  actionLabel?: string;
  actionBusy?: boolean;
  actionDisabled?: boolean;
}

const AgentCard: React.FC<AgentCardProps> = ({
  name,
  description,
  type,
  agentKey,
  isSuper,
  avatarUrl,
  coverUrl,
    onClick,
  onGoChat,
  actionLabel,
  actionBusy = false,
  actionDisabled = false,
}) => {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const systemPresentation = useSystemResourcePresentation();
  const displayedDescription = systemPresentation.systemAgentDescription({
    key: agentKey,
    isSuper,
    fallback: description,
  });
  const resolvedActionLabel = actionLabel || localize('agents.goChat');
  const resolvedAvatarUrl =
    useAuthenticatedImageUrl(avatarUrl);

  const resolvedCoverUrl =
    useAuthenticatedImageUrl(coverUrl);

  const backgroundUrl = isDarkTheme
    ? resolveAssetUrl('/backgrounds/agent-card-dark.jpg')
    : resolveAssetUrl('/backgrounds/agent-card-light.jpg');

  const textColor = 'text-[#1f2937] dark:text-[#ffffff]';

  const coverFallback = 'bg-[#ffffff] dark:bg-[#1b1f35]';

  const avatarFallback = 'bg-accent-surface text-accent-foreground  ';

  const clickable = Boolean(onClick);

  return (
    <div
      onClick={onClick}
      className={`
        relative
        h-[240px]
        w-[180px]
        overflow-hidden
        select-none
        rounded-[15px]
        border
        border-transparent
        transition-all
        duration-200
        ${
          clickable
            ? 'cursor-pointer hover:-translate-y-[2px] hover:shadow-[0_18px_40px_rgba(12,92,251,0.18)] active:translate-y-0'
            : 'cursor-default'
        }
        ${textColor}
      `}
    >
      <img
        src={backgroundUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />

      <div
        className={`absolute inset-0 ${
          'bg-surface-overlay-soft '
        }`}
      />

      <div className="relative z-[1] mb-[6px] mt-[10px] flex w-full justify-center p-2">
        <div
          className={`relative h-[90px] w-[160px] overflow-hidden rounded-[12px] shadow-sm ${coverFallback}`}
        >
          {resolvedCoverUrl ? (
            <>
              <img
                src={resolvedCoverUrl}
                alt={localize('agents.coverAlt', { name })}
                className="h-full w-full object-cover"
                draggable={false}
              />

              <div
                className={`absolute inset-0 ${
                  'bg-surface-overlay-soft '
                }`}
              />
            </>
          ) : (
            <div className="flex h-full w-full select-none items-center justify-center text-[12px] opacity-45">
              {localize('common.cover')}
            </div>
          )}
        </div>

        <div
          className={`absolute bottom-[-10px] left-[18px] h-[34px] w-[34px] overflow-hidden rounded-[6px] shadow-md ${avatarFallback}`}
        >
          {resolvedAvatarUrl ? (
            <img
              src={resolvedAvatarUrl}
              alt={localize('agents.avatarAlt', { name })}
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full select-none items-center justify-center text-[16px] font-semibold">
              {getAvatarInitial(name, 'A')}
            </div>
          )}
        </div>
      </div>

      <div className="relative z-[1] mx-auto w-[150px] pt-[5px]">
        <div className="mb-[2px] flex items-center justify-between gap-2">
          <h3
            className="min-w-0 flex-1 truncate text-[14px] font-bold leading-[24px]"
            title={name}
          >
            {name}
          </h3>

          <span className="shrink-0 rounded-full bg-blue-600 px-[6px] py-[2px] text-[8px] text-[#ffffff] bg-[#0c5cfb]/50">
            {type === 'COGNITIVE' ? localize('agents.type.cognitive') : type}
          </span>
        </div>

        <p
          className="w-full truncate text-[10px] leading-[20px] opacity-50"
          title={displayedDescription || ''}
        >
          {displayedDescription || localize('common.noDescription')}
        </p>

        <button
          type="button"
          disabled={
            actionDisabled ||
            actionBusy
          }
          onClick={(event) => {
            event.stopPropagation();
            onGoChat?.();
          }}
          onCopy={(event) => {
            event.preventDefault();
          }}
          className="relative z-[5] mt-[30px] flex h-[28px] w-full select-none items-center justify-center rounded-full bg-action-primary text-[12px] font-medium text-[#ffffff] shadow-sm transition-all duration-150 hover:-translate-y-[1px] hover:bg-[#084bd8] hover:text-[#ffffff] hover:shadow-[0_6px_16px_rgba(12,92,251,0.25)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
        >
          {actionBusy
            ? localize('agents.processing')
            : resolvedActionLabel}
        </button>
      </div>
    </div>
  );
};

export default AgentCard;