// frontend/src/components/chat/ChatMessage/segments/cards/ClarificationCard.tsx

import {
  memo,
  useEffect,
  useState,
} from 'react';

import type {
  RuntimeActivity,
} from '../../../runtime/events/runtime-events.types';

import MarkdownViewer
  from '../../../../markdown/MarkdownViewer';

import {
  useAppearance,
} from '../../../../../theme/useAppearance';

import {
  useLocalize,
} from '../../../../../localization/useLocalize';

type Props = {
  activity: RuntimeActivity;
};

const EXIT_DURATION_MS = 180;

function ClarificationCard({
  activity,
}: Props) {
  const t = useLocalize();

  const {
    resolvedTheme,
  } = useAppearance();

  const detail =
    activity.detail ?? {};

  const question = String(
    detail.question
      ?? activity.summary
      ?? activity.title,
  ).trim();

  const options =
    Array.isArray(detail.options)
      ? detail.options
          .map((item) =>
            String(item ?? '').trim(),
          )
          .filter(Boolean)
          .slice(0, 8)
      : [];

  const waiting =
    activity.status === 'waiting';

  const [
    mounted,
    setMounted,
  ] = useState(waiting);

  const [
    visible,
    setVisible,
  ] = useState(waiting);

  useEffect(() => {
    if (waiting) {
      setMounted(true);

      const frame =
        window.requestAnimationFrame(
          () => {
            setVisible(true);
          },
        );

      return () => {
        window.cancelAnimationFrame(
          frame,
        );
      };
    }

    setVisible(false);

    const timer =
      window.setTimeout(
        () => {
          setMounted(false);
        },
        EXIT_DURATION_MS,
      );

    return () => {
      window.clearTimeout(timer);
    };
  }, [waiting]);

  const choose = (
    text: string,
  ) => {
    window.dispatchEvent(
      new CustomEvent(
        'chat:prefill',
        {
          detail: {
            text,
          },
        },
      ),
    );
  };

  if (
    !mounted
    || !question
  ) {
    return null;
  }

  const markdownTheme =
    resolvedTheme === 'dark'
      ? 'dark'
      : 'light';

  return (
    <section
      data-activity-id={
        activity.activityId
      }
      className={[
        'my-2',
        'overflow-hidden',
        'rounded-[14px]',
        'border',
        'border-edge-alpha-06',
        'bg-surface-raised',
        'select-text',
        'transition-[opacity,transform]',
        'duration-200',
        'ease-out',
        visible
          ? 'translate-y-0 opacity-100'
          : '-translate-y-1 pointer-events-none opacity-0',
      ].join(' ')}
    >
 {/* Clarification label */}
<div
  className="
    ml-4
    mt-4
    flex
    w-fit
    select-text
    items-center
    gap-2.5
    rounded-full
    bg-[#ededed]
    px-3
    py-2
    text-[12px]
    font-normal
    leading-5
    text-[#0863f4]

    dark:bg-[#2b2b2b]
    dark:text-[#0863f4]
  "
>
  <span
    aria-hidden="true"
    className="
      size-[18px]
      shrink-0
      rounded-full
      border-[2px]
      border-[#0863f4]
      dark:border-[#0863f4]
    "
  />

  <span>
    {t(
      'runtime.clarification.inputNeeded',
    )}
  </span>
</div>

      {/* Clarification content */}
      <div
        className="
          select-text
          px-5
          py-5
        "
      >
        <div
          className="
            select-text
            text-[12px]
            leading-6
            text-theme-body
          "
        >
          <MarkdownViewer
            content={question}
            theme={markdownTheme}
            partialRender={false}
            style={{
              color: 'inherit',
              fontSize: 'inherit',
              lineHeight: 'inherit',
              userSelect: 'text',
              WebkitUserSelect: 'text',
            }}
          />
        </div>

        {options.length > 0 && (
          <div
            className="
              mt-3
              flex
              flex-wrap
              gap-2
            "
          >
            {options.map(
              (option) => (
                <button
                  type="button"
                  key={option}
                  onClick={() =>
                    choose(option)
                  }
                  className="
                    select-none
                    rounded-[9px]
                    border
                    border-edge-alpha-06
                    bg-surface-button-soft
                    px-3
                    py-1.5
                    text-xs
                    text-theme-secondary
                    transition-colors
                    hover:bg-surface-button-hover
                  "
                >
                  {option}
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default memo(
  ClarificationCard,
);