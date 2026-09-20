export function extractMarkdownCodeLanguage(className?: string): string {
  const match = /(?:^|\s)language-([^\s]+)/i.exec(String(className || ''));
  return match?.[1] || '';
}

const markdownCodeLanguageAliases: Readonly<Record<string, string>> = Object.freeze({
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  'c++': 'cpp',
  'c#': 'csharp',
});

export function normalizeMarkdownCodeLanguage(value?: string): string {
  const normalized = String(value || '')
    .replace(/^language-/i, '')
    .trim()
    .toLowerCase();

  return markdownCodeLanguageAliases[normalized] || normalized;
}
