import { Injectable } from '@nestjs/common';
import sharp = require('sharp');
import type {
  PresentationFill,
  PresentationMask,
  PresentationPathCommand,
  ResolvedPresentationElement,
  ResolvedPresentationSlide,
  ResolvedPresentationTextLine,
} from './presentation.types';
import {
  presentationTextLineHeightPt,
  resolvePresentationImageGeometry,
} from './presentation-style.util';

@Injectable()
export class PresentationSlideRasterizerService {
  async render(input: {
    slide: ResolvedPresentationSlide;
    widthInch: number;
    heightInch: number;
    widthPx?: number;
  }): Promise<{ buffer: Buffer; width: number; height: number }> {
    const width = Math.max(640, Math.min(2400, Math.round(input.widthPx ?? 1600)));
    if (!Number.isFinite(input.widthInch) || input.widthInch <= 0 || !Number.isFinite(input.heightInch) || input.heightInch <= 0) {
      throw new Error('PRESENTATION_PAGE_INVALID: widthInch and heightInch must be greater than zero.');
    }
    const aspect = input.widthInch / input.heightInch;
    const height = Math.max(360, Math.round(width / aspect));
    const logicalWidthPx = Math.max(1, input.widthInch * 96);
    const pointScale = width / logicalWidthPx;
    const svg = this.svg(input.slide, width, height, pointScale);
    const buffer = await sharp(Buffer.from(svg, 'utf8')).png({ compressionLevel: 7 }).toBuffer();
    return { buffer, width, height };
  }

  private svg(slide: ResolvedPresentationSlide, width: number, height: number, pointScale: number): string {
    const defs: string[] = [];
    const background = slide.background ? this.fill(slide.background, 'bg', defs) : 'transparent';
    const body = slide.elements.map((element, index) => this.element(element, `${index}`, width, height, pointScale, defs)).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>` +
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<defs>${defs.join('')}</defs><rect x="0" y="0" width="${width}" height="${height}" fill="${background}"/>${body}</svg>`;
  }

  private element(
    element: ResolvedPresentationElement,
    key: string,
    width: number,
    height: number,
    pointScale: number,
    defs: string[],
    parent?: { x: number; y: number; width: number; height: number },
  ): string {
    const x = parent ? parent.x + element.frame.x * parent.width : element.frame.x * width;
    const y = parent ? parent.y + element.frame.y * parent.height : element.frame.y * height;
    const w = parent ? element.frame.width * parent.width : element.frame.width * width;
    const h = parent ? element.frame.height * parent.height : element.frame.height * height;
    const transform = element.rotationDeg ? ` transform="rotate(${element.rotationDeg} ${x + w / 2} ${y + h / 2})"` : '';
    const opacity = this.clamp(element.opacity);

    if (element.type === 'group') {
      const children = element.children.map((child, index) => this.element(child, `${key}-${index}`, width, height, pointScale, defs, { x, y, width: w, height: h })).join('');
      return `<g opacity="${opacity}"${transform}>${children}</g>`;
    }
    if (element.type === 'text') return this.text(element, x, y, w, h, opacity, transform, pointScale, key, defs);
    if (element.type === 'shape') return this.paintShape(element.shape, element.fill, element.stroke, element.shadow, x, y, w, h, opacity, transform, pointScale, key, defs);
    if (element.type === 'freeform') return this.paintPath(element.path, element.fill, element.stroke, element.shadow, x, y, w, h, opacity, transform, pointScale, key, defs);
    if (element.type === 'line') return this.line(element, x, y, w, h, opacity, transform, pointScale, key, defs);
    if (element.type === 'svg') return this.svgElement(element, x, y, w, h, opacity, transform, key, defs);
    const href = this.imageDataUri(element.dataBase64);
    return href ? this.image(element, href, x, y, w, h, opacity, transform, key, defs) : '';
  }

  private paintShape(
    shape: string,
    fillValue: PresentationFill | undefined,
    strokeValue: { color: string; widthPt: number; opacity?: number; dash: 'solid' | 'dash' | 'dot' | 'dashDot' } | undefined,
    shadowValue: { color: string; opacity: number; blurPt: number; offsetXPt: number; offsetYPt: number } | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
    transform: string,
    pointScale: number,
    key: string,
    defs: string[],
  ): string {
    const fill = fillValue ? this.fill(fillValue, `fill-${key}`, defs) : 'none';
    const stroke = strokeValue ? this.strokeAttributes(strokeValue, pointScale) : '';
    const shadowId = shadowValue && this.clamp(shadowValue.opacity) > 0 ? this.shadow(shadowValue, key, pointScale, defs) : null;
    const filter = shadowId ? ` filter="url(#${shadowId})"` : '';
    return `<g opacity="${opacity}"${transform}${filter}>${this.shapeGeometry(shape, x, y, w, h, fill, stroke)}</g>`;
  }

