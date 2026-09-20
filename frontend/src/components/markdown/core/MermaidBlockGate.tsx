import { ReactNode, useEffect, useRef, useState } from 'react';
import { useLocalize } from '../../../localization/useLocalize';
import type { MarkdownTheme } from '../model/markdown.types';
import { MarkdownLoadingBlock } from './MarkdownLoadingBlock';

interface MermaidBlockGateProps {
  phase: 'stream' | 'final';
  theme: MarkdownTheme;
  children: ReactNode;
  minHeight?: number;
}

export function MermaidBlockGate({
  phase,
  theme,
  children,
  minHeight = 180,
}: MermaidBlockGateProps) {
  const localize = useLocalize();
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (phase === 'stream') {
      setReady(false);
      return;
    }

    const node = hostRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      const timer = window.setTimeout(() => setReady(true), 0);
      return () => window.clearTimeout(timer);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [phase]);

  if (phase === 'stream') {
    return (
      <MarkdownLoadingBlock
        theme={theme}
        title={localize('markdown.mermaid.pending')}
        minHeight={minHeight}
      />
    );
  }

  return (
    <div ref={hostRef}>
      {ready ? (
        children
      ) : (
        <MarkdownLoadingBlock
          theme={theme}
          title={localize('markdown.mermaid.pending')}
          minHeight={minHeight}
        />
      )}
    </div>
  );
}
