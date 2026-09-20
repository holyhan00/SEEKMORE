import { Injectable } from '@nestjs/common';
import JSZip = require('jszip');
import { normalizeLanguageTag } from '../../../../modules/localization/locale-normalizer';
import type { RenderArtifact, RenderRequest } from '../../render.types';
import {
  clampUnit,
  cleanPresentationHex,
  resolvePresentationImageGeometry,
} from '../presentation-style.util';
import type {
  PresentationDesignDNA,
  PresentationFill,
  PresentationFrame,
  PresentationMask,
  PresentationPathCommand,
  PresentationRuntimePayload,
  ResolvedPresentationElement,
  ResolvedPresentationFreeformElement,
  ResolvedPresentationGroupElement,
  ResolvedPresentationImageElement,
  ResolvedPresentationLineElement,
  ResolvedPresentationShapeElement,
  ResolvedPresentationSlide,
  ResolvedPresentationSvgElement,
  ResolvedPresentationTextElement,
  ResolvedPresentationTextRun,
} from '../presentation.types';

const DEFAULT_PRESENTATION_LANGUAGE = 'en';
const EMU_PER_INCH = 914400;
const EMU_PER_POINT = 12700;
const CUSTOM_GEOMETRY_SCALE = 100000;

type SlideAsset = {
  relationshipId: string;
  target: string;
  mediaPath: string;
  extension: 'png' | 'jpg' | 'svg';
  buffer: Buffer;
  widthPx?: number;
  heightPx?: number;
};

type CoordinateSpace = {
  widthEmu: number;
  heightEmu: number;
  fontFamily: string;
  language: string;
};

@Injectable()
export class PptxRenderService {
  async render(request: RenderRequest): Promise<RenderArtifact> {
    const payload = this.requirePayload(request.payload);
    if (payload.slides.length === 0) throw new Error('PRESENTATION_SLIDES_REQUIRED: no resolved slides were supplied.');

    const widthInch = this.requirePositive(payload.page.widthInch, 'PRESENTATION_PAGE_WIDTH_INVALID');
    const heightInch = this.requirePositive(payload.page.heightInch, 'PRESENTATION_PAGE_HEIGHT_INVALID');
    const fontFamily = this.themeFontFamily(payload);
    const language = normalizeLanguageTag(payload.language) ?? DEFAULT_PRESENTATION_LANGUAGE;
    const buffer = await this.buildPptx(payload.slides, {
      widthEmu: this.inchToEmu(widthInch),
      heightEmu: this.inchToEmu(heightInch),
      fontFamily,
      language,
      designDNA: payload.designDNA,
    });
    const title = this.nonEmpty(payload.title) ?? request.title ?? 'presentation';
    const filename = this.ensureExtension(request.filename || title, 'pptx');

    return {
      buffer,
      filename,
      extension: 'pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      userId: request.userId,
      conversationId: request.conversationId,
      requestId: request.requestId,
      source: request.source ?? 'agent',
      category: 'presentation',
      renderer: 'pptx-render.service',
      meta: { ...request.meta, ...payload.meta, title, slideCount: payload.slides.length },
    };
  }

