import type {
  PresentationInsets,
  PresentationSpacing,
  ResolvedPresentationTextLine,
  ResolvedPresentationTextRun,
} from './presentation.types';

export function clampUnit(value: unknown, fallback = 1): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

export function cleanPresentationHex(value: unknown): string {
  const clean = String(value ?? '')
    .replace(/^#/, '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();
  if (clean.length === 6) return clean;
  if (clean.length === 8) return clean.slice(2);
  throw new Error('PRESENTATION_COLOR_INVALID: expected a six-digit hex color.');
}

export function normalizePresentationInsets(
  value: PresentationSpacing | undefined,
): Required<PresentationInsets> {
  if (typeof value === 'number') {
    const spacing = Math.max(0, finite(value, 0));
    return { top: spacing, right: spacing, bottom: spacing, left: spacing };
  }
  return {
    top: Math.max(0, finite(value?.top, 0)),
    right: Math.max(0, finite(value?.right, 0)),
    bottom: Math.max(0, finite(value?.bottom, 0)),
    left: Math.max(0, finite(value?.left, 0)),
  };
}

export function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}


export function presentationTextCharWidth(char: string): number {
  if (/\s/.test(char)) return 0.32;
  if (/^[\x00-\x7F]$/.test(char)) {
    if (/[MW@#%&]/.test(char)) return 0.82;
    if (/[A-Z]/.test(char)) return 0.64;
    if (/[ilI1.,:;!'|]/.test(char)) return 0.30;
    if (/[0-9]/.test(char)) return 0.56;
    return 0.54;
  }
  if (/\p{Extended_Pictographic}/u.test(char)) return 1;
  return 1;
}

export function measurePresentationTextRunPt(run: ResolvedPresentationTextRun): number {
  const characters = Array.from(run.text);
  if (characters.length === 0) return 0;
  const glyphWidth = characters.reduce((sum, char) => sum + presentationTextCharWidth(char) * run.fontSizePt, 0);
  return glyphWidth + Math.max(0, characters.length - 1) * run.letterSpacingPt;
}

export function measurePresentationTextLinePt(line: ResolvedPresentationTextLine): number {
  return line.runs.reduce((sum, run) => sum + measurePresentationTextRunPt(run), 0);
}

export function presentationTextLineHeightPt(line: ResolvedPresentationTextLine): number {
  const maxSize = Math.max(1, ...line.runs.map((run) => run.fontSizePt));
  return maxSize * Math.max(0.5, line.lineHeight);
}

export interface PresentationImageGeometry {
  renderX: number;
  renderY: number;
  renderWidth: number;
  renderHeight: number;
  crop: { left: number; right: number; top: number; bottom: number };
}

export function resolvePresentationImageGeometry(input: {
  frameWidth: number;
  frameHeight: number;
  imageWidth: number;
  imageHeight: number;
  fit: 'contain' | 'cover';
  focalPoint?: { x: number; y: number };
}): PresentationImageGeometry {
  const frameWidth = Math.max(0, Number(input.frameWidth));
  const frameHeight = Math.max(0, Number(input.frameHeight));
  const imageWidth = Math.max(1, Number(input.imageWidth));
  const imageHeight = Math.max(1, Number(input.imageHeight));
  const focalX = clampUnit(input.focalPoint?.x, 0.5);
  const focalY = clampUnit(input.focalPoint?.y, 0.5);

  if (input.fit === 'contain') {
    const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
    const renderWidth = imageWidth * scale;
    const renderHeight = imageHeight * scale;
    return {
      renderX: (frameWidth - renderWidth) / 2,
      renderY: (frameHeight - renderHeight) / 2,
      renderWidth,
      renderHeight,
      crop: { left: 0, right: 0, top: 0, bottom: 0 },
    };
  }

  const scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
  const renderWidth = imageWidth * scale;
  const renderHeight = imageHeight * scale;
  const minX = frameWidth - renderWidth;
  const minY = frameHeight - renderHeight;
  const renderX = Math.max(minX, Math.min(0, frameWidth / 2 - focalX * renderWidth));
  const renderY = Math.max(minY, Math.min(0, frameHeight / 2 - focalY * renderHeight));
  const left = renderWidth > 0 ? Math.max(0, -renderX / renderWidth) : 0;
  const right = renderWidth > 0 ? Math.max(0, (renderX + renderWidth - frameWidth) / renderWidth) : 0;
  const top = renderHeight > 0 ? Math.max(0, -renderY / renderHeight) : 0;
  const bottom = renderHeight > 0 ? Math.max(0, (renderY + renderHeight - frameHeight) / renderHeight) : 0;
  return { renderX, renderY, renderWidth, renderHeight, crop: { left, right, top, bottom } };
}
