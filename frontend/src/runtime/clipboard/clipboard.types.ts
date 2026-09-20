export type ClipboardCopyMethod = 'desktop' | 'web' | 'legacy';

export type ClipboardCopyResult = {
  ok: boolean;
  method?: ClipboardCopyMethod;
  errorCode?:
    | 'EMPTY_TEXT'
    | 'TEXT_TOO_LARGE'
    | 'DESKTOP_WRITE_FAILED'
    | 'WEB_WRITE_FAILED'
    | 'LEGACY_WRITE_FAILED';
};
