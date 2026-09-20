import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import mermaid, { type MermaidConfig } from 'mermaid';
import { useLocalize } from '../../../localization/useLocalize';
import { MarkdownErrorBlock } from '../core/MarkdownErrorBlock';
import { CopyButton } from './shared/CopyButton';
import type { MarkdownTheme } from '../model/markdown.types';
import {
  getMarkdownThemePalette,
  markdownThemeTokens,
} from '../theme/markdownThemeTokens';

interface MermaidRendererProps {
  code: string;
  theme: MarkdownTheme;
  maxHeight?: number;
}

function mermaidTheme(theme: MarkdownTheme): MermaidConfig['theme'] {
  return theme === 'dark' ? 'dark' : 'default';
}

function hash(value: string): string {
  let result = 0;

  for (let index = 0; index < value.length; index += 1) {
    result = (result << 5) - result + value.charCodeAt(index);
    result |= 0;
  }

  return `mmd_${Math.abs(result)}`;
}

function withDefaultHorizontalFlowchart(code: string): string {
  const source = String(code || '');
  const isFlowchart = /^\s*(?:flowchart|graph)\b/i.test(source);

  if (!isFlowchart) return source;

  const hasDirection = /\b(?:flowchart|graph)\s+(TD|TB|LR|BT|RL)\b/i.test(source);
  if (hasDirection) return source;

  return source.replace(
    /^\s*(flowchart|graph)\b/i,
    '$1 LR',
  );
}

function MermaidRenderer({
  code,
  theme,
  maxHeight = 300,
}: MermaidRendererProps) {
  const localize = useLocalize();
  const palette = getMarkdownThemePalette(theme);
  const [svgMarkup, setSvgMarkup] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const source = useMemo(
    () => withDefaultHorizontalFlowchart(code),
    [code],
  );

  const renderId = useMemo(
    () => hash(`${source}::${theme}`),
    [source, theme],
  );

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: mermaidTheme(theme),
      flowchart: {
        curve: 'basis',
        useMaxWidth: false,
        htmlLabels: false,
      },
      sequence: {
        showSequenceNumbers: true,
      },
      gantt: {
        axisFormat: '%Y-%m-%d',
      },
    });
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    setSvgMarkup('');
    setErrorMessage('');

    void (async () => {
      try {
        const { svg } = await mermaid.render(renderId, source);
        if (cancelled) return;

        setSvgMarkup(DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
        }));
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : localize('markdown.mermaid.renderFailed'),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [localize, renderId, source]);

  if (errorMessage) {
    return (
      <MarkdownErrorBlock
        theme={theme}
        title={localize('markdown.mermaid.renderFailed')}
        message={errorMessage}
        source={code}
      />
    );
  }

  return (
    <div
      className="my-4 overflow-hidden border-[0.5px]"
      style={{
        backgroundColor: palette.blockBg,
        borderColor: palette.codeBorder,
        borderRadius: markdownThemeTokens.radius.block,
        color: palette.text,
        fontFamily: markdownThemeTokens.font.text,
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-2 text-xs"
        style={{ backgroundColor: palette.codeToolbarBg, color: palette.mutedText }}
      >
        <span>Mermaid</span>
        <div className="flex shrink-0 items-center gap-[8px]">
          <span className="opacity-70">{svgMarkup ? 'ready' : 'rendering'}</span>
          <CopyButton content={code} theme={theme} />
        </div>
      </div>
      <div className="overflow-auto p-4" style={{ maxHeight }}>
        {svgMarkup ? (
          <div
            className="mermaid text-sm [&_svg]:h-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        ) : (
          <div className="space-y-3 py-3">
            <div
              className="h-4 w-2/3 animate-pulse rounded"
              style={{ backgroundColor: palette.loadingBg }}
            />
            <div
              className="h-4 w-full animate-pulse rounded"
              style={{ backgroundColor: palette.loadingBg }}
            />
            <div
              className="h-4 w-1/2 animate-pulse rounded"
              style={{ backgroundColor: palette.loadingBg }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default MermaidRenderer;
