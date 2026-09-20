import type { DocxBlock, DocxTextRunSpec, DocxTheme } from '../document/docx/docx-render.types';
import type { XlsxWorkbookRuntime } from '../spreadsheet/xlsx/xlsx-runtime.types';
import type { RenderArtifactPreview } from '../render.types';

export function buildDocumentPreview(input: {
  title?: string;
  blocks: DocxBlock[];
  theme: DocxTheme;
}): RenderArtifactPreview {
  const title = input.title || 'Document';
  const body = input.blocks
    .map((block) => documentBlockHtml(block, input.theme))
    .join('\n');
  const fontFamily = escapeCssText(
    input.theme.fontFamily || 'Arial',
  );
  const textColor = normalizeColor(
    input.theme.textColor,
    '#202124',
  );
  const primaryColor = normalizeColor(
    input.theme.primaryColor,
    '#202124',
  );
  const defaultFontSize = positiveCssNumber(
    input.theme.defaultParagraph?.fontSizePt,
    11,
  );
  const lineHeight = lineHeightValue(
    input.theme.defaultParagraph?.lineSpacingTwips,
    1.6,
  );
  const pageWidth =
    input.theme.orientation === 'landscape'
      ? '1120px'
      : '820px';

  return htmlPreview(
    'document',
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
      *{box-sizing:border-box}html,body{margin:0;background:#ececec;color:${textColor};font-family:${fontFamily},sans-serif}body{padding:28px}
      .page{width:min(${pageWidth},100%);min-height:1080px;margin:0 auto;background:#fff;padding:64px 72px;box-shadow:0 8px 30px rgba(0,0,0,.08)}
      h1,h2,h3,h4,h5,h6{color:${primaryColor};margin:1.2em 0 .5em;line-height:1.25}h1{font-size:28px;margin-top:0}h2{font-size:22px}h3{font-size:18px}h4{font-size:16px}h5{font-size:14px}h6{font-size:13px}
      p{font-size:${defaultFontSize}pt;line-height:${lineHeight};margin:0 0 14px;white-space:pre-wrap}blockquote{margin:18px 0;padding:8px 16px;border-left:3px solid #d1d5db;color:#4b5563;background:#f9fafb;white-space:pre-wrap}
      ul,ol{padding-left:24px;line-height:${lineHeight}}table{width:100%;border-collapse:collapse;margin:18px 0;font-size:13px}th,td{border:1px solid #d9dde3;padding:8px 10px;text-align:left;vertical-align:top}th{background:#f5f6f8;font-weight:600}
      img{max-width:100%;height:auto;display:block}.image{margin:20px 0}.caption{font-size:11px;color:#6b7280;margin-top:6px;text-align:center}.line{border:0;border-top:1px solid #d9dde3;margin:20px 0}.page-break{border-top:1px dashed #c5c9d0;margin:32px 0}.spacer{height:18px}
    </style></head><body><main class="page">${body || '<p></p>'}</main></body></html>`,
  );
}

export function buildSpreadsheetPreview(
  runtime: XlsxWorkbookRuntime,
): RenderArtifactPreview {
  const sheets = runtime.sheets.map((sheet) => ({
    name: sheet.name,
    rows: spreadsheetRows(sheet.blocks),
  }));

  const payload = {
    schemaVersion: 1,
    title: runtime.title,
    subtitle: runtime.subtitle ?? null,
    sheets,
  };

  return {
    kind: 'spreadsheet',
    mimeType: 'application/json',
    extension: 'json',
    buffer: Buffer.from(JSON.stringify(payload), 'utf8'),
  };
}

export function buildPresentationRasterPreview(input: {
  title?: string;
  slides: Array<{
    id: string;
    buffer: Buffer;
    width: number;
    height: number;
  }>;
}): RenderArtifactPreview {
  const title = input.title || 'Presentation';
  const total = input.slides.length;
  const slides = input.slides.map((slide, index) => {
    const width = Math.max(1, Math.round(Number(slide.width) || 1));
    const height = Math.max(1, Math.round(Number(slide.height) || 1));
    const source = `data:image/png;base64,${slide.buffer.toString('base64')}`;
    return `<section class="slide-wrap" data-slide-id="${escapeAttribute(slide.id)}"><div class="slide"><img src="${source}" width="${width}" height="${height}" alt="Slide ${index + 1}" loading="lazy"></div><div class="slide-no">${index + 1} / ${total}</div></section>`;
  }).join('\n');

  return htmlPreview(
    'presentation',
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
      *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#eceff2;color:#5f6368;font-family:Arial,sans-serif}body{padding:12px}
      main{width:100%;margin:0 auto}.slide-wrap{margin:0 0 14px}.slide{overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.10)}
      img{display:block;width:100%;height:auto}.slide-no{padding:5px 2px 0;text-align:right;font-size:10px;line-height:1.2;opacity:.62}
      .empty{display:flex;min-height:180px;align-items:center;justify-content:center;font-size:12px;opacity:.6}
    </style></head><body><main>${slides || '<div class="empty">No slides</div>'}</main></body></html>`,
  );
}

function documentBlockHtml(
  block: DocxBlock,
  theme: DocxTheme,
): string {
  const style = documentBlockStyle(
    block,
    theme,
  );

  if (block.type === 'heading') {
    const level = Math.max(
      1,
      Math.min(6, Number(block.level ?? 2)),
    );
    return `<h${level}${styleAttribute(style)}>${escapeHtml(block.text)}</h${level}>`;
  }

  if (block.type === 'paragraph') {
    if (Array.isArray(block.runs) && block.runs.length) {
      return `<p${styleAttribute(style)}>${block.runs.map((run) => {
        const runStyle = textRunStyle(run);
        let content = escapeHtml(run.text).replace(/\n/g, '<br>');
        if (run.bold) content = `<strong>${content}</strong>`;
        if (run.italic || run.italics) content = `<em>${content}</em>`;
        if (run.underline) content = `<u>${content}</u>`;
        if (run.strike) content = `<s>${content}</s>`;
        return runStyle
          ? `<span${styleAttribute(runStyle)}>${content}</span>`
          : content;
      }).join('')}</p>`;
    }
    return `<p${styleAttribute(style)}>${escapeHtml(block.text ?? '').replace(/\n/g, '<br>')}</p>`;
  }

  if (block.type === 'quote') {
    return `<blockquote${styleAttribute(style)}>${escapeHtml(block.text).replace(/\n/g, '<br>')}</blockquote>`;
  }

  if (block.type === 'list') {
    const tag = block.ordered ? 'ol' : 'ul';
    return `<${tag}${styleAttribute(style)}>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`;
  }

  if (block.type === 'table') {
    const table = block.table;
    const headers = table.columns?.length
      ? table.columns.map((column) => column.header || column.key)
      : (table.headers ?? []).map(cellText);
    const rows = table.rows.map((row) => {
      if (Array.isArray(row)) return row.map(cellText);
      if (table.columns?.length) return table.columns.map((column) => cellText(row[column.key]));
      return Object.values(row).map(cellText);
    });
    return `${table.title ? `<h4>${escapeHtml(table.title)}</h4>` : ''}<table>${headers.length ? `<thead><tr>${headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>${table.caption ? `<div class="caption">${escapeHtml(table.caption)}</div>` : ''}`;
  }

  if (block.type === 'image') {
    const source = imageSource(block.image.dataBase64);
    return source
      ? `<div class="image"><img src="${escapeAttribute(source)}" alt="${escapeAttribute(block.image.alt ?? '')}">${block.image.caption ? `<div class="caption">${escapeHtml(block.image.caption)}</div>` : ''}</div>`
      : '';
  }

  if (block.type === 'line') return '<hr class="line">';
  if (block.type === 'pageBreak') return '<div class="page-break"></div>';
  if (block.type === 'spacer') return `<div class="spacer"${block.size ? ` style="height:${Math.max(0, block.size / 20)}pt"` : ''}></div>`;
  return '';
}

function documentBlockStyle(
  block: DocxBlock,
  theme: DocxTheme,
): string {
  const style = 'style' in block && block.style
    ? block.style
    : undefined;
  const defaultStyle = theme.defaultParagraph;
  const rules: string[] = [];

  const align =
    ('align' in block ? block.align : undefined)
    ?? style?.align
    ?? style?.alignment
    ?? defaultStyle?.align
    ?? defaultStyle?.alignment;
  if (align) rules.push(`text-align:${align}`);

  const fontFamily =
    style?.fontFamily
    ?? theme.fontFamily;
  if (fontFamily) {
    rules.push(`font-family:${escapeCssText(fontFamily)},sans-serif`);
  }

  const fontSize =
    style?.fontSizePt
    ?? ('fontSizePt' in block ? block.fontSizePt : undefined);
  if (Number.isFinite(Number(fontSize))) {
    rules.push(`font-size:${Math.max(1, Number(fontSize))}pt`);
  }

  const color = normalizeOptionalColor(
    style?.color,
  );
  if (color) rules.push(`color:${color}`);

  const background = normalizeOptionalColor(
    style?.backgroundColor,
  );
  if (background) {
    rules.push(`background-color:${background}`);
  }

  if (style?.bold) rules.push('font-weight:700');
  if (style?.italic || style?.italics) rules.push('font-style:italic');
  if (style?.underline) rules.push('text-decoration:underline');

  const before = twipsToPoints(
    style?.spacingBeforeTwips,
  );
  const after = twipsToPoints(
    style?.spacingAfterTwips,
  );
  if (before !== null) rules.push(`margin-top:${before}pt`);
  if (after !== null) rules.push(`margin-bottom:${after}pt`);

  const lineHeight = lineHeightValue(
    style?.lineSpacingTwips,
    0,
  );
  if (lineHeight > 0) rules.push(`line-height:${lineHeight}`);

  const firstLine = twipsToPoints(
    style?.firstLineTwips,
  );
  if (firstLine !== null) {
    rules.push(`text-indent:${firstLine}pt`);
  }

  const left = twipsToPoints(
    style?.leftTwips,
  );
  if (left !== null) rules.push(`margin-left:${left}pt`);

  const right = twipsToPoints(
    style?.rightTwips,
  );
  if (right !== null) rules.push(`margin-right:${right}pt`);

  if (style?.pageBreakBefore) {
    rules.push('break-before:page');
  }

  return rules.join(';');
}

function textRunStyle(
  run: DocxTextRunSpec,
): string {
  const rules: string[] = [];
  if (run.fontFamily) {
    rules.push(`font-family:${escapeCssText(run.fontFamily)},sans-serif`);
  }
  const legacyHalfPointSize = Number(run.size);
  const fontSizePt =
    run.fontSizePt
    ?? (Number.isFinite(legacyHalfPointSize)
      ? legacyHalfPointSize / 2
      : undefined);
  if (Number.isFinite(Number(fontSizePt))) {
    rules.push(`font-size:${Math.max(1, Number(fontSizePt))}pt`);
  }
  const color = normalizeOptionalColor(run.color);
  if (color) rules.push(`color:${color}`);
  return rules.join(';');
}

function styleAttribute(
  style: string,
): string {
  return style
    ? ` style="${escapeAttribute(style)}"`
    : '';
}

function twipsToPoints(
  value: unknown,
): number | null {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, number / 20)
    : null;
}

function lineHeightValue(
  value: unknown,
  fallback: number,
): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.max(0.8, number / 240);
}

function positiveCssNumber(
  value: unknown,
  fallback: number,
): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number
    : fallback;
}

function normalizeOptionalColor(
  value: unknown,
): string | null {
  const clean = String(value ?? '')
    .replace(/^#/, '')
    .replace(/[^0-9a-fA-F]/g, '');
  return clean.length === 6
    ? `#${clean}`
    : null;
}

function spreadsheetRows(blocks: XlsxWorkbookRuntime['sheets'][number]['blocks']): string[][] {
  const rows: string[][] = [];
  const maximumRows = 500;
  const maximumColumns = 100;

  for (const block of blocks) {
    if (rows.length >= maximumRows) break;
    if (block.type === 'spacer') {
      for (let index = 0; index < block.rows && rows.length < maximumRows; index += 1) rows.push([]);
      continue;
    }
    if (block.type === 'text') {
      rows.push([String(block.value ?? '')]);
      continue;
    }
    for (const sourceRow of block.matrix) {
      if (rows.length >= maximumRows) break;
      const row: string[] = [];
      for (const cell of sourceRow) {
        const columnIndex = Math.max(0, Math.min(maximumColumns - 1, block.startColumn + cell.column - 2));
        while (row.length <= columnIndex) row.push('');
        row[columnIndex] = spreadsheetValue(cell.cachedResult ?? cell.value);
      }
      rows.push(row.slice(0, maximumColumns));
    }
  }

  return rows;
}

function htmlPreview(
  kind: RenderArtifactPreview['kind'],
  html: string,
): RenderArtifactPreview {
  return {
    kind,
    mimeType: 'text/html; charset=utf-8',
    extension: 'html',
    buffer: Buffer.from(html, 'utf8'),
  };
}

function cellText(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return String(record.text ?? record.value ?? '');
  }
  return String(value ?? '');
}

function spreadsheetValue(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function imageSource(value: string): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^data:image\/(png|jpe?g|gif|bmp|webp|svg\+xml);base64,/i.test(text)) return text;
  if (/^[a-z0-9+/=\s]+$/i.test(text)) return `data:image/png;base64,${text.replace(/\s+/g, '')}`;
  return null;
}

function percent(value: number): string {
  const number = Number(value);
  return `${Math.max(0, Math.min(1, Number.isFinite(number) ? number : 0)) * 100}%`;
}

function presentationPtToCqw(value: unknown, slideWidthInch: number): string {
  const pt = Number(value);
  const widthPt = Number(slideWidthInch) * 72;
  if (!Number.isFinite(pt) || !Number.isFinite(widthPt) || widthPt <= 0) return '0cqw';
  return `${pt / widthPt * 100}cqw`;
}

function normalizeColor(value: unknown, fallback: string): string {
  const clean = String(value ?? '').replace(/^#/, '').replace(/[^0-9a-fA-F]/g, '');
  return clean.length === 6 ? `#${clean}` : fallback;
}

function cleanHex(value: unknown, fallback: string): string {
  const clean = String(value ?? '').replace(/^#/, '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return clean.length === 6 ? clean : fallback;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] as string);
}

function escapeAttribute(value: unknown): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeCssText(value: unknown): string {
  return String(value ?? '').replace(/[{};<>]/g, '').trim() || 'Arial';
}
