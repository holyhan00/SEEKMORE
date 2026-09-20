import { resolveAssetUrl } from '../../../../utils/asset-url';
import { useAppearance } from '../../../../theme/useAppearance';
                                                                   

import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  deleteSkill,
  getDeletedSkill,
  getSkill,
  restoreDeletedSkill,
  setSkillLifecycle,
} from '../api/skill.api';

import ConfirmModal from '../../../../common/modals/ConfirmModal';
import SkillFileManager from '../files/SkillFileManager';
import SkillStatusBadge from '../shared/SkillStatusBadge';
import { getSkillDisplayName } from '../shared/skill-display-name';

import { isAgentGeneratedSkillSource } from '../shared/skill-source';
import { useFormatter } from '../../../../localization/useFormatter';
import { useLocalize } from '../../../../localization/useLocalize';
import { localizeApiError } from '../../../../localization/localizeApiError';

import type {
  SkillDetail,
  SkillLibraryView,
} from '../types/skill.types';


interface SkillDetailPageProps {
  skillId: string;
  view?: SkillLibraryView;

  onBack: () => void;
  onEdit?: () => void;
  onChanged: () => void | Promise<void>;
  onRestored?: () => void | Promise<void>;
}

export default function SkillDetailPage({
  skillId,
  view = 'mine',
    onBack,
  onEdit,
  onChanged,
  onRestored,
}: SkillDetailPageProps) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const formatter = useFormatter();

  const formatSkillDateTime = useCallback(
    (value?: string | null): string => {
      if (!value) {
        return localize('common.notAvailable');
      }

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }

      return formatter.formatDateTime(date, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    },
    [formatter, localize],
  );

  const [skill, setSkill] =
    useState<SkillDetail | null>(null);

  const [error, setError] =
    useState('');

  const [actionBusy, setActionBusy] =
    useState(false);

  const [actionError, setActionError] =
    useState('');

  const [deleteOpen, setDeleteOpen] =
    useState(false);

  const [deleteBusy, setDeleteBusy] =
    useState(false);


  const deletedView =
    view === 'deleted';

  const refresh = useCallback(
    async () => {
      try {
        const nextSkill = deletedView
          ? await getDeletedSkill(
              skillId,
            )
          : await getSkill(skillId);

        setSkill(nextSkill);
        setError('');
      } catch (reason) {
        setError(
          localizeApiError(reason, 'skills.detail.loadFailed'),
        );
      }
    },
    [
      deletedView,
      skillId,
    ],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const restoreDeleted =
    async () => {
      if (
        !skill?.viewerCanRestoreDeleted ||
        actionBusy
      ) {
        return;
      }

      setActionBusy(true);
      setActionError('');

      try {
        await restoreDeletedSkill(
          skill.id,
        );

        await onChanged();

        if (onRestored) {
          await onRestored();
        } else {
          onBack();
        }
      } catch (reason) {
        setActionError(
          localizeApiError(reason, 'skills.detail.restoreFailed'),
        );
      } finally {
        setActionBusy(false);
      }
    };

  const changeArchiveState =
    async () => {
      if (
        !skill?.viewerCanManage ||
        actionBusy
      ) {
        return;
      }

      setActionBusy(true);
      setActionError('');

      try {
        await setSkillLifecycle(
          skill.id,
          skill.status === 'ARCHIVED'
            ? 'restore'
            : 'archive',
        );

        await refresh();
        await onChanged();
      } catch (reason) {
        setActionError(
          localizeApiError(reason, 'skills.detail.statusUpdateFailed'),
        );
      } finally {
        setActionBusy(false);
      }
    };

  const removeDraft =
    async () => {
      if (
        !skill?.viewerCanDelete ||
        deleteBusy
      ) {
        return;
      }

      setDeleteBusy(true);
      setActionError('');

      try {
        await deleteSkill(skill.id);

        setDeleteOpen(false);

        await onChanged();

        onBack();
      } catch (reason) {
        setActionError(
          localizeApiError(reason, 'skills.detail.deleteFailed'),
        );
      } finally {
        setDeleteBusy(false);
      }
    };

  const pageBg = 'bg-surface-page-soft text-theme-strong  ';

  const cardBg = 'border-edge-default bg-surface-raised  ';

  const softBg = 'bg-[#f7f8fb] dark:bg-[#151515]';

  const border = 'border-edge-default ';

  const muted = 'text-theme-muted-solid ';

  const metricBg = 'border-[#e8e8e8] bg-surface-base dark:border-[#292929] ';

  const secondaryButton = [
    'h-[40px]',
    'w-full',
    'rounded-[10px]',
    'border',
    'text-[13px]',
    'transition-all',
    'disabled:cursor-not-allowed',
    'disabled:opacity-50',
    border,
    'hover:bg-[#f2f3f7] dark:hover:bg-[#262626]',
  ].join(' ');

  if (error) {
    return (
      <div
        className={`
          flex
          h-full
          w-full
          items-center
          justify-center
          px-[28px]
          text-[13px]
          text-red-400
          ${pageBg}
        `}
      >
        {error}
      </div>
    );
  }

  if (!skill) {
    return (
      <div
        className={`
          flex
          h-full
          w-full
          items-center
          justify-center
          px-[28px]
          text-[13px]
          ${pageBg}
        `}
      >
        <span className={muted}>
          {localize('skills.detail.loading')}
        </span>
      </div>
    );
  }

  const editable =
    skill.versions.find(
      (version) =>
        version.status === 'DRAFT',
    ) ??
    skill.currentVersion ??
    skill.versions[0];

  const currentVersionLabel =
    skill.currentVersion
      ?.versionLabel ??
    editable?.versionLabel ??
    localize('skills.detail.draftVersion');

  const authorName =
    skill.createdBy?.username?.trim() ||
    localize('skills.detail.unknownAuthor');

  const displayName =
    getSkillDisplayName(skill);

  const activationLabel = localize(
    `skills.activation.${skill.defaultActivationMode}`,
  );

  const sourceLabel = skill.source
    ? localize(
        isAgentGeneratedSkillSource(skill.source)
          ? 'skills.source.AI_GENERATED'
          : `skills.source.${skill.source.kind}`,
      )
    : localize('skills.source.UNKNOWN');

  return (
    <div
      data-skill-detail-page
      className={`
        h-full
        w-full
        select-none
        overflow-y-auto
        ${pageBg}
      `}
      onCopy={(event) => {
        const target = event.target;

        if (
          !(
            target instanceof Element &&
            target.closest(
              '[data-skill-markdown-copyable="true"]',
            )
          )
        ) {
          event.preventDefault();
        }
      }}
      onDragStart={(event) => {
        const target = event.target;

        if (
          !(
            target instanceof Element &&
            target.closest(
              '[data-skill-markdown-copyable="true"]',
            )
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <style>
        {`
          [data-skill-detail-page],
          [data-skill-detail-page] * {
            -webkit-user-select: none !important;
            user-select: none !important;
          }

          [data-skill-detail-page]
            [data-skill-markdown-copyable="true"],
          [data-skill-detail-page]
            [data-skill-markdown-copyable="true"] * {
            -webkit-user-select: text !important;
            user-select: text !important;
          }
        `}
      </style>
      <div
        className="
          mx-auto
          box-border
          w-full
          max-w-[1180px]
          px-[28px]
          py-[24px]
        "
      >
        {actionError && (
          <div
            className="
              mb-[12px]
              text-[11px]
              text-red-400
            "
          >
            {actionError}
          </div>
        )}

        <div
          className={`
            overflow-hidden
            rounded-[24px]
            border
            shadow-sm
            ${cardBg}
          `}
        >
          <div
            className="
              relative
              h-[160px]
              w-full
              overflow-hidden
            "
          >
            {skill.coverUrl ? (
              <img
                src={skill.coverUrl}
                alt={localize('common.coverAlt', { name: displayName })}
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
                  h-full
                  w-full
                  bg-cover
                  bg-center
                "
                style={{
                  backgroundImage: `url("${
                    isDarkTheme
                      ? resolveAssetUrl('/backgrounds/agent-card-dark.jpg')
                      : resolveAssetUrl('/backgrounds/agent-card-light.jpg')
                  }")`,
                }}
              />
            )}

            <div
              className="
                absolute
                inset-0
                bg-gradient-to-t
                from-[#000000]/65
                via-[#000000]/15
                to-transparent
              "
            />

            <button
              type="button"
              onClick={onBack}
              className={[
                'absolute',
                'left-[10px]',
                'top-[10px]',
                'z-20',
                'flex',
                'h-[32px]',
                'w-[32px]',
                'rounded-full',
                'items-center',
                'justify-center',
                'gap-[8px]',
                'text-[12px]',
                'transition-all',
                border,
                'bg-[#ffffff]/20 text-[#333333] hover:bg-[#f2f3f7] dark:bg-[#1a1a1a]/20 dark:text-[#d8d8d8] dark:hover:bg-[#242424]',
              ].join(' ')}
            >
             <span
  className={`
    block
    text-[18px]
    leading-none
    ${
      'text-[#a8a8a8] dark:text-[#d8d8d8]'
    }
  `}
>
  ←
</span>
            </button>

            <div
              className="
                absolute
                bottom-[22px]
                left-[28px]
                right-[28px]
                flex
                min-w-0
                items-end
                gap-[18px]
              "
            >
              <div
                className={`
                  flex
                  h-[88px]
                  w-[88px]
                  shrink-0
                  items-center
                  justify-center
                  overflow-hidden
                  rounded-[18px]
                  text-[40px]
                  font-bold
                  shadow-lg
                  ${
                    'bg-accent-surface text-accent-foreground  '
                  }
                `}
              >
                {skill.iconUrl ? (
                  <img
                    src={skill.iconUrl}
                    alt={localize('common.iconAlt', { name: displayName })}
                    className="
                      h-full
                      w-full
                      object-cover
                    "
                    draggable={false}
                  />
                ) : (
                  displayName
                    ?.trim()
                    ?.[0] || 'S'
                    ?.toUpperCase() || 'S'
                )}
              </div>

              <div
                className="
                  grid
                  h-[76px]
                  min-w-0
                  flex-1
                  self-end
                  grid-rows-[34px_40px]
                  overflow-hidden
                "
              >
                <div
                  className="
                    flex
                    h-[34px]
                    min-w-0
                    flex-nowrap
                    items-center
                    gap-[10px]
                    overflow-hidden
                  "
                >
                  <h1
                    className="
                      min-w-0
                      max-w-[620px]
                      flex-1
                      truncate
                      text-[28px]
                      font-bold
                      leading-tight
                      text-theme-primary
                    "
                    title={displayName}
                  >
                    {displayName}
                  </h1>

                  <div
                    className="
                      flex
                      h-[24px]
                      shrink-0
                      items-center
                      [&>span]:box-border
                      [&>span]:flex
                      [&>span]:h-[24px]
                      [&>span]:items-center
                    "
                  >
                    <SkillStatusBadge
                      status={skill.status}
                      securityState={
                        skill.securityState
                      }
                      deletedAt={
                        skill.deletedAt
                      }
                    />
                  </div>

                  <span
                    className={`
                      box-border
                      flex
                      h-[24px]
                      shrink-0
                      items-center
                      rounded-full
                      px-[10px]
                      text-[11px]
                      backdrop-blur
                      ${
                        'bg-surface-pill text-theme-strong  '
                      }
                    `}
                  >
                    {currentVersionLabel}
                  </span>

                  <span
                    className={`
                      box-border
                      flex
                      h-[24px]
                      shrink-0
                      items-center
                      rounded-full
                      px-[10px]
                      text-[10px]
                      backdrop-blur
                      ${
                        'bg-surface-pill text-theme-strong  '
                      }
                    `}
                  >
                    {sourceLabel}
                  </span>
                </div>

                <p
                  className="
                    m-0
                    max-w-[760px]
                    break-words
                    text-[10px]
                    text-theme-head-description
                  "
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient:
                      'vertical',
                    WebkitLineClamp: 2,
                    lineHeight: '20px',
                    maxHeight: '40px',
                    overflow: 'hidden',
                  }}
                  title={
                    skill.description ||
                    localize('common.noDescription')
                  }
                >
                  {skill.description ||
                    localize('common.noDescription')}
                </p>
              </div>
            </div>
          </div>

          <div
            className="
              grid
              grid-cols-[minmax(0,1fr)_240px]
              gap-[10px]
              p-[10px]
            "
          >
            <div
              className="
                min-w-0
                space-y-[10px]
              "
            >
              <section
                className={`
                  rounded-[18px]
                  border
                  p-[10px]
                  ${border}
                  ${softBg}
                `}
              >
                <div
                  className="
                    grid
                    grid-cols-4
                    gap-[10px]
                  "
                >
                  <MetricCard
                    label={localize('skills.detail.activationMode')}
                    value={activationLabel}
                    className={metricBg}
                    muted={muted}
                  />

                  <MetricCard
                    label={localize('skills.detail.bindingCount')}
                    value={String(
                      skill._count
                        ?.agentBindings ??
                        0,
                    )}
                    className={metricBg}
                    muted={muted}
                  />

                  <MetricCard
                    label={localize('skills.detail.usageCount')}
                    value={String(
                      skill.useCount,
                    )}
                    className={metricBg}
                    muted={muted}
                  />

                  <MetricCard
                    label={localize('skills.detail.versionCount')}
                    value={String(
                      skill.versions.length,
                    )}
                    className={metricBg}
                    muted={muted}
                  />
                </div>
              </section>

              {deletedView && (
                <section
                  className={`
                    rounded-[18px]
                    border
                    p-[18px]
                    ${border}
                    ${softBg}
                  `}
                >
                  <div
                    className="
                      flex
                      items-center
                      justify-between
                    "
                  >
                    <h2
                      className="
                        text-[16px]
                        font-semibold
                      "
                    >
                      {localize('skills.detail.retentionInfo')}
                    </h2>

                    <span
                      className="
                        rounded-full
                        bg-amber-500/10
                        px-[10px]
                        py-[4px]
                        text-[11px]
                        text-amber-500
                      "
                    >
                      {localize('skills.detail.retention30Days')}
                    </span>
                  </div>

                  <div
                    className="
                      mt-[14px]
                      grid
                      grid-cols-2
                      gap-[10px]
                    "
                  >
                    <div
                      className={`
                        rounded-[14px]
                        border
                        px-[14px]
                        py-[12px]
                        ${metricBg}
                      `}
                    >
                      <div
                        className={`
                          text-[11px]
                          ${muted}
                        `}
                      >
                        {localize('skills.detail.deletedAt')}
                      </div>

                      <div
                        className="
                          mt-[5px]
                          text-[13px]
                          font-medium
                        "
                      >
                        {formatSkillDateTime(
                          skill.deletedAt,
                        )}
                      </div>
                    </div>

                    <div
                      className={`
                        rounded-[14px]
                        border
                        px-[14px]
                        py-[12px]
                        ${metricBg}
                      `}
                    >
                      <div
                        className={`
                          text-[11px]
                          ${muted}
                        `}
                      >
                        {localize('skills.detail.purgeAt')}
                      </div>

                      <div
                        className="
                          mt-[5px]
                          text-[13px]
                          font-medium
                        "
                      >
                        {formatSkillDateTime(
                          skill.purgeAfter,
                        )}
                      </div>
                    </div>
                  </div>

                  <p
                    className={`
                      mt-[12px]
                      text-[11px]
                      leading-5
                      ${muted}
                    `}
                  >
                    {localize('skills.detail.restoreScopeHint')}
                  </p>
                </section>
              )}

              <section
                className={`
                  rounded-[10px]
                  border
                  px-[10px]
                  ${border}
                  ${softBg}
                `}
              >
                <div
                  className="
                    flex
                    items-center
                    justify-between
                  "
                >
                  <h2
                    className="
                      text-[14px]
                      font-semibold
                    "
                  >
                    SKILL.md
                  </h2>

                  <span
                    className={`
                      text-[10px]
                      ${muted}
                    `}
                  >
                    {editable
                      ?.versionLabel ??
                      localize('skills.version.none')}
                  </span>
                </div>

                <pre
                  data-skill-markdown-copyable="true"
                  className={`
                    max-h-[350px]
                    select-text
                    overflow-auto
                    whitespace-pre-wrap
                    break-words
                    rounded-[10px]
                    border
                    px-[10px]
                    text-[10px]
                    leading-6
                    ${metricBg}
                  `}
                >
                  {editable?.skillMarkdown ||
                    localize('skills.detail.noMarkdown')}
                </pre>
              </section>

              {!deletedView &&
                editable && (
                  <section
                    className={`
                      rounded-[18px]
                      border
                      p-[18px]
                      ${border}
                      ${softBg}
                    `}
                  >
                    <SkillFileManager
                      skillId={skill.id}
                      versionId={
                        editable.id
                      }
                      isDraft={
                        editable.status ===
                        'DRAFT'
                      }
                      readOnly
                    />
                  </section>
                )}

            </div>

            <aside
              className="
                min-w-0
                space-y-[10px]
              "
            >
              <section
                className={`
                  rounded-[10px]
                  border
                  px-[10px]
                  ${border}
                  ${softBg}
                `}
              >
                <h2
                  className="
                    text-[14px]
                    font-semibold
                  "
                >
                  {localize('common.actions.title')}
                </h2>

                <div
                  className="
                    space-y-[10px]
                  "
                >
                  {deletedView ? (
                    <button
                      type="button"
                      disabled={
                        actionBusy ||
                        !skill.viewerCanRestoreDeleted
                      }
                      onClick={() => {
                        void restoreDeleted();
                      }}
                      className="
                        h-[40px]
                        w-full
                        rounded-[10px]
                        bg-action-primary
                        text-[14px]
                        font-medium
                        !text-[#ffffff]
                        transition-all
                        hover:bg-action-primary-hover
                        hover:!text-[#ffffff]
                        disabled:cursor-not-allowed
                        disabled:opacity-45
                      "
                    >
                      {actionBusy
                        ? localize('skills.detail.restoring')
                        : localize('skills.detail.restore')}
                    </button>
                  ) : (
                    <>
                      {skill.viewerCanManage &&
                      onEdit ? (
                        <button
                          type="button"
                          onClick={onEdit}
                          className="
                            h-[40px]
                            w-full
                            rounded-[10px]
                            bg-action-primary
                            text-[14px]
                            font-medium
                            text-[#ffffff]
                            transition-all
                            hover:bg-action-primary-hover
                            hover:!text-[#ffffff]
                          "
                        >
                          {localize('skills.detail.edit')}
                        </button>
                      ) : null}

                      {skill.viewerCanManage ? (
                        <button
                          type="button"
                          disabled={
                            actionBusy
                          }
                          onClick={() => {
                            void changeArchiveState();
                          }}
                          className={
                            secondaryButton
                          }
                        >
                          {actionBusy
                            ? localize('common.processing')
                            : skill.status ===
                                'ARCHIVED'
                              ? localize('skills.detail.restore')
                              : localize('skills.detail.archive')}
                        </button>
                      ) : null}

                      {skill.viewerCanDelete ? (
                        <button
  type="button"
  disabled={deleteBusy}
  onClick={() => {
    setActionError('');
    setDeleteOpen(true);
  }}
  className="
    h-[40px]
    w-full
    mb-[10px]
    rounded-[10px]
    border-[0.5px]
    border-status-danger
    text-[13px]
    text-status-danger
    transition-all
    hover:bg-status-danger-soft
    disabled:cursor-not-allowed
    disabled:opacity-50
  "
>
  {deleteBusy
    ? localize('common.actions.deleting')
    : localize('skills.detail.delete')}
</button>
                      ) : null}
                    </>
                  )}
                </div>
              </section>

              <section
                className={`
                  rounded-[10px]
                  border
                  px-[10px]
                  ${border}
                  ${softBg}
                `}
              >
                <h2
                  className="
                    text-[14px]
                    font-semibold
                  "
                >
                  {localize('common.basicInfo')}
                </h2>

                <div
                  className="
                    mt-[10px]
                    mb-[10px]
                    space-y-[10px]
                    text-[10px]
                  "
                >
                  <InfoRow
                    label={localize('common.author')}
                    value={authorName}
                    muted={muted}
                  />

                  <InfoRow
                    label={localize('skills.detail.currentVersion')}
                    value={
                      currentVersionLabel
                    }
                    muted={muted}
                  />

                  <InfoRow
                    label={localize('common.source')}
                    value={sourceLabel}
                    muted={muted}
                  />

                  <InfoRow
                    label={localize('common.visibility')}
                    value={skill.visibility}
                    muted={muted}
                  />

                  <InfoRow
                    label={localize('skills.detail.trustLevel')}
                    value={
                      skill.trustLevel
                    }
                    muted={muted}
                  />

                  <InfoRow
                    label={localize('skills.detail.activationMode')}
                    value={
                      activationLabel
                    }
                    muted={muted}
                  />

                  <InfoRow
                    label={localize('skills.detail.installCount')}
                    value={String(
                      skill._count
                        ?.installations ??
                        0,
                    )}
                    muted={muted}
                  />

                  <InfoRow
                    label={localize('common.createdAt')}
                    value={formatSkillDateTime(
                      skill.createdAt,
                    )}
                    muted={muted}
                  />

                  <InfoRow
                    label={localize('common.updatedAt')}
                    value={formatSkillDateTime(
                      skill.updatedAt,
                    )}
                    muted={muted}
                  />

                  <InfoRow
                    label={localize('skills.detail.lastUsed')}
                    value={formatSkillDateTime(
                      skill.lastUsedAt,
                    )}
                    muted={muted}
                  />
                </div>
              </section>

              <section
                className={`
                  rounded-[10px]
                  border
                  px-[10px]
                  ${border}
                  ${softBg}
                `}
              >
                <div
                  className="
                    flex
                    items-center
                    justify-between
                  "
                >
                  <h2
                    className="
                      text-[14px]
                      font-semibold
                    "
                  >
                    {localize('skills.detail.versionHistory')}
                  </h2>

                  <span
                    className={`
                      text-[10px]
                      ${muted}
                    `}
                  >
                    {localize('skills.detail.versionCountValue', { count: skill.versions.length })}
                  </span>
                </div>

                <div
                  className="
                    mt-[14px]
                    max-h-[420px]
                    space-y-[10px]
                    overflow-y-auto
                  "
                >
                  {skill.versions.length >
                  0 ? (
                    skill.versions.map(
                      (version) => (
                        <div
                          key={version.id}
                          className={`
                            rounded-[14px]
                            border
                            px-[13px]
                            py-[11px]
                            mb-[10px]
                            ${metricBg}
                          `}
                        >
                          <div
                            className="
                              flex
                              items-center
                              justify-between
                              gap-[10px]
                            "
                          >
                            <span
                              className="
                                min-w-0
                                truncate
                                text-[13px]
                                font-medium
                              "
                            >
                              {
                                version.versionLabel
                              }
                            </span>

                            <span
                              className={`
                                shrink-0
                                text-[10px]
                                ${muted}
                              `}
                            >
                              {
                                localize(
                                  `skills.version.${version.status}`,
                                )
                              }
                            </span>
                          </div>

                          <div
                            className={`
                              mt-[6px]
                              truncate
                              text-[10px]
                              ${muted}
                            `}
                            title={
                              version.packageChecksum
                            }
                          >
                            {
                              version.packageChecksum
                            }
                          </div>

                          <div
                            className={`
                              mt-[5px]
                              text-[10px]
                              ${muted}
                            `}
                          >
                            {formatSkillDateTime(
                              version.createdAt,
                            )}
                          </div>
                        </div>
                      ),
                    )
                  ) : (
                    <div
                      className={`
                        rounded-[14px]
                        border
                        border-dashed
                        p-[16px]
                        text-[12px]
                        ${border}
                        ${muted}
                      `}
                    >
                      {localize('skills.detail.noVersionRecords')}
                    </div>
                  )}
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={deleteOpen}

        title={localize('skills.detail.deleteConfirmTitle')}
        description={localize('skills.detail.deleteConfirmDescription')}
        confirmText={
          deleteBusy
            ? localize('common.actions.deleting')
            : localize('common.actions.delete')
        }
        cancelText={localize('common.actions.cancel')}
        danger
        onClose={() => {
          if (!deleteBusy) {
            setDeleteOpen(false);
          }
        }}
        onConfirm={() => {
          if (!deleteBusy) {
            void removeDraft();
          }
        }}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  className,
  muted,
}: {
  label: string;
  value: string;
  className: string;
  muted: string;
}) {
  return (
    <div
      className={`
        min-w-0
        rounded-[10px]
        border
        px-[10px]
        py-[10px]
        ${className}
      `}
    >
      <div
        className={`
          truncate
          text-[10px]
          ${muted}
        `}
      >
        {label}
      </div>

      <div
        className="
          truncate
          text-[10px]
          font-semibold
        "
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted: string;
}) {
  return (
    <div
      className="
        flex
        items-center
        justify-between
        gap-[10px]
      "
    >
      <span
        className={`
          shrink-0
          ${muted}
        `}
      >
        {label}
      </span>

      <span
        className="
          min-w-0
          truncate
          text-right
        "
        title={value}
      >
        {value}
      </span>
    </div>
  );
}