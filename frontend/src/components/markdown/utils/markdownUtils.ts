type OpenFence = {
  marker: '`' | '~';
  length: number;
};

const FENCE_START = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

function getFence(line: string): { marker: '`' | '~'; length: number } | null {
  const match = FENCE_START.exec(line);
  if (!match) return null;

  const fence = match[1];
  return {
    marker: fence[0] as '`' | '~',
    length: fence.length,
  };
}

function closesFence(line: string, openFence: OpenFence): boolean {
  const marker = openFence.marker === '`' ? '`' : '~';
  return new RegExp(`^ {0,3}${marker}{${openFence.length},}\\s*$`).test(line);
}


/**
 * Makes an in-flight Markdown chunk structurally renderable without mutating
 * the final content. Only incomplete fenced code blocks are completed here;
 * normal Markdown remains untouched and the synthetic closer disappears on the
 * next render as soon as the model emits the real one.
 */
export const autoCompleteMarkdown = (content: string): string => {
  const source = String(content || '');
  if (!source) return source;

  const lines = source.split('\n');
  let openFence: OpenFence | null = null;

  for (const line of lines) {
    if (openFence) {
      if (closesFence(line, openFence)) {
        openFence = null;
      }
      continue;
    }

    const fence = getFence(line);
    if (fence) openFence = fence;
  }

  if (!openFence) return source;
  return `${source}\n${openFence.marker.repeat(openFence.length)}`;
};
