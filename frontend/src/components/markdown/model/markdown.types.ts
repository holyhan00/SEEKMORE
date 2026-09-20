import type { CSSProperties } from 'react';
import type { MarkdownTheme } from '../theme/markdownThemeTokens';

export type { MarkdownTheme };
export type MarkdownRenderPhase = 'stream' | 'final';

export interface MarkdownViewerProps {
  content: string;
  theme: MarkdownTheme;
  style?: CSSProperties;
  partialRender?: boolean;
  onLink?: (href: string) => void | boolean;
}
