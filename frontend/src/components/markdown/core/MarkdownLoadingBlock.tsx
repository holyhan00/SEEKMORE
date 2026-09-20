import { useLocalize } from '../../../localization/useLocalize';
import {
  getMarkdownThemePalette,
  markdownThemeTokens,
  type MarkdownTheme,
} from '../theme/markdownThemeTokens';

interface MarkdownLoadingBlockProps {
  theme?: MarkdownTheme;
  title?: string;
  minHeight?: number;
}

export function MarkdownLoadingBlock({
  theme = 'light',
  title,
  minHeight = 120,
}: MarkdownLoadingBlockProps) {
  const localize = useLocalize();
  const palette = getMarkdownThemePalette(theme);

  return (
    <div
      className="my-4 overflow-hidden border"
      style={{
        backgroundColor: palette.blockBg,
        borderColor: palette.codeBorder,
        borderRadius: markdownThemeTokens.radius.block,
        color: palette.mutedText,
        fontFamily: markdownThemeTokens.font.text,
        minHeight,
      }}
      role="status"
      aria-live="polite"
    >
      <div
        className="flex items-center justify-between px-4 py-2 text-xs"
        style={{ backgroundColor: palette.codeToolbarBg }}
      >
        <span>{title ?? localize('markdown.loading')}</span>
        <span className="opacity-70">{localize('common.status.pending')}</span>
      </div>
      <div className="space-y-3 p-4">
        <div
          className="h-3 w-2/3 animate-pulse rounded"
          style={{ backgroundColor: palette.loadingBg }}
        />
        <div
          className="h-3 w-full animate-pulse rounded"
          style={{ backgroundColor: palette.loadingBg }}
        />
        <div
          className="h-3 w-1/2 animate-pulse rounded"
          style={{ backgroundColor: palette.loadingBg }}
        />
      </div>
    </div>
  );
}