  private requirePayload(value: unknown): PresentationRuntimePayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PRESENTATION_RUNTIME_PAYLOAD_INVALID: payload must be an object.');
    const payload = value as Partial<PresentationRuntimePayload>;
    if (!payload.page || !Array.isArray(payload.slides)) throw new Error('PRESENTATION_RUNTIME_PAYLOAD_INVALID: page and slides are required.');
    return payload as PresentationRuntimePayload;
  }

  private async buildPptx(
    slides: ResolvedPresentationSlide[],
    page: CoordinateSpace & { designDNA: PresentationDesignDNA },
  ): Promise<Buffer> {
    const zip = new JSZip();
    const allAssets = slides.map((slide, slideIndex) => this.collectSlideAssets(slide, slideIndex + 1));

    zip.file('[Content_Types].xml', this.contentTypes(slides.length, allAssets));
    zip.file('_rels/.rels', this.rootRelationships());
    zip.file('docProps/app.xml', this.appProperties(slides.length));
    zip.file('docProps/core.xml', this.coreProperties());
    zip.file('ppt/presentation.xml', this.presentationXml(slides.length, page));
    zip.file('ppt/_rels/presentation.xml.rels', this.presentationRelationships(slides.length));
    zip.file('ppt/slideMasters/slideMaster1.xml', this.slideMasterXml());
    zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', this.slideMasterRelationships());
    zip.file('ppt/slideLayouts/slideLayout1.xml', this.slideLayoutXml());
    zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', this.slideLayoutRelationships());
    zip.file('ppt/theme/theme1.xml', this.themeXml(page.fontFamily, page.designDNA, slides));

    slides.forEach((slide, index) => {
      const number = index + 1;
      const assets = allAssets[index];
      zip.file(`ppt/slides/slide${number}.xml`, this.slideXml(slide, page, assets));
      zip.file(`ppt/slides/_rels/slide${number}.xml.rels`, this.slideRelationships(assets));
      for (const asset of assets) zip.file(asset.mediaPath, asset.buffer);
    });

    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  private collectSlideAssets(slide: ResolvedPresentationSlide, slideNumber: number): SlideAsset[] {
    const assets: SlideAsset[] = [];
    let mediaIndex = 0;
    const visit = (element: ResolvedPresentationElement) => {
      if (element.type === 'group') {
        element.children.forEach(visit);
        return;
      }
      if (element.type !== 'image' && element.type !== 'svg') return;
      mediaIndex += 1;
      if (element.type === 'image') {
        const decoded = this.decodeImage(element);
        const filename = `media-${slideNumber}-${mediaIndex}.${decoded.extension}`;
        assets.push({
          relationshipId: `rId${assets.length + 2}`,
          target: `../media/${filename}`,
          mediaPath: `ppt/media/${filename}`,
          extension: decoded.extension,
          buffer: decoded.buffer,
          widthPx: decoded.widthPx,
          heightPx: decoded.heightPx,
        });
        return;
      }
      const decoded = this.decodeSvg(element);
      const filename = `media-${slideNumber}-${mediaIndex}.${decoded.extension}`;
      assets.push({
        relationshipId: `rId${assets.length + 2}`,
        target: `../media/${filename}`,
        mediaPath: `ppt/media/${filename}`,
        extension: decoded.extension,
        buffer: decoded.buffer,
      });
    };
    slide.elements.forEach(visit);
    return assets;
  }

  private slideXml(slide: ResolvedPresentationSlide, page: CoordinateSpace, assets: SlideAsset[]): string {
    const shapeId = { value: 2 };
    const assetIndex = { value: 0 };
    const elements = slide.elements.map((element) => this.elementXml(element, page, assets, shapeId, assetIndex)).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
      `<p:cSld name="${this.escapeXml(slide.id)}">${slide.background ? `<p:bg><p:bgPr>${this.fillXml(slide.background, 1)}<a:effectLst/></p:bgPr></p:bg>` : ''}` +
      `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
      `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${elements}</p:spTree></p:cSld>` +
      `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  }

  private elementXml(
    element: ResolvedPresentationElement,
    space: CoordinateSpace,
    assets: SlideAsset[],
    shapeId: { value: number },
    assetIndex: { value: number },
  ): string {
    const id = shapeId.value++;
    if (element.type === 'text') return this.textShapeXml(id, element, space);
    if (element.type === 'shape') return this.geometryShapeXml(id, element, space);
    if (element.type === 'freeform') return this.freeformShapeXml(id, element, space);
    if (element.type === 'line') return this.lineShapeXml(id, element, space);
    if (element.type === 'group') return this.groupShapeXml(id, element, space, assets, shapeId, assetIndex);
    const asset = assets[assetIndex.value++];
    if (!asset) throw new Error(`PRESENTATION_MEDIA_ASSET_MISSING: ${element.id}`);
    return element.type === 'image'
      ? this.imageShapeXml(id, element, space, asset)
      : this.svgShapeXml(id, element, space, asset);
  }

  private textShapeXml(id: number, element: ResolvedPresentationTextElement, page: CoordinateSpace): string {
    const frame = this.frame(element.frame, page);
    const anchor = element.verticalAlign === 'middle' ? 'ctr' : element.verticalAlign === 'bottom' ? 'b' : 't';
    const margins = this.textMargins(element, frame);
    const xfrm = this.transformXml(frame, element.rotationDeg);
    const shapeFill = element.fill ? this.fillXml(element.fill, element.opacity) : '<a:noFill/>';
    const paragraphs = element.lines.map((line) => {
      const align = line.align === 'center' ? 'ctr' : line.align === 'right' ? 'r' : 'l';
      const lineSpacing = Math.max(50000, Math.min(400000, Math.round(line.lineHeight * 100000)));
      const runs = line.runs.map((run) => this.textRunXml(run, element.opacity, page)).join('');
      const maxSize = Math.max(100, ...line.runs.map((run) => Math.round(run.fontSizePt * 100)));
      return `<a:p><a:pPr algn="${align}"><a:lnSpc><a:spcPct val="${lineSpacing}"/></a:lnSpc></a:pPr>${runs}<a:endParaRPr lang="${this.escapeXml(page.language)}" sz="${maxSize}" dirty="0"/></a:p>`;
    }).join('');
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${this.escapeXml(element.id)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${shapeFill}<a:ln><a:noFill/></a:ln></p:spPr>` +
      `<p:txBody><a:bodyPr wrap="none" anchor="${anchor}" lIns="${margins.left}" rIns="${margins.right}" tIns="${margins.top}" bIns="${margins.bottom}"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
  }

  private textRunXml(run: ResolvedPresentationTextRun, opacity: number, page: CoordinateSpace): string {
    const font = this.escapeXml(this.nonEmpty(run.fontFamily) ?? page.fontFamily);
    const size = Math.max(100, Math.round(run.fontSizePt * 100));
    const underline = run.underline ? ' u="sng"' : '';
    const strike = run.strike ? ' strike="sngStrike"' : '';
    const spacing = Math.round(run.letterSpacingPt * 100);
    return `<a:r><a:rPr lang="${this.escapeXml(page.language)}" sz="${size}" dirty="0"${run.bold ? ' b="1"' : ''}${run.italic ? ' i="1"' : ''}${underline}${strike}${spacing ? ` spc="${spacing}"` : ''}>` +
      `${this.colorXml(run.color, opacity)}<a:latin typeface="${font}"/><a:ea typeface="${font}"/><a:cs typeface="${font}"/></a:rPr><a:t xml:space="preserve">${this.escapeXml(run.text)}</a:t></a:r>`;
  }

  private geometryShapeXml(id: number, element: ResolvedPresentationShapeElement, page: CoordinateSpace): string {
    const frame = this.frame(element.frame, page);
    const xfrm = this.transformXml(frame, element.rotationDeg);
    const fill = element.fill ? this.fillXml(element.fill, element.opacity) : '<a:noFill/>';
    const line = this.strokeXml(element.stroke, element.opacity);
    const effects = this.shadowXml(element.shadow);
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${this.escapeXml(element.id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr>${xfrm}<a:prstGeom prst="${this.shapeGeometry(element.shape)}"><a:avLst/></a:prstGeom>${fill}${line}${effects}</p:spPr></p:sp>`;
  }

  private freeformShapeXml(id: number, element: ResolvedPresentationFreeformElement, page: CoordinateSpace): string {
    const frame = this.frame(element.frame, page);
    const xfrm = this.transformXml(frame, element.rotationDeg);
    const fill = element.fill ? this.fillXml(element.fill, element.opacity) : '<a:noFill/>';
    const line = this.strokeXml(element.stroke, element.opacity);
    const effects = this.shadowXml(element.shadow);
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${this.escapeXml(element.id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr>${xfrm}${this.customGeometryXml(element.path)}${fill}${line}${effects}</p:spPr></p:sp>`;
  }

  private lineShapeXml(id: number, element: ResolvedPresentationLineElement, page: CoordinateSpace): string {
    const raw = this.frame(element.frame, page);
    const frame = { ...raw, width: Math.max(1, raw.width), height: Math.max(1, raw.height) };
    const xfrm = this.transformXml(frame, element.rotationDeg);
    const line = `${this.colorXml(element.color, element.opacity)}${this.dashXml(element.dash)}${this.arrowXml('headEnd', element.startArrow)}${this.arrowXml('tailEnd', element.endArrow)}`;
    return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${this.escapeXml(element.id)}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
      `<p:spPr>${xfrm}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${this.ptToEmu(element.widthPt)}">${line}</a:ln></p:spPr></p:cxnSp>`;
  }

  private groupShapeXml(
    id: number,
    element: ResolvedPresentationGroupElement,
    page: CoordinateSpace,
    assets: SlideAsset[],
    shapeId: { value: number },
    assetIndex: { value: number },
  ): string {
    const frame = this.frame(element.frame, page);
    const rotation = Number.isFinite(element.rotationDeg) && Math.abs(element.rotationDeg) > 0.0001 ? ` rot="${Math.round(element.rotationDeg * 60000)}"` : '';
    const groupSpace: CoordinateSpace = { ...page, widthEmu: Math.max(1, frame.width), heightEmu: Math.max(1, frame.height) };
    const children = element.children.map((child) => this.elementXml(child, groupSpace, assets, shapeId, assetIndex)).join('');
    return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${this.escapeXml(element.id)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
      `<p:grpSpPr><a:xfrm${rotation}><a:off x="${frame.x}" y="${frame.y}"/><a:ext cx="${frame.width}" cy="${frame.height}"/><a:chOff x="0" y="0"/><a:chExt cx="${Math.max(1, frame.width)}" cy="${Math.max(1, frame.height)}"/></a:xfrm></p:grpSpPr>${children}</p:grpSp>`;
  }

  private imageShapeXml(id: number, element: ResolvedPresentationImageElement, page: CoordinateSpace, asset: SlideAsset): string {
    const rawFrame = this.frame(element.frame, page);
    const geometry = resolvePresentationImageGeometry({ frameWidth: rawFrame.width, frameHeight: rawFrame.height, imageWidth: asset.widthPx ?? element.widthPx, imageHeight: asset.heightPx ?? element.heightPx, fit: element.fit, focalPoint: element.focalPoint });
    const frame = element.fit === 'contain'
      ? { x: rawFrame.x + geometry.renderX, y: rawFrame.y + geometry.renderY, width: geometry.renderWidth, height: geometry.renderHeight }
      : rawFrame;
    const sourceRect = element.fit === 'cover' ? this.sourceRectXml(geometry.crop) : '';
    const xfrm = this.transformXml(frame, element.rotationDeg);
    const alpha = element.opacity < 0.99999 ? `<a:alphaModFix amt="${Math.round(clampUnit(element.opacity, 1) * 100000)}"/>` : '';
    return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${this.escapeXml(element.id)}" descr="${this.escapeXml(element.alt ?? '')}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="${asset.relationshipId}">${alpha}</a:blip>${sourceRect}<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr>${xfrm}${this.pictureGeometryXml(element.mask)}</p:spPr></p:pic>`;
  }

  private svgShapeXml(id: number, element: ResolvedPresentationSvgElement, page: CoordinateSpace, asset: SlideAsset): string {
    const frame = this.frame(element.frame, page);
    const xfrm = this.transformXml(frame, element.rotationDeg);
    const alpha = element.opacity < 0.99999 ? `<a:alphaModFix amt="${Math.round(clampUnit(element.opacity, 1) * 100000)}"/>` : '';
    const svgExt = `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${asset.relationshipId}"/></a:ext></a:extLst>`;
    return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${this.escapeXml(element.id)}" descr="${this.escapeXml(element.alt ?? '')}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="${asset.relationshipId}">${alpha}${svgExt}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr>${xfrm}${this.pictureGeometryXml(element.mask)}</p:spPr></p:pic>`;
  }

  private pictureGeometryXml(mask?: PresentationMask): string {
    if (!mask || mask.type === 'rect') return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
    if (mask.type === 'ellipse') return '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>';
    if (mask.type === 'freeform') return this.customGeometryXml(mask.path);
    return this.customGeometryXml(this.roundRectPath(mask.radius));
  }

  private roundRectPath(radius: number): PresentationPathCommand[] {
    const r = Math.max(0.0001, Math.min(0.5, Number(radius)));
    const k = 0.5522847498;
    return [
      { type: 'moveTo', x: r, y: 0 }, { type: 'lineTo', x: 1 - r, y: 0 },
      { type: 'cubicTo', x1: 1 - r + r*k, y1: 0, x2: 1, y2: r - r*k, x: 1, y: r },
      { type: 'lineTo', x: 1, y: 1 - r },
      { type: 'cubicTo', x1: 1, y1: 1 - r + r*k, x2: 1 - r + r*k, y2: 1, x: 1 - r, y: 1 },
      { type: 'lineTo', x: r, y: 1 },
      { type: 'cubicTo', x1: r - r*k, y1: 1, x2: 0, y2: 1 - r + r*k, x: 0, y: 1 - r },
      { type: 'lineTo', x: 0, y: r },
      { type: 'cubicTo', x1: 0, y1: r - r*k, x2: r - r*k, y2: 0, x: r, y: 0 },
      { type: 'close' },
    ];
  }

  private customGeometryXml(path: PresentationPathCommand[]): string {
    const commands = path.map((command) => {
      const p = (value: number) => Math.round(clampUnit(value, 0) * CUSTOM_GEOMETRY_SCALE);
      if (command.type === 'moveTo') return `<a:moveTo><a:pt x="${p(command.x)}" y="${p(command.y)}"/></a:moveTo>`;
      if (command.type === 'lineTo') return `<a:lnTo><a:pt x="${p(command.x)}" y="${p(command.y)}"/></a:lnTo>`;
      if (command.type === 'cubicTo') return `<a:cubicBezTo><a:pt x="${p(command.x1)}" y="${p(command.y1)}"/><a:pt x="${p(command.x2)}" y="${p(command.y2)}"/><a:pt x="${p(command.x)}" y="${p(command.y)}"/></a:cubicBezTo>`;
      if (command.type === 'quadraticTo') return `<a:quadBezTo><a:pt x="${p(command.x1)}" y="${p(command.y1)}"/><a:pt x="${p(command.x)}" y="${p(command.y)}"/></a:quadBezTo>`;
      return '<a:close/>';
    }).join('');
    return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="${CUSTOM_GEOMETRY_SCALE}" b="${CUSTOM_GEOMETRY_SCALE}"/><a:pathLst><a:path w="${CUSTOM_GEOMETRY_SCALE}" h="${CUSTOM_GEOMETRY_SCALE}">${commands}</a:path></a:pathLst></a:custGeom>`;
  }

  private strokeXml(stroke: ResolvedPresentationShapeElement['stroke'] | ResolvedPresentationFreeformElement['stroke'], opacity: number): string {
    return stroke
      ? `<a:ln w="${this.ptToEmu(stroke.widthPt)}">${this.colorXml(stroke.color, opacity * clampUnit(stroke.opacity, 1))}${this.dashXml(stroke.dash)}</a:ln>`
      : '<a:ln><a:noFill/></a:ln>';
  }

  private textMargins(element: ResolvedPresentationTextElement, frame: { width: number; height: number }): { left: number; right: number; top: number; bottom: number } {
    return {
      left: Math.max(0, Math.round(frame.width * element.padding.left)),
      right: Math.max(0, Math.round(frame.width * element.padding.right)),
      top: Math.max(0, Math.round(frame.height * element.padding.top)),
      bottom: Math.max(0, Math.round(frame.height * element.padding.bottom)),
    };
  }

  private transformXml(frame: { x: number; y: number; width: number; height: number }, rotationDeg: number): string {
    const rotation = Number.isFinite(rotationDeg) && Math.abs(rotationDeg) > 0.0001 ? ` rot="${Math.round(rotationDeg * 60000)}"` : '';
    return `<a:xfrm${rotation}><a:off x="${frame.x}" y="${frame.y}"/><a:ext cx="${frame.width}" cy="${frame.height}"/></a:xfrm>`;
  }

  private fillXml(fill: PresentationFill, inheritedOpacity: number): string {
    if (fill.type === 'linearGradient') {
      const stops = fill.stops.map((stop) => `<a:gs pos="${Math.round(clampUnit(stop.offset, 0) * 100000)}">${this.colorXmlContent(stop.color, clampUnit(stop.opacity, 1) * clampUnit(inheritedOpacity, 1))}</a:gs>`).join('');
      return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="${this.gradientAngle(fill.angleDeg)}" scaled="1"/></a:gradFill>`;
    }
    return `<a:solidFill>${this.colorXmlContent(fill.color, clampUnit(fill.opacity, 1) * clampUnit(inheritedOpacity, 1))}</a:solidFill>`;
  }

  private colorXml(color: string, opacity: number): string { return `<a:solidFill>${this.colorXmlContent(color, opacity)}</a:solidFill>`; }

  private colorXmlContent(color: string, opacity: number): string {
    const hex = cleanPresentationHex(color);
    const alpha = clampUnit(opacity, 1);
    return alpha >= 0.99999 ? `<a:srgbClr val="${hex}"/>` : `<a:srgbClr val="${hex}"><a:alpha val="${Math.round(alpha * 100000)}"/></a:srgbClr>`;
  }

  private shadowXml(shadow: ResolvedPresentationShapeElement['shadow'] | ResolvedPresentationFreeformElement['shadow'] | undefined): string {
    if (!shadow || clampUnit(shadow.opacity, 0) <= 0) return '<a:effectLst/>';
    const x = Number(shadow.offsetXPt);
    const y = Number(shadow.offsetYPt);
    const distance = Math.sqrt(x * x + y * y);
    const degrees = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
    return `<a:effectLst><a:outerShdw blurRad="${this.ptToEmu(Math.max(0, Number(shadow.blurPt)))}" dist="${this.ptToEmu(distance)}" dir="${Math.round(degrees * 60000)}" algn="ctr" rotWithShape="0">${this.colorXmlContent(shadow.color, clampUnit(shadow.opacity, 0))}</a:outerShdw></a:effectLst>`;
  }

  private dashXml(value: ResolvedPresentationLineElement['dash']): string {
    const map: Record<ResolvedPresentationLineElement['dash'], string> = { solid: 'solid', dash: 'dash', dot: 'dot', dashDot: 'dashDot' };
    return `<a:prstDash val="${map[value]}"/>`;
  }

  private arrowXml(tag: 'tailEnd' | 'headEnd', value: ResolvedPresentationLineElement['startArrow']): string {
    return !value || value === 'none' ? '' : `<a:${tag} type="${value}" w="med" len="med"/>`;
  }

  private shapeGeometry(value: ResolvedPresentationShapeElement['shape']): string {
    const map: Record<ResolvedPresentationShapeElement['shape'], string> = {
      rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', diamond: 'diamond', hexagon: 'hexagon', chevron: 'chevron', rightArrow: 'rightArrow', leftArrow: 'leftArrow',
    };
    return map[value];
  }

  private sourceRectXml(crop: { left: number; right: number; top: number; bottom: number }): string {
    const values = { l: crop.left, r: crop.right, t: crop.top, b: crop.bottom };
    const attrs = Object.entries(values).filter(([, value]) => value > 0.000001).map(([key, value]) => `${key}="${Math.round(clampUnit(value, 0) * 100000)}"`).join(' ');
    return attrs ? `<a:srcRect ${attrs}/>` : '';
  }

  private frame(frame: PresentationFrame, page: { widthEmu: number; heightEmu: number }) {
    return { x: Math.round(frame.x * page.widthEmu), y: Math.round(frame.y * page.heightEmu), width: Math.max(0, Math.round(frame.width * page.widthEmu)), height: Math.max(0, Math.round(frame.height * page.heightEmu)) };
  }

  private contentTypes(slideCount: number, assets: SlideAsset[][]): string {
    const slideOverrides = Array.from({ length: slideCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
    const imageDefaults = [...new Set(assets.flat().map((asset) => asset.extension))].map((extension) => `<Default Extension="${extension}" ContentType="${this.imageMime(extension)}"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides}</Types>`;
  }

  private rootRelationships(): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`; }

  private presentationXml(count: number, page: { widthEmu: number; heightEmu: number }): string {
    const ids = Array.from({ length: count }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="${page.widthEmu}" cy="${page.heightEmu}" type="custom"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  }

  private presentationRelationships(count: number): string {
    const slides = Array.from({ length: count }, (_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides}</Relationships>`;
  }

  private slideRelationships(assets: SlideAsset[]): string {
    const images = assets.map((asset) => `<Relationship Id="${asset.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${asset.target}"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${images}</Relationships>`;
  }

  private slideMasterXml(): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`; }
  private slideMasterRelationships(): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`; }
  private slideLayoutXml(): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld></p:sldLayout>`; }
  private slideLayoutRelationships(): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`; }

  private themeXml(fontFamily: string, dna: PresentationDesignDNA, slides: ResolvedPresentationSlide[]): string {
    const font = this.escapeXml(fontFamily);
    const palette = this.themeColors(dna, slides);
    const color = (name: string, value: string) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SEEKMORE Presentation"><a:themeElements><a:clrScheme name="Presentation">${color('dk1', palette.dark)}${color('lt1', palette.light)}${color('dk2', palette.dark2)}${color('lt2', palette.light2)}${palette.accents.map((item, index) => color(`accent${index + 1}`, item)).join('')}${color('hlink', palette.accents[0])}${color('folHlink', palette.accents[1])}</a:clrScheme><a:fontScheme name="Explicit"><a:majorFont><a:latin typeface="${font}"/><a:ea typeface="${font}"/><a:cs typeface="${font}"/></a:majorFont><a:minorFont><a:latin typeface="${font}"/><a:ea typeface="${font}"/><a:cs typeface="${font}"/></a:minorFont></a:fontScheme><a:fmtScheme name="Presentation"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  }

  private themeColors(dna: PresentationDesignDNA, slides: ResolvedPresentationSlide[]): { dark: string; light: string; dark2: string; light2: string; accents: string[] } {
    const explicit = [dna.palette.text, dna.palette.background, ...(dna.palette.accents ?? [])].map((item) => String(item ?? '').trim()).filter(Boolean).map(cleanPresentationHex);
    const used: string[] = [];
    const collect = (element: ResolvedPresentationElement) => {
      if (element.type === 'group') return element.children.forEach(collect);
      if (element.type === 'text') element.lines.forEach((line) => line.runs.forEach((run) => used.push(run.color)));
      if (element.type === 'line') used.push(element.color);
      if (element.type === 'shape' || element.type === 'freeform') {
        if (element.fill?.type === 'solid') used.push(element.fill.color);
        if (element.stroke?.color) used.push(element.stroke.color);
      }
    };
    slides.forEach((slide) => { if (slide.background?.type === 'solid') used.push(slide.background.color); slide.elements.forEach(collect); });
    const unique = [...new Set([...explicit, ...used].map(cleanPresentationHex))];
    const dark = cleanPresentationHex(dna.palette.text);
    const light = cleanPresentationHex(dna.palette.background);
    const remainder = unique.filter((item) => item !== dark && item !== light);
    const source = remainder.length > 0 ? remainder : [dark, light];
    return { dark, light, dark2: remainder[0] ?? dark, light2: remainder[1] ?? light, accents: Array.from({ length: 6 }, (_, index) => source[index % source.length]) };
  }

  private appProperties(count: number): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>SEEKMORE</Application><PresentationFormat>Custom</PresentationFormat><Slides>${count}</Slides></Properties>`; }
  private coreProperties(): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>SEEKMORE</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`; }

  private decodeImage(element: ResolvedPresentationImageElement): { extension: 'png' | 'jpg'; buffer: Buffer; widthPx: number; heightPx: number } {
    const match = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(String(element.dataBase64).trim());
    if (!match) throw new Error(`PRESENTATION_IMAGE_DATA_INVALID: ${element.id} is not normalized PNG/JPEG data.`);
    const extension = match[1] === 'jpeg' ? 'jpg' as const : 'png' as const;
    if ((element.mimeType === 'image/jpeg' && extension !== 'jpg') || (element.mimeType === 'image/png' && extension !== 'png')) throw new Error(`PRESENTATION_IMAGE_MIME_MISMATCH: ${element.id}.`);
    const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (buffer.length === 0) throw new Error(`PRESENTATION_IMAGE_DATA_INVALID: ${element.id} decoded to empty bytes.`);
    if (extension === 'png' && !this.isPng(buffer)) throw new Error(`PRESENTATION_IMAGE_SIGNATURE_INVALID: ${element.id} is not PNG.`);
    if (extension === 'jpg' && !this.isJpeg(buffer)) throw new Error(`PRESENTATION_IMAGE_SIGNATURE_INVALID: ${element.id} is not JPEG.`);
    return { extension, buffer, widthPx: element.widthPx, heightPx: element.heightPx };
  }

  private decodeSvg(element: ResolvedPresentationSvgElement): { extension: 'svg'; buffer: Buffer } {
    const svg = String(element.svg ?? '').trim();
    if (!/^<svg\b/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) throw new Error(`PRESENTATION_SVG_INVALID: ${element.id}.`);
    return { extension: 'svg', buffer: Buffer.from(svg, 'utf8') };
  }

  private isPng(buffer: Buffer): boolean { return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); }
  private isJpeg(buffer: Buffer): boolean { return buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9; }
  private imageMime(extension: SlideAsset['extension']): string { return extension === 'jpg' ? 'image/jpeg' : extension === 'svg' ? 'image/svg+xml' : 'image/png'; }
  private gradientAngle(value: number): number { return Math.round((((Number(value) % 360) + 360) % 360) * 60000); }
  private nonEmpty(value: unknown): string | undefined { const text = String(value ?? '').trim(); return text || undefined; }
  private requirePositive(value: unknown, code: string): number { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error(`${code}: value must be greater than zero.`); return number; }
  private themeFontFamily(payload: PresentationRuntimePayload): string { const explicit = this.nonEmpty(payload.designDNA.typography.fontFamily); if (!explicit) throw new Error('PRESENTATION_THEME_FONT_REQUIRED: designDNA.typography.fontFamily is required.'); return explicit; }
  private inchToEmu(value: number): number { return Math.round(value * EMU_PER_INCH); }
  private ptToEmu(value: number): number { return Math.max(1, Math.round(value * EMU_PER_POINT)); }
  private escapeXml(value: string): string { return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] as string); }
  private ensureExtension(filename: string, extension: string): string { const clean = String(filename || 'artifact').replace(/[\\/:*?"<>|]/g, '_').trim(); return clean.toLowerCase().endsWith(`.${extension}`) ? clean : `${clean}.${extension}`; }
}
