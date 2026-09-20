import { useAppearance } from '../../../theme/useAppearance';
                                                             

import { useMemo, useState, type ReactNode } from 'react';
import { useFormatter } from '../../../localization/useFormatter';
import { useLocalize } from '../../../localization/useLocalize';
import { useLocalization } from '../../../localization/LocalizationProvider';
import { confirm } from '../../../lib/confirm';
import {
  cancelAutomation,
  pauseAutomation,
  resumeAutomation,
  updateAutomation,
} from './automation.api';
import { applyAutomationSnapshot } from './automation.store';
import type {
  AutomationDeliveryPolicy,
  AutomationRepeatUnit,
  AutomationSnapshot,
  AutomationStopPolicy,
  AutomationTrigger,
} from './automation.types';


export default function AutomationCard({
  automation,
  }: {
  automation: AutomationSnapshot;

}) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const formatter = useFormatter();
  const t = useLocalize();
  const { snapshot } = useLocalization();
  const automationTimeZone = automation.trigger.kind === 'interval'
    ? automation.trigger.timeZone || snapshot.timeZone
    : snapshot.timeZone;
  const formatDate = (value: string): string => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '-';
    return formatter.formatDateTime(date, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: automationTimeZone,
    });
  };

  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [instructionExpanded, setInstructionExpanded] =
    useState(false);
  const [title, setTitle] = useState(automation.title);
  const [instruction, setInstruction] = useState(
    automation.instruction,
  );

  const [every, setEvery] = useState(
    automation.trigger.kind === 'interval'
      ? String(automation.trigger.every)
      : '1',
  );

  const [unit, setUnit] = useState<AutomationRepeatUnit>(
    automation.trigger.kind === 'interval'
      ? automation.trigger.unit
      : 'day',
  );

  const [runAt, setRunAt] = useState(
    automation.trigger.kind === 'once'
      ? toLocalInput(automation.trigger.runAt)
      : futureLocalInput(
          automation.nextWakeAt ??
            automation.trigger.runAt,
        ),
  );

  const [expiresAt, setExpiresAt] = useState(
    toLocalInput(
      automation.stopPolicy.expiresAt ??
        automation.expiresAt,
    ),
  );

  const [maxRuns, setMaxRuns] = useState(
    automation.stopPolicy.maxRuns
      ? String(automation.stopPolicy.maxRuns)
      : '',
  );

  const [indefinite, setIndefinite] = useState(
    automation.stopPolicy.indefinite === true,
  );

  const [deliveryMode, setDeliveryMode] =
    useState<AutomationDeliveryPolicy['mode']>(
      automation.deliveryPolicy?.mode ?? 'always',
    );

  const palette = useMemo(
    () => ({
      card: isDarkTheme ? '#222222' : '#F2F2F2',
      border: isDarkTheme ? '#353535' : '#E2E2E2',
      primary: isDarkTheme ? '#F2F2F2' : '#252525',
      secondary: isDarkTheme ? '#A8A8A8' : '#686868',
      button: isDarkTheme ? '#333333' : '#E2E2E2',
      buttonHover: isDarkTheme ? '#3D3D3D' : '#D6D6D6',
      input: isDarkTheme ? '#292929' : '#FFFFFF',
      danger: isDarkTheme ? '#FF6B6B' : '#C62828',
    }),
    [isDarkTheme],
  );

  const status = statusView(
    automation.status,
    isDarkTheme,
    t,
  );

  const mutate = async (
    operation: () => Promise<AutomationSnapshot>,
  ) => {
    if (busy) return;

    setBusy(true);

    try {
      applyAutomationSnapshot(
        await operation(),
      );
    } catch (error) {
      console.error(
        '[Automation] action failed',
        error,
      );

      alert(t('automation.errors.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    const ok = await confirm({
      title: t('automation.cancel.confirmTitle', { title: automation.title }),
      description: t('automation.cancel.confirmDescription'),
      confirmText: t('automation.actions.end'),
      cancelText: t('common.actions.cancel'),
      danger: true,
    });

    if (!ok) return;

    await mutate(() =>
      cancelAutomation(automation.id),
    );
  };

  const handleSave = async () => {
    const normalizedTitle =
      title.trim();

    const normalizedInstruction =
      instruction.trim();

    if (
      !normalizedTitle ||
      !normalizedInstruction
    ) {
      alert(t('automation.errors.required'));
      return;
    }

    let trigger: AutomationTrigger;

    if (
      automation.trigger.kind === 'once'
    ) {
      const value =
        isoFromLocal(runAt);

      if (!value) {
        alert(t('automation.errors.invalidRunAt'));
        return;
      }

      trigger = {
        kind: 'once',
        runAt: value,
      };
    } else {
      const count = Math.max(
        1,
        Math.floor(
          Number(every) || 1,
        ),
      );

      trigger = {
        kind: 'interval',
        every: count,
        unit,
        runAt:
          futureIsoFromLocal(
            runAt,
          ),
        timeZone: automation.trigger.kind === 'interval'
          ? automation.trigger.timeZone || snapshot.timeZone
          : snapshot.timeZone,
      };
    }

    const stopPolicy:
      AutomationStopPolicy = {
        ...automation.stopPolicy,

        expiresAt:
          indefinite
            ? null
            : isoFromLocal(
                expiresAt,
              ),

        maxRuns:
          indefinite
            ? null
            : maxRuns.trim()
              ? Math.max(
                  1,
                  Math.floor(
                    Number(maxRuns) ||
                      1,
                  ),
                )
              : null,

        completionCondition:
          indefinite
            ? null
            : (
                automation
                  .stopPolicy
                  .completionCondition ??
                null
              ),

        indefinite,
      };

    const effectiveDeliveryMode:
      AutomationDeliveryPolicy['mode'] =
        stopPolicy.completionCondition
          ? deliveryMode
          : 'always';

    await mutate(async () => {
      const updated =
        await updateAutomation(
          automation.id,
          {
            title:
              normalizedTitle,

            instruction:
              normalizedInstruction,

            trigger,

            stopPolicy,

            deliveryPolicy: {
              mode:
                effectiveDeliveryMode,
            },
          },
        );

      setEditing(false);

      return updated;
    });
  };

  const instructionCanCollapse =
    automation.instruction.length > 160
    || automation.instruction.split('\n').length > 4;

  return (
    <div
      className="
        w-full
        min-w-0
        max-w-full
        box-border
        overflow-hidden
        rounded-[10px]
        border
        p-[10px]
        flex
        flex-col
        gap-[10px]
      "
      style={{
        backgroundColor:
          palette.card,
        borderColor:
          palette.border,
        color:
          palette.primary,
      }}
    >
      <div
        className="
          w-full
          min-w-0
          max-w-full
          flex
          items-center
          justify-between
          gap-[10px]
        "
      >
        <div
          className="
            min-w-0
            flex-1
            text-[13px]
            font-medium
            truncate
          "
        >
          {automation.title}
        </div>

        <div
          className="
            flex
            shrink-0
            items-center
            gap-[6px]
            text-[11px]
          "
          style={{
            color:
              status.color,
          }}
        >
          <span
            className="
              w-[6px]
              h-[6px]
              shrink-0
              rounded-full
            "
            style={{
              backgroundColor:
                status.color,
            }}
          />

          {status.label}
        </div>
      </div>

      {!editing ? (
        <>
          <div
            className="
              w-full
              min-w-0
              max-w-full
              flex
              flex-col
              items-start
              gap-[6px]
            "
          >
            <div
              className="
                w-full
                min-w-0
                max-w-full
                whitespace-pre-wrap
                break-words
                [overflow-wrap:anywhere]
              "
              style={{
                color:
                  palette.secondary,
                fontSize: '10px',
                lineHeight: '16px',
                maxHeight:
                  instructionCanCollapse
                  && !instructionExpanded
                    ? '64px'
                    : 'none',
                overflow:
                  instructionCanCollapse
                  && !instructionExpanded
                    ? 'hidden'
                    : 'visible',
              }}
            >
              {automation.instruction}
            </div>

            {instructionCanCollapse ? (
              <button
                type="button"
                onClick={() =>
                  setInstructionExpanded(
                    (current) => !current,
                  )
                }
                className="
                  border-0
                  bg-transparent
                  p-0
                  cursor-pointer
                "
                style={{
                  color:
                    palette.secondary,
                  fontSize: '10px',
                  lineHeight: '16px',
                }}
              >
                {instructionExpanded
                  ? t('common.actions.collapse')
                  : t('common.actions.expandAll')}
              </button>
            ) : null}
          </div>

          <div
            className="
              w-full
              min-w-0
              max-w-full
              grid
              grid-cols-[auto_minmax(0,1fr)]
              gap-x-[10px]
              gap-y-[6px]
              text-[11px]
            "
            style={{
              color:
                palette.secondary,
            }}
          >
            <span>{t('automation.fields.frequency')}</span>

            <InfoValue
              color={palette.primary}
            >
              {triggerText(
                automation.trigger,
                formatDate,
                t,
              )}
            </InfoValue>

            <span>{t('automation.fields.delivery')}</span>

            <InfoValue
              color={palette.primary}
            >
              {automation
                .deliveryPolicy
                ?.mode ===
              'on_completion'
                ? t('automation.delivery.onCompletion')
                : t('automation.delivery.always')}
            </InfoValue>

            {automation.expiresAt ? (
              <>
                <span>
                  {t('automation.fields.endAt')}
                </span>

                <InfoValue
                  color={
                    palette.primary
                  }
                >
                  {formatDate(
                    automation
                      .expiresAt,
                  )}
                </InfoValue>
              </>
            ) : null}

            {automation
              .stopPolicy
              .maxRuns ? (
              <>
                <span>
                  {t('automation.fields.maxRuns')}
                </span>

                <InfoValue
                  color={
                    palette.primary
                  }
                >
                  {
                    automation
                      .stopPolicy
                      .maxRuns
                  }{' '}
                  {t('automation.unit.times')}
                </InfoValue>
              </>
            ) : null}

            {automation
              .stopPolicy
              .completionCondition ? (
              <>
                <span>
                  {t('automation.fields.completionCondition')}
                </span>

                <InfoValue
                  color={
                    palette.primary
                  }
                >
                  {completionConditionText(
                    automation
                      .stopPolicy
                      .completionCondition,
                    t,
                  )}
                </InfoValue>
              </>
            ) : null}

            {automation
              .stopPolicy
              .indefinite ? (
              <>
                <span>
                  {t('automation.fields.validity')}
                </span>

                <InfoValue
                  color={
                    palette.primary
                  }
                >
                  {t('automation.validity.indefinite')}
                </InfoValue>
              </>
            ) : null}

            {automation
              .nextWakeAt ? (
              <>
                <span>
                  {t('automation.fields.nextRun')}
                </span>

                <InfoValue
                  color={
                    palette.primary
                  }
                >
                  {formatDate(
                    automation
                      .nextWakeAt,
                  )}
                </InfoValue>
              </>
            ) : null}

            {automation.expiresAt &&
            automation.status ===
              'ACTIVE' ? (
              <>
                <span>
                  {t('automation.fields.remaining')}
                </span>

                <InfoValue
                  color={
                    palette.primary
                  }
                >
                  {remainingText(
                    automation
                      .expiresAt,
                    t,
                  )}
                </InfoValue>
              </>
            ) : null}

            {automation
              .completedAt ? (
              <>
                <span>
                  {t('automation.fields.completedAt')}
                </span>

                <InfoValue
                  color={
                    palette.primary
                  }
                >
                  {formatDate(
                    automation
                      .completedAt,
                  )}
                </InfoValue>
              </>
            ) : null}

            {automation
              .cancelledAt ? (
              <>
                <span>
                  {t('automation.fields.endAt')}
                </span>

                <InfoValue
                  color={
                    palette.primary
                  }
                >
                  {formatDate(
                    automation
                      .cancelledAt,
                  )}
                </InfoValue>
              </>
            ) : null}
          </div>

          {(automation.status ===
            'ACTIVE' ||
            automation.status ===
              'PAUSED') && (
            <div
              className="
                w-full
                min-w-0
                max-w-full
                flex
                flex-wrap
                items-center
                gap-[10px]
              "
            >
              <ActionButton
                palette={palette}
                disabled={busy}
                onClick={() =>
                  setEditing(true)
                }
              >
                {t('common.actions.edit')}
              </ActionButton>

              {automation.status ===
              'ACTIVE' ? (
                <ActionButton
                  palette={palette}
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      pauseAutomation(
                        automation.id,
                      ),
                    )
                  }
                >
                  {t('common.actions.pause')}
                </ActionButton>
              ) : (
                <ActionButton
                  palette={palette}
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      resumeAutomation(
                        automation.id,
                      ),
                    )
                  }
                >
                  {t('common.actions.resume')}
                </ActionButton>
              )}

              <ActionButton
                palette={palette}
                danger
                disabled={busy}
                onClick={() =>
                  void handleCancel()
                }
              >
                {t('automation.actions.end')}
              </ActionButton>
            </div>
          )}
        </>
      ) : (
        <div
          className="
            w-full
            min-w-0
            max-w-full
            flex
            flex-col
            gap-[10px]
          "
        >
          <Field
            label={t('automation.fields.title')}
            color={
              palette.secondary
            }
          >
            <input
              value={title}
              onChange={(event) =>
                setTitle(
                  event.target.value,
                )
              }
              className="
                w-full
                min-w-0
                max-w-full
                box-border
                rounded-[8px]
                border
                px-[10px]
                py-[8px]
                text-[12px]
                outline-none
              "
              style={{
                backgroundColor:
                  palette.input,
                borderColor:
                  palette.border,
                color:
                  palette.primary,
              }}
            />
          </Field>

          <Field
            label={t('automation.fields.instruction')}
            color={
              palette.secondary
            }
          >
            <textarea
              value={instruction}
              onChange={(event) =>
                setInstruction(
                  event.target.value,
                )
              }
              rows={3}
              className="
                w-full
                min-w-0
                max-w-full
                box-border
                resize-y
                rounded-[8px]
                border
                px-[10px]
                py-[8px]
                text-[14px]
                outline-none
              "
              style={{
                backgroundColor:
                  palette.input,
                borderColor:
                  palette.border,
                color:
                  palette.primary,
              }}
            />
          </Field>

          {automation.trigger.kind ===
          'interval' ? (
            <div
              className="
                w-full
                min-w-0
                max-w-full
                grid
                grid-cols-2
                gap-[10px]
              "
            >
              <Field
                label={t('automation.fields.every')}
                color={
                  palette.secondary
                }
              >
                <input
                  type="number"
                  min={1}
                  value={every}
                  onChange={(event) =>
                    setEvery(
                      event.target
                        .value,
                    )
                  }
                  className="
                    w-full
                    min-w-0
                    max-w-full
                    box-border
                    rounded-[8px]
                    border
                    px-[10px]
                    py-[8px]
                    text-[12px]
                    outline-none
                  "
                  style={{
                    backgroundColor:
                      palette.input,
                    borderColor:
                      palette.border,
                    color:
                      palette.primary,
                  }}
                />
              </Field>

              <Field
                label={t('automation.fields.unit')}
                color={
                  palette.secondary
                }
              >
                <select
                  value={unit}
                  onChange={(event) => {
                    setUnit(
                      event.target
                        .value as AutomationRepeatUnit,
                    );
                  }}
                  className="
                    w-full
                    min-w-0
                    max-w-full
                    box-border
                    rounded-[8px]
                    border
                    px-[10px]
                    py-[8px]
                    text-[12px]
                    outline-none
                  "
                  style={{
                    backgroundColor:
                      palette.input,
                    borderColor:
                      palette.border,
                    color:
                      palette.primary,
                  }}
                >
                  {(['minute', 'hour', 'day', 'week'] as AutomationRepeatUnit[]).map(
                    (value) => (
                      <option
                        key={value}
                        value={value}
                      >
                        {unitLabel(t, value)}
                      </option>
                    ),
                  )}
                </select>
              </Field>
            </div>
          ) : null}

          <Field
            label={
              automation.trigger
                .kind === 'once'
                ? t('automation.fields.runAt')
                : t('automation.fields.nextStartOptional')
            }
            color={
              palette.secondary
            }
          >
            <input
              type="datetime-local"
              value={runAt}
              onChange={(event) =>
                setRunAt(
                  event.target.value,
                )
              }
              className="
                w-full
                min-w-0
                max-w-full
                box-border
                rounded-[8px]
                border
                px-[10px]
                py-[8px]
                text-[12px]
                outline-none
              "
              style={{
                backgroundColor:
                  palette.input,
                borderColor:
                  palette.border,
                color:
                  palette.primary,
              }}
            />
          </Field>

          <Field
            label={t('automation.fields.delivery')}
            color={
              palette.secondary
            }
          >
            <select
              value={deliveryMode}
              onChange={(event) => {
                setDeliveryMode(
                  event.target
                    .value as AutomationDeliveryPolicy['mode'],
                );
              }}
              className="
                w-full
                min-w-0
                max-w-full
                box-border
                rounded-[8px]
                border
                px-[10px]
                py-[8px]
                text-[12px]
                outline-none
              "
              style={{
                backgroundColor:
                  palette.input,
                borderColor:
                  palette.border,
                color:
                  palette.primary,
              }}
            >
              <option value="always">
                {t('automation.delivery.always')}
              </option>

              {automation
                .stopPolicy
                .completionCondition &&
              !indefinite ? (
                <option value="on_completion">
                  {t('automation.delivery.onCompletion')}
                </option>
              ) : null}
            </select>
          </Field>

          <div
            className="
              w-full
              min-w-0
              max-w-full
              grid
              grid-cols-2
              gap-[10px]
            "
          >
            <Field
              label={t('automation.fields.endAt')}
              color={
                palette.secondary
              }
            >
              <input
                type="datetime-local"
                value={
                  expiresAt
                }
                disabled={
                  indefinite
                }
                onChange={(event) =>
                  setExpiresAt(
                    event.target.value,
                  )
                }
                className="
                  w-full
                  min-w-0
                  max-w-full
                  box-border
                  rounded-[8px]
                  border
                  px-[10px]
                  py-[8px]
                  text-[12px]
                  outline-none
                  disabled:opacity-50
                "
                style={{
                  backgroundColor:
                    palette.input,
                  borderColor:
                    palette.border,
                  color:
                    palette.primary,
                }}
              />
            </Field>

            <Field
              label={t('automation.fields.maxRunsInput')}
              color={
                palette.secondary
              }
            >
              <input
                type="number"
                min={1}
                value={maxRuns}
                disabled={
                  indefinite
                }
                onChange={(event) =>
                  setMaxRuns(
                    event.target.value,
                  )
                }
                className="
                  w-full
                  min-w-0
                  max-w-full
                  box-border
                  rounded-[8px]
                  border
                  px-[10px]
                  py-[8px]
                  text-[12px]
                  outline-none
                  disabled:opacity-50
                "
                style={{
                  backgroundColor:
                    palette.input,
                  borderColor:
                    palette.border,
                  color:
                    palette.primary,
                }}
              />
            </Field>
          </div>

          <label
            className="
              w-full
              min-w-0
              max-w-full
              flex
              items-center
              gap-[10px]
              text-[10px]
              cursor-pointer
            "
            style={{
              color:
                palette.secondary,
            }}
          >
            <input
              type="checkbox"
              checked={
                indefinite
              }
              onChange={(event) => {
                const checked =
                  event.target
                    .checked;

                setIndefinite(
                  checked,
                );

                if (checked) {
                  setDeliveryMode(
                    'always',
                  );
                }
              }}
            />

            <span
              className="
                min-w-0
                break-words
                [overflow-wrap:anywhere]
              "
            >
              {t('automation.validity.indefiniteLong')}
            </span>
          </label>

          <div
            className="
              w-full
              min-w-0
              max-w-full
              flex
              flex-wrap
              items-center
              gap-[10px]
            "
          >
            <ActionButton
              palette={palette}
              disabled={busy}
              onClick={() =>
                void handleSave()
              }
            >
              {t('common.actions.save')}
            </ActionButton>

            <ActionButton
              palette={palette}
              disabled={busy}
              onClick={() =>
                setEditing(false)
              }
            >
              {t('common.actions.cancel')}
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoValue({
  children,
  color,
}: {
  children: ReactNode;
  color: string;
}) {
  return (
    <span
      className="
        min-w-0
        max-w-full
        break-words
        [overflow-wrap:anywhere]
      "
      style={{
        color,
      }}
    >
      {children}
    </span>
  );
}

function ActionButton({
  children,
  palette,
  danger = false,
  disabled,
  onClick,
}: {
  children: ReactNode;
  palette: {
    button: string;
    buttonHover: string;
    primary: string;
    danger: string;
  };
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="
        h-[30px]
        max-w-full
        rounded-[8px]
        px-[10px]
        text-[11px]
        transition-colors
        disabled:opacity-50
      "
      style={{
        backgroundColor:
          palette.button,
        color:
          danger
            ? palette.danger
            : palette.primary,
      }}
      onMouseEnter={(event) => {
        if (!disabled) {
          event.currentTarget.style.backgroundColor =
            palette.buttonHover;
        }
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.backgroundColor =
          palette.button;
      }}
    >
      {children}
    </button>
  );
}

function Field({
  children,
  label,
  color,
}: {
  children: ReactNode;
  label: string;
  color: string;
}) {
  return (
    <label
      className="
        w-full
        min-w-0
        max-w-full
        flex
        flex-col
        gap-[6px]
        text-[11px]
      "
      style={{
        color,
      }}
    >
      {label}
      {children}
    </label>
  );
}

function statusView(
  status:
    AutomationSnapshot['status'],
  dark: boolean,
  t: (key: string, values?: Record<string, unknown>) => string,
): {
  label: string;
  color: string;
} {
  if (status === 'ACTIVE') {
    return {
      label: t('automation.status.ACTIVE'),
      color: dark
        ? '#6FCF97'
        : '#2E7D32',
    };
  }

  if (status === 'PAUSED') {
    return {
      label: t('automation.status.PAUSED'),
      color: dark
        ? '#F2C46D'
        : '#A66A00',
    };
  }

  if (
    status === 'COMPLETED'
  ) {
    return {
      label: t('automation.status.COMPLETED'),
      color: dark
        ? '#A8A8A8'
        : '#5F6368',
    };
  }

  return {
    label: t('automation.status.CANCELLED'),
    color: dark
      ? '#7D7D7D'
      : '#8A8A8A',
  };
}

function triggerText(
  trigger: AutomationTrigger,
  formatDate: (value: string) => string,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  if (
    trigger.kind === 'once'
  ) {
    return t('automation.frequency.once', { time: formatDate(trigger.runAt) });
  }

  return trigger.every === 1
    ? t('automation.frequency.everyOne', { unit: unitLabel(t, trigger.unit) })
    : t('automation.frequency.everyMany', { count: trigger.every, unit: unitLabel(t, trigger.unit) });
}

function completionConditionText(
  value:
    Record<string, unknown>,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  const description =
    String(
      value.description ??
        value.summary ??
        '',
    ).trim();

  return (
    description ||
    t('automation.completion.default')
  );
}

function remainingText(
  value: string,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  const ms =
    new Date(value).getTime() -
    Date.now();

  if (
    !Number.isFinite(ms) ||
    ms <= 0
  ) {
    return t('automation.remaining.soon');
  }

  const days =
    Math.ceil(
      ms / 86_400_000,
    );

  if (days >= 1) {
    return t('automation.remaining.days', { count: days });
  }

  const hours =
    Math.ceil(
      ms / 3_600_000,
    );

  return t('automation.remaining.hours', { count: Math.max(1, hours) });
}

function unitLabel(
  t: (key: string, values?: Record<string, unknown>) => string,
  unit: AutomationRepeatUnit,
): string {
  return t(`automation.unit.${unit}`);
}

function futureLocalInput(
  value?: string | null,
): string {
  if (!value) return '';

  const date =
    new Date(value);

  if (
    !Number.isFinite(
      date.getTime(),
    ) ||
    date.getTime() <= Date.now()
  ) {
    return '';
  }

  return toLocalInput(value);
}

function toLocalInput(
  value?: string | null,
): string {
  if (!value) return '';

  const date =
    new Date(value);

  if (
    !Number.isFinite(
      date.getTime(),
    )
  ) {
    return '';
  }

  const offset =
    date.getTimezoneOffset() *
    60_000;

  return new Date(
    date.getTime() - offset,
  )
    .toISOString()
    .slice(0, 16);
}

function futureIsoFromLocal(
  value: string,
): string | null {
  const iso =
    isoFromLocal(value);

  if (!iso) return null;

  return new Date(
    iso,
  ).getTime() > Date.now()
    ? iso
    : null;
}

function isoFromLocal(
  value: string,
): string | null {
  if (!value.trim()) {
    return null;
  }

  const date =
    new Date(value);

  return Number.isFinite(
    date.getTime(),
  )
    ? date.toISOString()
    : null;
}