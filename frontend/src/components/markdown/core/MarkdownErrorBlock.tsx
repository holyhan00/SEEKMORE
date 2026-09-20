import { useLocalize } from '../../../localization/useLocalize';
import type { CSSProperties } from 'react';
import {
  getMarkdownThemePalette,
  markdownThemeTokens,
  type MarkdownTheme,
} from '../theme/markdownThemeTokens';

interface MarkdownErrorBlockProps {
  theme?: MarkdownTheme;
  title?: string;
  message?: string;
  source?: string;
  compact?: boolean;
}

export function MarkdownErrorBlock({
  theme = 'light',
  title,
  message,
  source,
  compact = false,
}: MarkdownErrorBlockProps) {
  const localize = useLocalize();
  const palette = getMarkdownThemePalette(theme);
  const wrapperStyle: CSSProperties = {
    backgroundColor: palette.errorBg,
    borderColor: palette.errorBorder,
    borderRadius: markdownThemeTokens.radius.block,
    color: palette.errorText,
    fontFamily: markdownThemeTokens.font.text,
  };

  return (
    <div
      className={`my-4 overflow-hidden border ${compact ? 'p-3' : 'p-4'}`}
      style={wrapperStyle}
      role="status"
    >
      <div className="text-sm font-semibold">{title ?? localize('markdown.error.defaultTitle')}</div>
      {(message ?? localize('markdown.error.defaultMessage')) ? <div className="mt-1 text-xs leading-5 opacity-90">{message ?? localize('markdown.error.defaultMessage')}</div> : null}
      {source ? (
        <pre
          className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs"
          style={{
            backgroundColor: palette.blockSubtleBg,
            borderRadius: markdownThemeTokens.radius.inline,
            color: palette.text,
            fontFamily: markdownThemeTokens.font.code,
            padding: '0.75rem',
          }}
        >
          {source}
        </pre>
      ) : null}
    </div>
  );
}
