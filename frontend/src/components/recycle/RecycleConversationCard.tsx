                                                              
import {
  type RecycledConversation,
  type RecycledConversationMessage,
} from './conversation-recycle.api';
import {
  buildSeekmoreDownloadFilename,
} from '../../utils/download-filename';
import { useFormatter } from '../../localization/useFormatter';
import { useLocalize } from '../../localization/useLocalize';

export interface RecycleConversationCardProps {
  conversation: RecycledConversation;

  expanded: boolean;
  messages: RecycledConversationMessage[];
  loading: boolean;
  onToggle: () => void;
  onRestore: () => void;
  onPermanentlyDelete: () => void;
  isRestoring: boolean;
  isDeleting: boolean;
}

export default function RecycleConversationCard({
  conversation,
    expanded,
  messages,
  loading,
  onToggle,
  onRestore,
  onPermanentlyDelete,
  isRestoring,
  isDeleting,
}: RecycleConversationCardProps) {
  const localize = useLocalize();
  const formatter = useFormatter();

  const formatDateTime = (value?: string | null): string => {
    if (!value) return localize('common.notAvailable');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return localize('common.notAvailable');
    return formatter.formatDateTime(date, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const remainingDays = (value?: string | null): string => {
    if (!value) return localize('recycle.waitingCleanup');
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return localize('recycle.waitingCleanup');
    const days = Math.max(
      0,
      Math.ceil((timestamp - Date.now()) / 86_400_000),
    );
    return days > 0
      ? localize('recycle.remainingDays', { count: days })
      : localize('recycle.purgeSoon');
  };

  const roleLabel = (role: string): string => {
    const key = `common.role.${role.toUpperCase()}`;
    const translated = localize(key);
    return translated === key ? role : translated;
  };

  const muted = 'text-theme-muted ';
  const row = 'bg-surface-subtle ';

  return (
    <div
      className={`select-none rounded-[10px] px-[10px] py-[9px] [&_button]:!select-none [&_button_*]:!select-none ${row}`}
    >
      <div className="flex min-w-0 items-center gap-[10px]">
        <div className="min-w-0 flex-1">
          <div
            className={`truncate text-[11px] font-medium ${
              'text-theme-heading '
            }`}
            title={conversation.title}
          >
            {conversation.title || localize('recycle.unnamedConversation')}
          </div>
          <div
            className={`mt-[4px] flex flex-wrap gap-x-[12px] gap-y-[2px] text-[9px] ${muted}`}
          >
            <span>{localize('recycle.messageCount', { count: conversation.messageCount })}</span>
            <span>
              {localize('recycle.deletedAt', { date: formatDateTime(conversation.deletedAt) })}
            </span>
            <span>{remainingDays(conversation.purgeAfter)}</span>
            <span>
              {localize('recycle.purgeAt', { date: formatDateTime(conversation.purgeAfter) })}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggle}
          className={`h-[28px] shrink-0 rounded-[8px] border px-[10px] text-[9px] transition ${
            'border-edge-alpha-08 !bg-action-secondary text-theme-control hover:!bg-action-secondary-hover'
          }`}
        >
          {expanded ? localize('recycle.collapse') : localize('recycle.view')}
        </button>

        <button
          type="button"
          disabled={isRestoring || isDeleting}
          onClick={onRestore}
          className="h-[28px] shrink-0 rounded-[8px] bg-action-primary px-[11px] text-[9px] font-medium text-[#ffffff] transition hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRestoring ? localize('recycle.restoring') : localize('recycle.restore')}
        </button>

        <button
          type="button"
          disabled={isRestoring || isDeleting}
          onClick={onPermanentlyDelete}
          className={`h-[28px] shrink-0 rounded-[8px] border px-[10px] text-[9px] transition disabled:cursor-not-allowed disabled:opacity-50 ${
            'border-status-danger-border text-status-danger-foreground hover:bg-status-danger-hover'
          }`}
        >
          {isDeleting ? localize('recycle.deleting') : localize('recycle.deletePermanently')}
        </button>
      </div>

      {expanded && (
        <div
          className={`scroll-container mt-[9px] max-h-[320px] space-y-[7px] overflow-y-auto border-t pt-[9px] ${
            'border-edge-alpha-06 '
          }`}
        >
          {loading ? (
            <div
              className={`py-[10px] text-center text-[9px] ${muted}`}
            >
              {localize('recycle.loadingMessages')}
            </div>
          ) : messages.length === 0 ? (
            <div
              className={`py-[10px] text-center text-[9px] ${muted}`}
            >
              {localize('recycle.noMessages')}
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-[8px] px-[9px] py-[7px] ${
                  'bg-surface-message'
                }`}
              >
                <div
                  className={`flex items-center justify-between text-[8px] ${muted}`}
                >
                  <span>{roleLabel(message.role)}</span>
                  <span>{formatDateTime(message.timestamp)}</span>
                </div>
                <div
                  className={`mt-[4px] select-text whitespace-pre-wrap break-words text-[10px] leading-[17px] ${
                    'text-theme-secondary '
                  }`}
                >
                  {message.content || localize('recycle.emptyMessage')}
                </div>

                {message.objects.length > 0 && (
                  <div className="mt-[7px] space-y-[6px]">
                    {message.objects.map((object) => (
                      <div
                        key={`${message.id}:${object.objectId}`}
                        className={`overflow-hidden rounded-[7px] border p-[7px] ${
                          'border-edge-alpha-06 bg-surface-object'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-[8px]">
                          <span
                            className={`min-w-0 truncate text-[9px] ${
                              'text-theme-secondary-65 '
                            }`}
                            title={object.displayName}
                          >
                            {object.displayName}
                          </span>
                          <a
                            href={object.downloadUrl}
                            download={buildSeekmoreDownloadFilename(
                              object.originalName ?? object.displayName,
                            )}
                            className={`shrink-0 text-[8px] hover:underline ${muted}`}
                          >
                            {localize('recycle.download')}
                          </a>
                        </div>

                        {object.objectKind === 'image' && object.previewUrl ? (
                          <img
                            src={object.previewUrl}
                            alt={object.displayName}
                            className="mt-[6px] max-h-[180px] w-auto max-w-full rounded-[6px] object-contain"
                            loading="lazy"
                            draggable={false}
                          />
                        ) : object.objectKind === 'audio' && object.previewUrl ? (
                          <audio
                            className="mt-[6px] h-8 w-full"
                            controls
                            preload="metadata"
                            src={object.previewUrl}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
