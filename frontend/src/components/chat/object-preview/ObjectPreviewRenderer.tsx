//frontend/src/components/chat/object-preview/ObjectPreviewRenderer.tsx
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import SafeHtmlFrame from '../../../common/SafeHtmlFrame';
import { useLocalize } from '../../../localization/useLocalize';
import { useAppearance } from '../../../theme/useAppearance';
import MarkdownViewer from '../../markdown/MarkdownViewer';
import {
  fetchObjectPreviewBlob,
  fetchObjectPreviewText,
} from './object-preview.client';
import type { ObjectPreviewManifest } from './object-preview.types';

export default function ObjectPreviewRenderer({
  manifest,
}: {
  manifest: ObjectPreviewManifest;
}) {
  const localize = useLocalize();
  const { resolvedTheme } = useAppearance();
  const [textContent, setTextContent] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const preview = manifest.preview;

  useEffect(() => {
    setTextContent(null);
    setBlobUrl(null);
    setError(false);

    if (!preview.available || !preview.url) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);

    const textMode =
      preview.kind === 'text'
      || preview.kind === 'markdown'
      || preview.kind === 'spreadsheet'
      || preview.kind === 'html'
      || preview.kind === 'document';

    const load = async () => {
      try {
        if (textMode) {
          const text = await fetchObjectPreviewText(preview.url!);
          if (!cancelled) {
            setTextContent(text);
          }
          return;
        }

        const blob = await fetchObjectPreviewBlob(preview.url!);
        const nextObjectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }
        objectUrl = nextObjectUrl;
        setBlobUrl(nextObjectUrl);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    preview.available,
    preview.kind,
    preview.url,
  ]);

  if (!preview.available) {
    return (
      <PreviewMessage>
        {localize('object.preview.unavailable')}
      </PreviewMessage>
    );
  }

  if (loading) {
    return (
      <PreviewMessage>
        {localize('object.preview.loading')}
      </PreviewMessage>
    );
  }

  if (error) {
    return (
      <PreviewMessage>
        {localize('object.preview.failed')}
      </PreviewMessage>
    );
  }

  if (preview.kind === 'markdown') {
    return (
      <div className="h-full overflow-auto px-6 py-5 select-text">
        <MarkdownViewer
          content={textContent ?? ''}
          theme={resolvedTheme}
        />
      </div>
    );
  }

  if (preview.kind === 'spreadsheet') {
    return (
      <SpreadsheetPreview
        content={textContent ?? ''}
        mimeType={preview.mimeType ?? manifest.mimeType}
      />
    );
  }

  if (preview.kind === 'text') {
    return (
      <TextPreview
        content={formatTextContent(
          textContent ?? '',
          manifest,
        )}
      />
    );
  }

  if (preview.kind === 'image' && blobUrl) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-5">
        <img
          src={blobUrl}
          alt={manifest.displayName}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  if (preview.kind === 'audio' && blobUrl) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <audio
          src={blobUrl}
          controls
          className="w-full max-w-[520px]"
        />
      </div>
    );
  }

  if (preview.kind === 'video' && blobUrl) {
    return (
      <div className="flex h-full items-center justify-center overflow-hidden bg-[#000000] p-3">
        <video
          src={blobUrl}
          controls
          className="max-h-full max-w-full"
        />
      </div>
    );
  }

  if (preview.kind === 'presentation' && blobUrl) {
    return (
      <iframe
        src={blobUrl}
        title={manifest.displayName}
        sandbox=""
        referrerPolicy="no-referrer"
        className="h-full w-full border-0 bg-[#ffffff]"
      />
    );
  }

  if (
    preview.kind === 'html'
    || preview.kind === 'document'
  ) {
    return (
      <SafeHtmlFrame
        html={textContent ?? ''}
        title={manifest.displayName}
        allowScripts={preview.kind === 'html'}
        allowForms={preview.kind === 'html'}
        className="h-full w-full border-0 bg-[#ffffff]"
      />
    );
  }

  if (preview.kind === 'pdf' && blobUrl) {
    return (
      <iframe
        src={blobUrl}
        title={manifest.displayName}
        referrerPolicy="no-referrer"
        className="h-full w-full border-0 bg-[#ffffff]"
      />
    );
  }

  return (
    <PreviewMessage>
      {localize('object.preview.unavailable')}
    </PreviewMessage>
  );
}

