export type MarkdownTheme = 'light' | 'dark';

export const markdownThemeTokens = {
  radius: {
    block: 16,
    inline: 8,
  },
  font: {
    text: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
    code: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  },
  light: {
    codeBg: '#ffffff',
    codeToolbarBg: '#f3f4f6',
    codeBorder: '#e5e7eb',
    text: '#111827',
    mutedText: '#4b5563',
    blockBg: '#ffffff',
    blockSubtleBg: '#f9fafb',
    errorBg: '#fef2f2',
    errorBorder: '#fecaca',
    errorText: '#991b1b',
    loadingBg: '#f3f4f6',
    headingBorder: '#e5e7eb',
    quoteBorder: '#d1d5db',
    quoteText: '#4b5563',
    linkText: '#2563eb',
    inlineCodeBg: '#efefef',
    inlineCodeBorder: '#e5e7eb',
    tableBorder: '#d6d6d6',
    tableHeaderBg: '#f3f3f3',
    imageBorder: '#e5e7eb',
  },
  dark: {
    codeBg: '#1e1e1e',
    codeToolbarBg: '#252526',
    codeBorder: '#2f2f2f',
    text: '#f3f4f6',
    mutedText: '#d4d4d4',
    blockBg: '#1e1e1e',
    blockSubtleBg: '#252526',
    errorBg: '#2a1515',
    errorBorder: '#5f2a2a',
    errorText: '#fecaca',
    loadingBg: '#2f2f2f',
    headingBorder: '#343434',
    quoteBorder: '#505050',
    quoteText: '#bdbdbd',
    linkText: '#6ea8ff',
    inlineCodeBg: '#282828',
    inlineCodeBorder: '#3a3a3a',
    tableBorder: '#3b3b3b',
    tableHeaderBg: '#292929',
    imageBorder: '#3a3a3a',
  },
} as const;

export const getMarkdownThemePalette = (theme: MarkdownTheme) =>
  markdownThemeTokens[theme];
