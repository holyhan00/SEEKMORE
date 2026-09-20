                                                              

import { Injectable } from '@nestjs/common';
import { RenderArtifact, RenderRequest } from '../../render.types';

@Injectable()
export class PdfRenderService {

  async render(request: RenderRequest): Promise<RenderArtifact> {
    const title = String(request.payload?.title ?? request.title ?? 'Document').trim();
    const text = this.extractText(request.payload, title);
    const buffer = this.buildSimplePdf([title, ...this.wrapLines(text, 68)]);
    const filename = this.ensureExtension(request.filename || title, 'pdf');

    const persisted = {
      buffer,
      filename,
      extension: 'pdf',
      mimeType: 'application/pdf',
      userId: request.userId,
      conversationId: request.conversationId,
      requestId: request.requestId,
      source: request.source ?? 'agent',
      category: 'document',
      renderer: 'pdf-render.service',
      rendererVersion: '1.0.0',
      meta: {
        ...request.meta,
        title,
        basicRenderer: true,
      },
    };

    return persisted;
  }

  private extractText(payload: Record<string, unknown>, fallback: string): string {
    const blocks = Array.isArray((payload as any)?.blocks) ? (payload as any).blocks : [];
    const parts = blocks
      .map((block: any) => {
        if (block?.type === 'list' && Array.isArray(block.items)) return block.items.join('\n');
        return String(block?.text ?? block?.content ?? '').trim();
      })
      .filter(Boolean);

    return parts.join('\n\n') || String((payload as any)?.content ?? fallback).trim();
  }

  private buildSimplePdf(lines: string[]): Buffer {
    const escapedLines = lines.flatMap((line) => String(line).split(/\r?\n/));
    const content = [
      'BT',
      '/F1 12 Tf',
      '50 790 Td',
      '16 TL',
      ...escapedLines.slice(0, 48).map((line, index) =>
        `${index === 0 ? '' : 'T*'}${this.toPdfHexText(line)} Tj`,
      ),
      'ET',
    ].join('\n');

    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>',
      '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>',
      '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> /DW 1000 >>',
      `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
    ];

    const chunks: string[] = ['%PDF-1.4\n'];
    const offsets: number[] = [0];
    for (let i = 0; i < objects.length; i += 1) {
      offsets.push(Buffer.byteLength(chunks.join(''), 'utf8'));
      chunks.push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
    }

    const xrefOffset = Buffer.byteLength(chunks.join(''), 'utf8');
    chunks.push(`xref\n0 ${objects.length + 1}\n`);
    chunks.push('0000000000 65535 f \n');
    for (let i = 1; i < offsets.length; i += 1) {
      chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    }
    chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return Buffer.from(chunks.join(''), 'utf8');
  }

  private wrapLines(text: string, width: number): string[] {
    const result: string[] = [];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
      let line = raw.trim();
      while (line.length > width) {
        result.push(line.slice(0, width));
        line = line.slice(width);
      }
      if (line) result.push(line);
    }
    return result;
  }

  private toPdfHexText(text: string): string {
    const source = String(text ?? '');
    const le = Buffer.from(source, 'utf16le');
    const be = Buffer.alloc(le.length);
    for (let i = 0; i < le.length; i += 2) {
      be[i] = le[i + 1] ?? 0;
      be[i + 1] = le[i] ?? 0;
    }
    return `<${be.toString('hex').toUpperCase()}>`;
  }

  private ensureExtension(filename: string, ext: string): string {
    const clean = String(filename || 'artifact').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '').trim();
    return clean.toLowerCase().endsWith(`.${ext}`) ? clean : `${clean}.${ext}`;
  }
}
