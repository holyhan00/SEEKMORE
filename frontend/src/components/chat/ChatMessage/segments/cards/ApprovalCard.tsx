                                                                           

import {
  memo,
  useState,
} from 'react';
import type {
  ReactNode,
} from 'react';
import {
  ShieldAlert,
} from 'lucide-react';

import type {
  RuntimeApprovalDecision,
} from '../../../runtime/approval/runtimeApprovalClient';
import type {
  RuntimeActivity,
} from '../../../runtime/events/runtime-events.types';
import { useLocalize } from '../../../../../localization/useLocalize';

type Props = {
  activity: RuntimeActivity;

  onDecision?: (
    approvalId: string,
    decision: RuntimeApprovalDecision,
    taskRunId?: string,
  ) => void;
};

function ApprovalCard({
  activity,
    onDecision,
}: Props) {
  const [submitting, setSubmitting] =
    useState(false);
  const t = useLocalize();

  const detail =
    activity.detail ?? {};

  const approvalId = text(
    detail.approvalId ?? detail.id,
  );

  const taskRunId = text(
    detail.taskRunId,
  );

  const waiting =
    activity.status === 'waiting'
    && Boolean(approvalId)
    && Boolean(onDecision);

  const decide = (
    decision: RuntimeApprovalDecision,
  ) => {
    if (
      !approvalId
      || !onDecision
      || submitting
    ) {
      return;
    }

    setSubmitting(true);

    onDecision(
      approvalId,
      decision,
      taskRunId || undefined,
    );

    window.setTimeout(
      () => {
        setSubmitting(false);
      },
      1200,
    );
  };

  return (
    <section
      className={`my-[8px] w-[280px] max-w-full rounded-[12px] ${
        'bg-[#f4f4f4] text-[#333333] dark:bg-[#191919] dark:text-[#d4d4d4]'
      }`}
      data-activity-id={
        activity.activityId
      }
    >
      <div className="px-[10px] pb-[7px] pt-[10px]">
        {                 }
        <div className="flex h-[22px] min-w-0 items-center gap-[7px]">
          <div
            className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] ${
              'bg-[#2563EB] text-[#ffffff] dark:bg-[#2563EB] dark:text-[#ffffff]'
            }`}
          >
            <ShieldAlert
              size={12}
              strokeWidth={2}
            />
          </div>

          <h4
            className={`m-0 min-w-0 flex-1 truncate text-[12px] font-medium leading-[18px] ${
              'text-[#333333] dark:text-[#d8d8d8]'
            }`}
          >
            {activity.title
              || t('approval.card.title')}
          </h4>
        </div>

        {                 }
        <p
          className={`m-0 mt-[6px] min-h-[16px] truncate pl-[25px] text-[12px] font-normal leading-[16px] ${
            'text-[#777777] dark:text-[#919191]'
          }`}
          title={
            activity.summary
            || undefined
          }
        >
          {activity.summary}
        </p>
      </div>

      {              }
      {waiting && (
        <div className="flex flex-wrap gap-[5px] px-[10px] pb-[9px]">
          <Action
            onClick={() =>
              decide('approved_once')
            }
            disabled={submitting}
            variant="primary"

          >
            {t('approval.action.allowOnce')}
          </Action>

          <Action
            onClick={() =>
              decide('audit_only')
            }
            disabled={submitting}
            variant="default"

          >
            {t('approval.action.auditOnly')}
          </Action>

          <Action
            onClick={() =>
              decide(
                'full_access_for_task',
              )
            }
            disabled={submitting}
            variant="access"

          >
            {t('approval.action.fullAccessTask')}
          </Action>

          <Action
            onClick={() =>
              decide('rejected')
            }
            disabled={submitting}
            variant="danger"

          >
            {t('approval.action.reject')}
          </Action>
        </div>
      )}

      {!approvalId
        && activity.status === 'waiting'
        && (
          <p
            className={`m-0 px-[10px] pb-[10px] text-[10px] leading-[16px] ${
              'text-[#999999] dark:text-[#777777]'
            }`}
          >
            {t('approval.checkpointCreating')}
          </p>
        )}
    </section>
  );
}

function Action({
  children,
  onClick,
  disabled,
    variant,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled: boolean;

  variant:
    | 'primary'
    | 'default'
    | 'access'
    | 'danger';
}) {
  const tone = resolveActionTone(variant);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-[24px] shrink-0 items-center justify-center rounded-[7px] px-[8px] text-[10px] font-medium leading-[14px] transition-colors duration-150 disabled:cursor-default ${
        variant === 'danger'
          ? 'disabled:opacity-100'
          : 'disabled:opacity-45'
      } ${tone}`}
    >
      {children}
    </button>
  );
}

function resolveActionTone(
  variant:
    | 'primary'
    | 'default'
    | 'access'
    | 'danger',
): string {
  if (variant === 'primary') {
    return 'bg-[#E2E2E2] text-[#585858] hover:bg-[#c8c8c8] dark:bg-[#f0f0f0] dark:text-[#1d1d1d] dark:hover:bg-[#ffffff]';
  }

  if (variant === 'access') {
    return 'bg-[#E2E2E2] text-[#585858] hover:bg-[#c8c8c8] dark:bg-[#252a36] dark:text-[#b9c9f8] dark:hover:bg-[#2d3443]';
  }

  if (variant === 'danger') {
    return 'border border-[#f44848]  text-[#c84b4b] hover:bg-[#C8C8C8] dark:border dark:border-[#d95f5f] dark:text-[#d95f5f] dark:hover:bg-[#303030]';
  }

  return 'bg-[#E2E2E2] text-[#585858] hover:bg-[#C8C8C8] dark:bg-[#262626] dark:text-[#b6b6b6] dark:hover:bg-[#303030]';
}

function text(
  value: unknown,
): string {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

export default memo(
  ApprovalCard,
);