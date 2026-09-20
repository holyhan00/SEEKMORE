import { useLocalize } from '../../../../localization/useLocalize';
import { CopyButton } from '../shared/CopyButton';
import {
  getMarkdownThemePalette,
  markdownThemeTokens,
  type MarkdownTheme,
} from '../../theme/markdownThemeTokens';

interface TextBlockRendererProps {
  content: string;
  theme: MarkdownTheme;
  kind?: 'text' | 'prompt';
}

export function TextBlockRenderer({
  content,
  theme,
  kind = 'text',
}: TextBlockRendererProps) {
  const localize = useLocalize();
  const palette = getMarkdownThemePalette(theme);
  const label = kind === 'prompt'
    ? localize('markdown.textBlock.prompt')
    : localize('markdown.textBlock.text');

  return (
    <div
      className="my-[14px] w-full min-w-0 max-w-full overflow-hidden rounded-[12px] border-[0.5px]"
      style={{
        backgroundColor: palette.blockBg,
        borderColor: palette.codeBorder,
        color: palette.text,
        fontFamily: markdownThemeTokens.font.text,
      }}
    >
      <div
        className="flex min-h-[30px] items-center justify-between gap-[8px] px-[10px] py-[4px] text-[10px] font-normal"
        style={{
          backgroundColor: palette.codeToolbarBg,
          color: palette.mutedText,
        }}
      >
        <span className="truncate opacity-80">{label}</span>
        <CopyButton content={content} theme={theme} />
      </div>

      <div
        className="w-full min-w-0 max-w-full whitespace-pre-wrap break-words px-[12px] py-[10px] text-[12px] font-normal leading-[21px] [overflow-wrap:anywhere]"
        style={{
          backgroundColor: palette.blockBg,
          color: palette.text,
          fontFamily: markdownThemeTokens.font.text,
        }}
      >
        {content}
      </div>
    </div>
  );
}
