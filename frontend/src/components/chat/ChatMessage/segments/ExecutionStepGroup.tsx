import { useAppearance } from '../../../../theme/useAppearance';
                                                                           

import { memo, type CSSProperties } from 'react';

import MarkdownViewer from '../../../markdown/MarkdownViewer';
import type { AssistantExecutionGroup } from './runtime-display.types';
import ReasoningSummaryStream from './ReasoningSummaryStream';
import RuntimeActivityRow from './RuntimeActivityRow';

const COMMENTARY_MARKDOWN_STYLE: CSSProperties = {
  color: 'inherit',
  fontSize: '9px',
  lineHeight: '18px',
};

function ExecutionStepGroup({
  group,
    onLink,
}: {
  group: AssistantExecutionGroup;

  onLink?: (href: string) => boolean;
}) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  return (
    <section
      className={`w-full min-w-0 max-w-full select-text border-b last:border-b-0 ${
        'border-[#e7e7e7] dark:border-[#242424]'
      }`}
    >
      <div className="w-full min-w-0 max-w-full py-[5px]">
        {group.commentary.map((segment) => {
          const content =
            segment.markdown.trim();

          if (!content) {
            return null;
          }

          return (
            <div
              key={segment.segmentId}
              className="py-[2px] text-[9px] leading-[18px] opacity-75 [&_p]:my-0 [&_li]:text-[9px] [&_code]:text-[9px]"
            >
              <MarkdownViewer
                content={content}
                theme={
                  isDarkTheme
                    ? 'dark'
                    : 'light'
                }
                partialRender={
                  !segment.final
                }
                onLink={onLink}
                style={COMMENTARY_MARKDOWN_STYLE}
              />
            </div>
          );
        })}

        {group.reasoning.map(
          (summary) => (
            <ReasoningSummaryStream
              key={summary.summaryId}
              summary={summary}

              onLink={onLink}
            />
          ),
        )}

        {group.activities.map(
          (activity) => (
            <RuntimeActivityRow
              key={activity.activityId}
              activity={activity}

            />
          ),
        )}
      </div>
    </section>
  );
}

export default memo(
  ExecutionStepGroup,
  (previous, next) =>
    previous.group === next.group
    && previous.onLink === next.onLink,
);