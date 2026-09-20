import { useAppearance } from '../../../../theme/useAppearance';
                                                                               

import { memo, type CSSProperties } from 'react';

import MarkdownViewer from '../../../markdown/MarkdownViewer';
import type { RuntimeReasoningSummary } from '../../runtime/events/runtime-events.types';

const REASONING_CONTAINER_STYLE: CSSProperties = {
  fontSize: '9px',
  lineHeight: '18px',
};

const REASONING_MARKDOWN_STYLE: CSSProperties = {
  color: 'inherit',
  fontSize: '9px',
  lineHeight: '18px',
};

function ReasoningSummaryStream({
  summary,
    onLink,
}: {
  summary: RuntimeReasoningSummary;

  onLink?: (href: string) => boolean;
}) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  return (
    <div
      className="
        px-3
        py-0
        text-neutral-600
        dark:text-neutral-300
        [&_p]:my-0
        [&_p]:text-[9px]
        [&_li]:text-[9px]
        [&_h1]:my-0
        [&_h1]:text-[9px]
        [&_h2]:my-0
        [&_h2]:text-[9px]
        [&_h3]:my-0
        [&_h3]:text-[9px]
        [&_code]:text-[9px]
      "
      style={REASONING_CONTAINER_STYLE}
    >
      <MarkdownViewer
        content={summary.markdown.trim()}
        theme={isDarkTheme ? 'dark' : 'light'}
        partialRender={summary.status === 'streaming'}
        onLink={onLink}
        style={REASONING_MARKDOWN_STYLE}
      />
    </div>
  );
}

export default memo(
  ReasoningSummaryStream,
  (previous, next) =>
    previous.summary === next.summary
    && previous.onLink === next.onLink,
);