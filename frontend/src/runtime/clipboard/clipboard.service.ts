import { getDesktopRuntimeSnapshot } from '../desktop/desktop-runtime.store';
import type { ClipboardCopyResult } from './clipboard.types';

const MAX_TEXT_LENGTH = 5_000_000;

export async function copyText(value: string): Promise<ClipboardCopyResult> {
  const text = String(value ?? '');
  if (!text) return { ok: false, errorCode: 'EMPTY_TEXT' };
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, errorCode: 'TEXT_TOO_LARGE' };
  }

  const runtime = getDesktopRuntimeSnapshot();
  const webClipboard =
    typeof navigator !== 'undefined'
      ? navigator.clipboard
      : undefined;
  if (
    runtime.isDesktop
    && runtime.bridgeReady
    && runtime.capabilities.clipboardWrite
    && window.seekmoreDesktop?.clipboard?.writeText
  ) {
    try {
      const result = await window.seekmoreDesktop.clipboard.writeText(text);
      if (result.ok) return { ok: true, method: 'desktop' };
    } catch (error) {
      console.error('[Clipboard] Desktop write failed', error);
    }
  }

  if (webClipboard) {
    try {
      await webClipboard.writeText(text);
      return { ok: true, method: 'web' };
    } catch (error) {
      console.warn('[Clipboard] Web clipboard write failed', error);
    }
  }

  try {
    if (legacyCopy(text)) return { ok: true, method: 'legacy' };
  } catch (error) {
    console.error('[Clipboard] Legacy copy failed', error);
  }

  return {
    ok: false,
    errorCode:
      runtime.isDesktop
        ? 'DESKTOP_WRITE_FAILED'
        : webClipboard
          ? 'WEB_WRITE_FAILED'
          : 'LEGACY_WRITE_FAILED',
  };
}

function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}
