import { Injectable } from '@nestjs/common';
import JSZip = require('jszip');
import sharp = require('sharp');
import type { RenderArtifact } from '../render.types';
import {
  failure,
  success,
  type RenderPlanDiagnostic,
  type RenderStageResult,
} from '../planning/core/render-plan-diagnostics.types';

@Injectable()
export class PresentationRenderOutputVerifier {
  async verify(input: {
    expectedSlideCount: number;
    artifact: RenderArtifact;
  }): Promise<RenderStageResult<RenderArtifact>> {
    const buffer = input.artifact.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
      return failure([this.error('PRESENTATION_OUTPUT_BUFFER_MISSING', 'Renderer returned no presentation buffer.', false)]);
    }

    try {
      const zip = await JSZip.loadAsync(buffer);
      const diagnostics: RenderPlanDiagnostic[] = [];
      const requiredParts = [
        '[Content_Types].xml',
        '_rels/.rels',
        'ppt/presentation.xml',
        'ppt/_rels/presentation.xml.rels',
        'ppt/slideMasters/slideMaster1.xml',
        'ppt/slideLayouts/slideLayout1.xml',
        'ppt/theme/theme1.xml',
      ];
      for (const part of requiredParts) {
        if (!zip.file(part)) diagnostics.push(this.error('PRESENTATION_OUTPUT_REQUIRED_PART_MISSING', `PPTX is missing required part: ${part}.`, false, { part }));
      }

      const slideFiles = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((left, right) => this.slideNumber(left) - this.slideNumber(right));
      if (slideFiles.length !== input.expectedSlideCount) {
        diagnostics.push(this.error(
          'PRESENTATION_OUTPUT_SLIDE_COUNT_MISMATCH',
          `Expected ${input.expectedSlideCount} slides but found ${slideFiles.length}.`,
          false,
        ));
      }

      const contentTypes = await zip.file('[Content_Types].xml')?.async('string') ?? '';
      const presentationRelationships = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string') ?? '';
      for (let index = 1; index <= input.expectedSlideCount; index += 1) {
        if (!presentationRelationships.includes(`Target="slides/slide${index}.xml"`)) {
          diagnostics.push(this.error('PRESENTATION_OUTPUT_SLIDE_RELATIONSHIP_MISSING', `Presentation relationship for slide ${index} is missing.`, false, { slide: index }));
        }
      }

      const referencedMedia = new Set<string>();
      for (const slideFile of slideFiles) {
        const slideNumber = this.slideNumber(slideFile);
        const xml = await zip.file(slideFile)!.async('string');
        if (!this.hasVisibleSlideContent(xml)) {
          diagnostics.push(this.error('PRESENTATION_OUTPUT_EMPTY_SLIDE', `Slide contains no visible elements: ${slideFile}.`, true, { slide: slideNumber }));
        }

        const relPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
        const relFile = zip.file(relPath);
        if (!relFile) {
          diagnostics.push(this.error('PRESENTATION_OUTPUT_SLIDE_RELS_MISSING', `Slide relationships are missing: ${relPath}.`, false, { slide: slideNumber }));
          continue;
        }
        const relXml = await relFile.async('string');
        const relationIds = new Set([...relXml.matchAll(/Id="([^"]+)"/g)].map((match) => match[1]));
        const embeddedIds = [...xml.matchAll(/r:embed="([^"]+)"/g)].map((match) => match[1]);
        for (const relationId of embeddedIds) {
          if (!relationIds.has(relationId)) diagnostics.push(this.error('PRESENTATION_OUTPUT_IMAGE_RELATIONSHIP_MISSING', `Slide ${slideNumber} references missing relationship ${relationId}.`, false, { slide: slideNumber, relationId }));
        }

        for (const match of relXml.matchAll(/<Relationship\b[^>]*Type="[^"]+\/image"[^>]*Target="([^"]+)"[^>]*\/>/g)) {
          const target = this.resolveSlideRelationshipTarget(match[1]);
          referencedMedia.add(target);
          const file = zip.file(target);
          if (!file) {
            diagnostics.push(this.error('PRESENTATION_OUTPUT_MEDIA_MISSING', `Slide ${slideNumber} references missing media part ${target}.`, false, { slide: slideNumber, target }));
            continue;
          }
          const media = await file.async('nodebuffer');
          await this.verifyImagePart(target, media, contentTypes, diagnostics);
        }
      }

      const packagedMedia = Object.keys(zip.files).filter((name) => /^ppt\/media\/[^/]+$/i.test(name) && !zip.files[name].dir);
      for (const media of packagedMedia) {
        if (!referencedMedia.has(media)) diagnostics.push(this.error('PRESENTATION_OUTPUT_DANGLING_MEDIA', `PPTX contains unreferenced media part ${media}.`, false, { media }));
      }

      if (diagnostics.some((item) => item.severity === 'error')) return failure(diagnostics);
      return success({ ...input.artifact, sizeBytes: buffer.byteLength }, [
        ...diagnostics,
        {
          stage: 'verification',
          code: 'PRESENTATION_OUTPUT_VERIFIED',
          message: `Verified PPTX package with ${slideFiles.length} slides and ${buffer.byteLength} bytes.`,
          severity: 'info',
          repairable: false,
        },
      ]);
    } catch (error) {
      return failure([this.error('PRESENTATION_OUTPUT_CONTAINER_INVALID', this.errorMessage(error), false)]);
    }
  }

  private async verifyImagePart(
    path: string,
    buffer: Buffer,
    contentTypes: string,
    diagnostics: RenderPlanDiagnostic[],
  ): Promise<void> {
    const extension = path.split('.').pop()?.toLowerCase() ?? '';
    const expectedMime = extension === 'png'
      ? 'image/png'
      : extension === 'jpg' || extension === 'jpeg'
        ? 'image/jpeg'
        : extension === 'svg'
          ? 'image/svg+xml'
          : null;
    if (!expectedMime) {
      diagnostics.push(this.error('PRESENTATION_OUTPUT_MEDIA_FORMAT_INVALID', `Unsupported media extension in PPTX: ${path}.`, false, { path }));
      return;
    }

    const signatureValid = expectedMime === 'image/png'
      ? this.isPng(buffer)
      : expectedMime === 'image/jpeg'
        ? this.isJpeg(buffer)
        : this.isSvg(buffer);
    if (!signatureValid) diagnostics.push(this.error('PRESENTATION_OUTPUT_MEDIA_SIGNATURE_MISMATCH', `Media bytes do not match the file extension: ${path}.`, false, { path, expectedMime }));

    const escapedExtension = extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedMime = expectedMime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declaration = new RegExp(`<Default\\s+Extension="${escapedExtension}"\\s+ContentType="${escapedMime}"`);
    if (!declaration.test(contentTypes)) diagnostics.push(this.error('PRESENTATION_OUTPUT_MEDIA_CONTENT_TYPE_MISSING', `Content type declaration is missing or inconsistent for .${extension}.`, false, { extension, expectedMime }));

    if (expectedMime === 'image/svg+xml') {
      const text = buffer.toString('utf8').trim();
      if (/<(?:script|foreignObject)\b/i.test(text) || /\son[a-z]+\s*=/i.test(text) || /(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|file:|javascript:)/i.test(text)) {
        diagnostics.push(this.error('PRESENTATION_OUTPUT_SVG_UNSAFE', `Packaged SVG contains unsupported executable or external content: ${path}.`, false, { path }));
        return;
      }
    }

    try {
      const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
      if (!metadata.width || !metadata.height) throw new Error('missing decoded dimensions');
      const formatMatches = expectedMime === 'image/png'
        ? metadata.format === 'png'
        : expectedMime === 'image/jpeg'
          ? metadata.format === 'jpeg'
          : metadata.format === 'svg';
      if (!formatMatches) {
        diagnostics.push(this.error('PRESENTATION_OUTPUT_MEDIA_DECODE_MISMATCH', `Decoded media format does not match package extension: ${path}.`, false, { path, decodedFormat: metadata.format, expectedMime }));
      }
    } catch (error) {
      diagnostics.push(this.error('PRESENTATION_OUTPUT_MEDIA_DECODE_FAILED', `Packaged image cannot be decoded: ${path}.`, false, { path, message: this.errorMessage(error) }));
    }
  }

  private resolveSlideRelationshipTarget(target: string): string {
    const value = String(target ?? '').replace(/\\/g, '/');
    if (value.startsWith('../')) return `ppt/${value.slice(3)}`;
    if (value.startsWith('/')) return value.slice(1);
    return `ppt/slides/${value}`.replace(/\/\.\//g, '/');
  }

  private hasVisibleSlideContent(xml: string): boolean {
    return [/<p:sp(?:\s|>)/, /<p:pic(?:\s|>)/, /<p:grpSp(?:\s|>)/, /<p:cxnSp(?:\s|>)/, /<a:t>[^<]*<\/a:t>/].some((pattern) => pattern.test(xml));
  }

  private isPng(buffer: Buffer): boolean {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  private isJpeg(buffer: Buffer): boolean {
    return buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  }

  private isSvg(buffer: Buffer): boolean {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
    return /^(?:<\?xml[^>]*>\s*)?<svg\b[\s\S]*<\/svg>\s*$/i.test(text);
  }

  private slideNumber(path: string): number {
    const match = path.match(/slide(\d+)\.xml$/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }

  private error(code: string, message: string, repairable: boolean, detail?: Record<string, unknown>): RenderPlanDiagnostic {
    return { stage: 'verification', code, message, severity: 'error', repairable, detail };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
}
