import {
  useMemo,
} from 'react';

export interface SafeHtmlFrameProps {
  html: string;
  title: string;
  allowScripts?: boolean;
  allowForms?: boolean;
  className?: string;
}

export default function SafeHtmlFrame({
  html,
  title,
  allowScripts = false,
  allowForms = false,
  className = '',
}: SafeHtmlFrameProps) {
  const source = useMemo(
    () => withPreviewCsp(
      html,
      allowScripts,
    ),
    [
      allowScripts,
      html,
    ],
  );

  const sandbox = [
    allowScripts
      ? 'allow-scripts'
      : '',
    allowForms
      ? 'allow-forms'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <iframe
      srcDoc={source}
      title={title}
      sandbox={sandbox}
      referrerPolicy="no-referrer"
      className={className}
    />
  );
}

function withPreviewCsp(
  html: string,
  allowScripts: boolean,
): string {
  const directives = [
    "default-src 'none'",
    "img-src data: blob:",
    "style-src 'unsafe-inline'",
    allowScripts
      ? "script-src 'unsafe-inline'"
      : "script-src 'none'",
    'font-src data:',
    'media-src data: blob:',
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ];

  const meta = [
    '<meta http-equiv="Content-Security-Policy" content="',
    escapeAttribute(
      directives.join('; '),
    ),
    '">',
  ].join('');

  const source = String(html ?? '');

  if (/<head[\s>]/i.test(source)) {
    return source.replace(
      /<head([^>]*)>/i,
      `<head$1>${meta}`,
    );
  }

  return [
    '<!doctype html><html><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    meta,
    '</head><body>',
    source,
    '</body></html>',
  ].join('');
}

function escapeAttribute(
  value: string,
): string {
  return value.replace(
    /[&"<>]/g,
    (character) => ({
      '&': '&amp;',
      '"': '&quot;',
      '<': '&lt;',
      '>': '&gt;',
    })[character] ?? character,
  );
}
