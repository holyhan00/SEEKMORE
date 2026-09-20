const SAFE_LINK_PROTOCOLS = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
  'ftp:',
]);

const SAFE_IMAGE_PROTOCOLS = new Set([
  'http:',
  'https:',
]);

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function normalizeMarkdownHref(href: string): string | null {
  const value = String(href || '').trim();
  if (!value) return null;

  if (
    value.startsWith('#cite:')
    || value.startsWith('cite:')
    || value.startsWith('#')
    || value.startsWith('/')
    || value.startsWith('./')
    || value.startsWith('../')
  ) {
    return value;
  }

  if (!HAS_SCHEME.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    return SAFE_LINK_PROTOCOLS.has(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

export function markdownUrlTransform(
  url: string,
  key = 'href',
): string {
  const value = String(url || '').trim();
  if (!value) return '';

  if (key === 'src') {
    if (
      value.startsWith('/')
      || value.startsWith('./')
      || value.startsWith('../')
      || !HAS_SCHEME.test(value)
    ) {
      return value;
    }

    try {
      const parsed = new URL(value);
      return SAFE_IMAGE_PROTOCOLS.has(parsed.protocol) ? value : '';
    } catch {
      return '';
    }
  }

  return normalizeMarkdownHref(value) || '';
}

export function isExternalMarkdownHref(href: string): boolean {
  if (!href || !HAS_SCHEME.test(href)) return false;

  try {
    const url = new URL(href);
    return SAFE_LINK_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function openAnchor(href: string): boolean {
  if (!href.startsWith('#') || href.startsWith('#cite:')) return false;

  const id = href.slice(1);
  if (!id) return false;

  const target = document.getElementById(id);
  if (!target) return false;

  target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  return true;
}

export async function openMarkdownHref(href: string): Promise<void> {
  if (!href) return;

  if (typeof document !== 'undefined' && openAnchor(href)) {
    return;
  }

  const desktopOpen = window.seekmoreDesktop?.web?.openExternal;

  if (desktopOpen && isExternalMarkdownHref(href)) {
    try {
      const result = await desktopOpen(href);
      if (result.opened) return;
    } catch (error) {
      console.warn('[Markdown] desktop open failed:', error);
    }
  }

  try {
    const opened = window.open(
      href,
      '_blank',
      'noopener,noreferrer',
    );

    if (!opened) {
      console.warn('[Markdown] popup blocked:', href);
    }
  } catch (error) {
    console.warn('[Markdown] open failed:', error);
  }
}
