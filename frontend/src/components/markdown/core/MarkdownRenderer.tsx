import { memo, type CSSProperties } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { PluggableList } from 'unified';

interface MarkdownRendererProps {
  content: string;
  remarkPlugins: PluggableList;
  rehypePlugins: PluggableList;
  components: Components;
  className?: string;
  style?: CSSProperties;
  urlTransform?: (url: string, key: string, node: unknown) => string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  remarkPlugins,
  rehypePlugins,
  components,
  className,
  style,
  urlTransform,
}: MarkdownRendererProps) {
  return (
    <div className={className} style={style}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        skipHtml
        components={components}
        urlTransform={urlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
