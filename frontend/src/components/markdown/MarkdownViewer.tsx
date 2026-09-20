import { useMemo } from 'react';
import { createMarkdownComponents } from './core/createMarkdownComponents';
import { MarkdownErrorBlock } from './core/MarkdownErrorBlock';
import { MarkdownErrorBoundary } from './core/MarkdownErrorBoundary';
import { markdownUrlTransform } from './core/MarkdownLinkPolicy';
import { MarkdownRenderer } from './core/MarkdownRenderer';
import type { MarkdownViewerProps } from './model/markdown.types';
import { createMarkdownPipeline } from './pipeline/MarkdownPipeline';

const MarkdownViewer = ({
  content,
  theme,
  style,
  partialRender = false,
  onLink,
}: MarkdownViewerProps) => {
  const phase = partialRender ? 'stream' : 'final';

  const pipeline = useMemo(
    () => createMarkdownPipeline(content, phase),
    [content, phase],
  );

  const components = useMemo(
    () => createMarkdownComponents({ theme, phase, onLink }),
    [onLink, phase, theme],
  );

  return (
    <MarkdownErrorBoundary
      componentName="MarkdownViewer"
      fallback={(
        <MarkdownErrorBlock
          theme={theme}
          source={content}
          compact
        />
      )}
    >
      <MarkdownRenderer
        content={pipeline.content}
        components={components}
        remarkPlugins={pipeline.remarkPlugins}
        rehypePlugins={pipeline.rehypePlugins}
        className={`markdown-container ${theme}-theme w-full min-w-0 max-w-full break-words`}
        style={style}
        urlTransform={markdownUrlTransform}
      />
    </MarkdownErrorBoundary>
  );
};

export default MarkdownViewer;
