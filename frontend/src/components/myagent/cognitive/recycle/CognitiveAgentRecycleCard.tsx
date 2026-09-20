import { useAppearance } from '../../../../theme/useAppearance';
                                                                                  
import { resolveAssetUrl } from '../../../../utils/asset-url';
import {
  useAuthenticatedImageUrl,
} from '../../../../hooks/useAuthenticatedImageUrl';
import type { CognitiveAgent } from '../api/cognitive-agent.types';
import { useFormatter } from '../../../../localization/useFormatter';
import { useLocalize } from '../../../../localization/useLocalize';

interface CognitiveAgentRecycleCardProps {
  agent: CognitiveAgent;

  restoring?: boolean;
  purging?: boolean;
  onRestore: () => void;
  onPurge: () => void;
}

export default function CognitiveAgentRecycleCard({
  agent,
    restoring = false,
  purging = false,
  onRestore,
  onPurge,
}: CognitiveAgentRecycleCardProps) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const formatter = useFormatter();

  const formatDate = (value?: string | null): string => {
    if (!value) return localize('common.notAvailable');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return localize('common.notAvailable');
    return formatter.formatDate(date, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const retentionLabel = (value?: string | null): string => {
    if (!value) return localize('recycle.waitingCleanup');
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return localize('recycle.waitingCleanup');
    const remaining = Math.max(
      0,
      Math.ceil((timestamp - Date.now()) / 86_400_000),
    );
    return remaining > 0
      ? localize('recycle.remainingDays', { count: remaining })
      : localize('recycle.purgeSoon');
  };

  const avatarSourceUrl = resolveAssetUrl(
    agent.avatarUrl
    ?? agent.avatarKey,
    {
      version:
        agent.avatarUpdatedAt,
    },
  );
  const coverSourceUrl = resolveAssetUrl(
    agent.coverUrl
    ?? agent.coverKey,
    {
      version:
        agent.coverUpdatedAt,
    },
  );

  const avatarUrl =
    useAuthenticatedImageUrl(avatarSourceUrl);
  const coverUrl =
    useAuthenticatedImageUrl(coverSourceUrl);

  const busy = restoring || purging;
  const backgroundUrl = isDarkTheme
    ? resolveAssetUrl('/backgrounds/agent-card-dark.jpg')
    : resolveAssetUrl('/backgrounds/agent-card-light.jpg');

  return (
    <article
      className={`relative h-[268px] w-[180px] overflow-hidden rounded-[15px] border shadow-sm ${
        'border-edge-alpha-07 bg-surface-raised text-theme-primary-deep   '
      }`}
    >
      <img
        src={backgroundUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
      <div
        className={`absolute inset-0 ${
          'bg-[#ffffff]/10 dark:bg-[#000000]/15'
        }`}
      />

      <div className="relative z-[1] px-[10px] pt-[10px]">
        <div
          className={`relative h-[82px] overflow-hidden rounded-[11px] ${
            'bg-[#f1f2f6] dark:bg-[#1b1f35]'
          }`}
        >
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={localize('agents.recycle.coverAlt', { name: agent.name })}
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : null}

          <div className="absolute inset-0 bg-gradient-to-t from-[#000000]/35 to-transparent" />

          <div
            className={`absolute bottom-[7px] left-[8px] flex h-[34px] w-[34px] items-center justify-center overflow-hidden rounded-[7px] text-[15px] font-semibold shadow-md ${
              'bg-accent-surface text-accent-foreground  '
            }`}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={localize('agents.recycle.avatarAlt', { name: agent.name })}
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              agent.name?.trim()?.[0] || 'A'
            )}
          </div>

          <span className="absolute bottom-[8px] right-[8px] rounded-full bg-red-500/85 px-[7px] py-[3px] text-[9px] text-[#ffffff]">
            {localize('agents.recycle.deleted')}
          </span>
        </div>

        <h3
          className="mt-[8px] truncate text-[13px] font-semibold"
          title={agent.name}
        >
          {agent.name}
        </h3>

        <p
          className={`mt-[3px] overflow-hidden text-[10px] leading-[15px] ${
            'text-[#000000]/48 dark:text-[#ffffff]/48'
          }`}
          style={{
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            maxHeight: '30px',
          }}
          title={agent.description || localize('agents.recycle.noDescription')}
        >
          {agent.description || localize('agents.recycle.noDescription')}
        </p>

        <div
          className={`mt-[8px] space-y-[3px] text-[9px] ${
            'text-[#000000]/42 dark:text-[#ffffff]/40'
          }`}
        >
          <div className="flex items-center justify-between gap-[8px]">
            <span>{localize('agents.recycle.conversationCount', { count: agent.conversationCount ?? 0 })}</span>
            <span>{localize('agents.recycle.messageCount', { count: agent.messageCount ?? 0 })}</span>
          </div>
          <div className="flex items-center justify-between gap-[8px]">
            <span>{retentionLabel(agent.purgeAfter)}</span>
            <span>{formatDate(agent.purgeAfter)}</span>
          </div>
        </div>

        <div className="mt-[10px] grid grid-cols-2 gap-[6px]">
          <button
            type="button"
            disabled={busy}
            onClick={onRestore}
            className="h-[28px] rounded-[8px] bg-action-primary text-[10px] font-medium text-[#ffffff] transition hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {restoring ? localize('agents.recycle.restoring') : localize('agents.recycle.restore')}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={onPurge}
            className="h-[28px] rounded-[8px] border border-red-400/45 text-[10px] font-medium text-red-400 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {purging ? localize('agents.recycle.deleting') : localize('agents.recycle.delete')}
          </button>
        </div>
      </div>
    </article>
  );
}