  private paintPath(
    path: PresentationPathCommand[],
    fillValue: PresentationFill | undefined,
    strokeValue: { color: string; widthPt: number; opacity?: number; dash: 'solid' | 'dash' | 'dot' | 'dashDot' } | undefined,
    shadowValue: { color: string; opacity: number; blurPt: number; offsetXPt: number; offsetYPt: number } | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
    transform: string,
    pointScale: number,
    key: string,
    defs: string[],
  ): string {
    const fill = fillValue ? this.fill(fillValue, `fill-${key}`, defs) : 'none';
    const stroke = strokeValue ? this.strokeAttributes(strokeValue, pointScale) : '';
    const shadowId = shadowValue && this.clamp(shadowValue.opacity) > 0 ? this.shadow(shadowValue, key, pointScale, defs) : null;
    const filter = shadowId ? ` filter="url(#${shadowId})"` : '';
    return `<path d="${this.pathD(path, x, y, w, h)}" fill="${fill}"${stroke} opacity="${opacity}"${transform}${filter}/>`;
  }

  private line(
    element: Extract<ResolvedPresentationElement, { type: 'line' }>,
    x: number,
    y: number,
    w: number,
    h: number,
    opacity: number,
    transform: string,
    pointScale: number,
    key: string,
    defs: string[],
  ): string {
    const strokeWidth = this.ptPx(element.widthPt, pointScale);
    const dash = this.dashArray(element.dash, strokeWidth);
    const start = this.marker(element.startArrow, element.color, opacity, strokeWidth, `${key}-start`, true, defs);
    const end = this.marker(element.endArrow, element.color, opacity, strokeWidth, `${key}-end`, false, defs);
    return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="#${this.hex(element.color)}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}"${dash}${start ? ` marker-start="url(#${start})"` : ''}${end ? ` marker-end="url(#${end})"` : ''}${transform}/>`;
  }

  private image(
    element: Extract<ResolvedPresentationElement, { type: 'image' }>,
    href: string,
    x: number,
    y: number,
    width: number,
    height: number,
    opacity: number,
    transform: string,
    key: string,
    defs: string[],
  ): string {
    const geometry = resolvePresentationImageGeometry({
      frameWidth: width,
      frameHeight: height,
      imageWidth: element.widthPx,
      imageHeight: element.heightPx,
      fit: element.fit,
      focalPoint: element.focalPoint,
    });
    const clipFrame = element.fit === 'contain'
      ? { x: x + geometry.renderX, y: y + geometry.renderY, width: geometry.renderWidth, height: geometry.renderHeight }
      : { x, y, width, height };
    const clipId = this.clip(
      element.mask ?? (element.fit === 'cover' ? { type: 'rect' } : undefined),
      clipFrame.x,
      clipFrame.y,
      clipFrame.width,
      clipFrame.height,
      key,
      defs,
    );
    const image = `<image x="${x + geometry.renderX}" y="${y + geometry.renderY}" width="${geometry.renderWidth}" height="${geometry.renderHeight}" opacity="${opacity}" preserveAspectRatio="none" href="${this.escapeAttr(href)}"/>`;
    const clipped = clipId ? `<g clip-path="url(#${clipId})">${image}</g>` : image;
    return transform ? `<g${transform}>${clipped}</g>` : clipped;
  }

  private svgElement(
    element: Extract<ResolvedPresentationElement, { type: 'svg' }>,
    x: number,
    y: number,
    width: number,
    height: number,
    opacity: number,
    transform: string,
    key: string,
    defs: string[],
  ): string {
    const href = `data:image/svg+xml;base64,${Buffer.from(element.svg, 'utf8').toString('base64')}`;
    const clipId = this.clip(element.mask, x, y, width, height, key, defs);
    const image = `<image x="${x}" y="${y}" width="${width}" height="${height}" opacity="${opacity}" preserveAspectRatio="none" href="${this.escapeAttr(href)}"/>`;
    const clipped = clipId ? `<g clip-path="url(#${clipId})">${image}</g>` : image;
    return transform ? `<g${transform}>${clipped}</g>` : clipped;
  }

  private text(
    element: Extract<ResolvedPresentationElement, { type: 'text' }>,
    x: number,
    y: number,
    width: number,
    height: number,
    opacity: number,
    transform: string,
    pointScale: number,
    key: string,
    defs: string[],
  ): string {
    const padLeft = width * Math.max(0, element.padding.left);
    const padRight = width * Math.max(0, element.padding.right);
    const padTop = height * Math.max(0, element.padding.top);
    const padBottom = height * Math.max(0, element.padding.bottom);
    const innerWidth = Math.max(1, width - padLeft - padRight);
    const innerHeight = Math.max(1, height - padTop - padBottom);
    const lineHeights = element.lines.map((line) => this.ptPx(presentationTextLineHeightPt(line), pointScale));
    const totalHeight = lineHeights.reduce((sum, value) => sum + value, 0);
    let cursorY = element.verticalAlign === 'middle'
      ? y + padTop + Math.max(0, (innerHeight - totalHeight) / 2)
      : element.verticalAlign === 'bottom'
        ? y + height - padBottom - totalHeight
        : y + padTop;
    const background = element.fill ? `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${this.fill(element.fill, `text-fill-${key}`, defs)}" fill-opacity="${opacity}"/>` : '';
    const lines = element.lines.map((line, lineIndex) => {
      const lineHeightPx = lineHeights[lineIndex];
      const anchorX = line.align === 'center'
        ? x + padLeft + innerWidth / 2
        : line.align === 'right'
          ? x + width - padRight
          : x + padLeft;
      const textAnchor = line.align === 'center' ? 'middle' : line.align === 'right' ? 'end' : 'start';
      const baseline = cursorY + this.lineBaselinePx(line, pointScale);
      const runs = line.runs.map((run) => {
        const decoration = [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean).join(' ');
        return `<tspan xml:space="preserve" font-family="${this.escapeAttr(run.fontFamily)}" font-size="${this.ptPx(run.fontSizePt, pointScale)}" font-weight="${run.bold ? 700 : 400}" font-style="${run.italic ? 'italic' : 'normal'}"${decoration ? ` text-decoration="${decoration}"` : ''}${run.letterSpacingPt ? ` letter-spacing="${this.ptPx(run.letterSpacingPt, pointScale)}"` : ''} fill="#${this.hex(run.color)}" fill-opacity="${opacity}">${this.escape(run.text)}</tspan>`;
      }).join('');
      cursorY += lineHeightPx;
      return `<text x="${anchorX}" y="${baseline}" text-anchor="${textAnchor}">${runs}</text>`;
    }).join('');
    return `<g${transform}>${background}${lines}</g>`;
  }