function PreviewMessage({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-xs opacity-45">
      {children}
    </div>
  );
}

function TextPreview({
  content,
}: {
  content: string;
}) {
  return (
    <div className="h-full overflow-auto p-5">
      <pre className="m-0 whitespace-pre-wrap break-words select-text font-mono text-[12px] leading-[20px] text-[#202124] dark:text-[#d8d8d8]">
        {content}
      </pre>
    </div>
  );
}

type SpreadsheetSheet = {
  name: string;
  rows: string[][];
};

function SpreadsheetPreview({
  content,
  mimeType,
}: {
  content: string;
  mimeType: string;
}) {
  const localize = useLocalize();
  const sheets = useMemo(
    () => parseSpreadsheetPreview(content, mimeType),
    [content, mimeType],
  );
  const [activeSheet, setActiveSheet] = useState(0);

  useEffect(() => {
    setActiveSheet(0);
  }, [content]);

  const sheet = sheets[activeSheet] ?? sheets[0];

  if (!sheet) {
    return (
      <PreviewMessage>
        {localize('object.preview.empty')}
      </PreviewMessage>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {sheets.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#000000]/[0.06] px-3 py-2 dark:border-[#ffffff]/[0.06]">
          {sheets.map((item, index) => (
            <button
              key={`${item.name}:${index}`}
              type="button"
              onClick={() => setActiveSheet(index)}
              className={[
                'shrink-0 rounded-md px-2 py-1 text-[10px] transition-colors',
                index === activeSheet
                  ? 'bg-[#000000]/[0.07] dark:bg-[#ffffff]/[0.10]'
                  : 'opacity-55 hover:opacity-100',
              ].join(' ')}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-[#ffffff] dark:bg-[#171717]">
        <table className="min-w-full border-collapse text-[11px] select-text">
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="sticky left-0 z-10 min-w-[42px] border border-[#000000]/[0.08] bg-[#f4f4f4] px-2 py-1 text-right font-normal opacity-60 dark:border-[#ffffff]/[0.08] dark:bg-[#222222]">
                  {rowIndex + 1}
                </th>
                {row.map((cell, columnIndex) => (
                  <td
                    key={columnIndex}
                    className="min-w-[90px] max-w-[260px] border border-[#000000]/[0.08] px-2 py-1 align-top dark:border-[#ffffff]/[0.08]"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseSpreadsheetPreview(
  content: string,
  mimeType: string,
): SpreadsheetSheet[] {
  if (
    mimeType.includes('json')
    || content.trim().startsWith('{')
  ) {
    try {
      const parsed = JSON.parse(content) as {
        sheets?: Array<{
          name?: string;
          rows?: unknown[][];
        }>;
      };

      const sheets = Array.isArray(parsed.sheets)
        ? parsed.sheets.map((sheet, index) => ({
            name: String(sheet.name ?? `Sheet ${index + 1}`),
            rows: Array.isArray(sheet.rows)
              ? sheet.rows.map((row) =>
                  Array.isArray(row)
                    ? row.map((cell) => String(cell ?? ''))
                    : [],
                )
              : [],
          }))
        : [];

      if (sheets.length) return sheets;
    } catch {
      // Fall through to CSV/text parsing.
    }
  }

  return [{
    name: 'Sheet 1',
    rows: parseCsv(content),
  }];
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];

    if (character === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && character === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length >= 500) break;
      continue;
    }

    cell += character;
  }

  if (row.length || cell) {
    row.push(cell);
    rows.push(row);
  }

  return rows.map((item) => item.slice(0, 100));
}

function formatTextContent(
  content: string,
  manifest: ObjectPreviewManifest,
): string {
  const extension = String(manifest.extension ?? '').toLowerCase();
  const mimeType = String(manifest.mimeType ?? '').toLowerCase();
  if (extension !== 'json' && !mimeType.includes('json')) return content;

  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}