  private lineBaselinePx(line: ResolvedPresentationTextLine, pointScale: number): number {
    const maxSize = Math.max(1, ...line.runs.map((run) => run.fontSizePt));
    return this.ptPx(maxSize, pointScale) * 0.84;
  }

  private shapeGeometry(shape: string, x: number, y: number, w: number, h: number, fill: string, stroke: string): string {
    const common = ` fill="${fill}"${stroke}`;
    if (shape === 'ellipse') return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"${common}/>`;
    if (shape === 'roundRect') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) / 6}"${common}/>`;
    const points: Record<string, string> = {
      triangle: `${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`,
      diamond: `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`,
      hexagon: `${x + .25*w},${y} ${x + .75*w},${y} ${x+w},${y+.5*h} ${x+.75*w},${y+h} ${x+.25*w},${y+h} ${x},${y+.5*h}`,
      chevron: `${x},${y} ${x+.75*w},${y} ${x+w},${y+.5*h} ${x+.75*w},${y+h} ${x},${y+h} ${x+.25*w},${y+.5*h}`,
      rightArrow: `${x},${y+.2*h} ${x+.65*w},${y+.2*h} ${x+.65*w},${y} ${x+w},${y+.5*h} ${x+.65*w},${y+h} ${x+.65*w},${y+.8*h} ${x},${y+.8*h}`,
      leftArrow: `${x+.35*w},${y} ${x+.35*w},${y+.2*h} ${x+w},${y+.2*h} ${x+w},${y+.8*h} ${x+.35*w},${y+.8*h} ${x+.35*w},${y+h} ${x},${y+.5*h}`,
    };
    return points[shape] ? `<polygon points="${points[shape]}"${common}/>` : `<rect x="${x}" y="${y}" width="${w}" height="${h}"${common}/>`;
  }

  private pathD(path: PresentationPathCommand[], x: number, y: number, w: number, h: number): string {
    return path.map((command) => {
      if (command.type === 'moveTo') return `M ${x + command.x * w} ${y + command.y * h}`;
      if (command.type === 'lineTo') return `L ${x + command.x * w} ${y + command.y * h}`;
      if (command.type === 'cubicTo') return `C ${x + command.x1 * w} ${y + command.y1 * h} ${x + command.x2 * w} ${y + command.y2 * h} ${x + command.x * w} ${y + command.y * h}`;
      if (command.type === 'quadraticTo') return `Q ${x + command.x1 * w} ${y + command.y1 * h} ${x + command.x * w} ${y + command.y * h}`;
      return 'Z';
    }).join(' ');
  }

  private clip(mask: PresentationMask | undefined, x: number, y: number, w: number, h: number, key: string, defs: string[]): string | null {
    if (!mask) return null;
    const id = `clip-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    let geometry = `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
    if (mask.type === 'ellipse') geometry = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"/>`;
    else if (mask.type === 'roundRect') geometry = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) * mask.radius}"/>`;
    else if (mask.type === 'freeform') geometry = `<path d="${this.pathD(mask.path, x, y, w, h)}"/>`;
    defs.push(`<clipPath id="${id}">${geometry}</clipPath>`);
    return id;
  }

  private strokeAttributes(stroke: { color: string; widthPt: number; opacity?: number; dash: 'solid' | 'dash' | 'dot' | 'dashDot' }, pointScale: number): string {
    const width = this.ptPx(stroke.widthPt, pointScale);
    return ` stroke="#${this.hex(stroke.color)}" stroke-width="${width}" stroke-opacity="${this.clamp(stroke.opacity ?? 1)}"${this.dashArray(stroke.dash, width)}`;
  }

  private dashArray(dash: 'solid' | 'dash' | 'dot' | 'dashDot', width: number): string {
    if (dash === 'solid') return '';
    if (dash === 'dash') return ` stroke-dasharray="${6 * width} ${4 * width}"`;
    if (dash === 'dot') return ` stroke-dasharray="${width} ${3 * width}" stroke-linecap="round"`;
    return ` stroke-dasharray="${6 * width} ${3 * width} ${width} ${3 * width}"`;
  }

  private marker(
    type: 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval',
    color: string,
    opacity: number,
    strokeWidth: number,
    key: string,
    start: boolean,
    defs: string[],
  ): string | null {
    if (type === 'none') return null;
    const id = `marker-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const fill = `#${this.hex(color)}`;
    const geometry = type === 'diamond'
      ? '<path d="M 0 3 L 3 0 L 6 3 L 3 6 Z"/>'
      : type === 'oval'
        ? '<ellipse cx="3" cy="3" rx="3" ry="2.4"/>'
        : type === 'stealth'
          ? '<path d="M 0 0 L 6 3 L 0 6 L 2 3 Z"/>'
          : '<path d="M 0 0 L 6 3 L 0 6 Z"/>';
    defs.push(`<marker id="${id}" markerWidth="6" markerHeight="6" refX="${start ? 1 : 5}" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth"><g fill="${fill}" fill-opacity="${opacity}" transform="scale(${Math.max(0.8, Math.min(1.6, strokeWidth / 2))})">${geometry}</g></marker>`);
    return id;
  }

  private fill(fill: PresentationFill, id: string, defs: string[]): string {
    if (fill.type === 'solid') return `#${this.hex(fill.color)}`;
    const gradientId = `gradient-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const angle = Number(fill.angleDeg) * Math.PI / 180;
    const gx = Math.cos(angle);
    const gy = Math.sin(angle);
    const x1 = 50 - gx * 50;
    const y1 = 50 - gy * 50;
    const x2 = 50 + gx * 50;
    const y2 = 50 + gy * 50;
    defs.push(`<linearGradient id="${gradientId}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${fill.stops.map((stop) => `<stop offset="${this.clamp(stop.offset) * 100}%" stop-color="#${this.hex(stop.color)}" stop-opacity="${this.clamp(stop.opacity ?? 1)}"/>`).join('')}</linearGradient>`);
    return `url(#${gradientId})`;
  }

  private shadow(shadow: { color: string; opacity: number; blurPt: number; offsetXPt: number; offsetYPt: number }, key: string, pointScale: number, defs: string[]): string {
    const id = `shadow-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const blur = this.ptPx(Math.max(0, Number(shadow.blurPt)), pointScale) / 2;
    defs.push(`<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="${this.ptPx(Number(shadow.offsetXPt), pointScale)}" dy="${this.ptPx(Number(shadow.offsetYPt), pointScale)}" stdDeviation="${blur}" flood-color="#${this.hex(shadow.color)}" flood-opacity="${this.clamp(shadow.opacity)}"/></filter>`);
    return id;
  }

  private imageDataUri(value: string): string | null {
    const text = String(value ?? '').trim();
    if (!text) return null;
    if (/^data:image\//i.test(text)) return text;
    return `data:image/png;base64,${text.replace(/\s+/g, '')}`;
  }

  private ptPx(value: number, pointScale = 1): number {
    return Math.max(0, Number(value) * 96 / 72 * pointScale);
  }

  private clamp(value: unknown): number {
    const number = Number(value);
    return Math.max(0, Math.min(1, Number.isFinite(number) ? number : 1));
  }

  private hex(value: unknown): string {
    const clean = String(value ?? '').replace(/^#/, '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (clean.length !== 6) throw new Error('PRESENTATION_COLOR_INVALID: expected a six-digit hex color.');
    return clean;
  }

  private escape(value: unknown): string {
    return String(value ?? '').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char));
  }

  private escapeAttr(value: unknown): string {
    return this.escape(value).replace(/"/g, '&quot;');
  }
}
