import { Injectable } from '@nestjs/common';
import {
  failure,
  success,
  type RenderPlanDiagnostic,
  type RenderStageResult,
} from '../planning/core/render-plan-diagnostics.types';
import type {
  PresentationAdvancedElement,
  PresentationConstraintEdge,
  PresentationDesignDNA,
  PresentationElementContent,
  PresentationFill,
  PresentationFrame,
  PresentationGroupChild,
  PresentationLayoutConstraint,
  PresentationPageSpec,
  PresentationPathCommand,
  PresentationSemanticElement,
  PresentationSemanticSizing,
  PresentationSlideSpec,
  PresentationStroke,
  PresentationShadow,
  PresentationTextContent,
  PresentationTextParagraph,
  ResolvedPresentationElement,
  ResolvedPresentationGroupElement,
  ResolvedPresentationImageElement,
  ResolvedPresentationSlide,
  ResolvedPresentationSvgElement,
  ResolvedPresentationTextElement,
  ResolvedPresentationTextLine,
  ResolvedPresentationTextRun,
} from './presentation.types';
import {
  clampUnit,
  cleanPresentationHex,
  finite,
  normalizePresentationInsets,
  measurePresentationTextRunPt,
  presentationTextLineHeightPt,
} from './presentation-style.util';

const ENGINEERING_EDGE_GUARD_INCH = 0.08;
const MIN_READABLE_FONT_PT = 8;
const MAX_BLEED_EXTENSION = 0.25;
const SOLVER_EPSILON = 0.00001;
const MAX_SOLVER_PASSES = 64;

type VariableName = 'x' | 'y' | 'width' | 'height';
type VariableStrength = 1 | 2 | 3;

interface LayoutVariable {
  value?: number;
  strength: VariableStrength;
  source?: string;
}

interface LayoutState {
  element: PresentationSemanticElement;
  x: LayoutVariable;
  y: LayoutVariable;
  width: LayoutVariable;
  height: LayoutVariable;
}

interface ResolveOptions {
  page: PresentationPageSpec;
  designDNA: PresentationDesignDNA;
}

interface SourceParagraph {
  runs: ResolvedPresentationTextRun[];
  align: 'left' | 'center' | 'right';
  lineHeight: number;
}

@Injectable()
export class PresentationLayoutEngine {
  resolve(
    slides: PresentationSlideSpec[],
    options: ResolveOptions,
  ): RenderStageResult<ResolvedPresentationSlide[]> {
    const diagnostics: RenderPlanDiagnostic[] = [];
    const resolved: ResolvedPresentationSlide[] = [];

    slides.forEach((slide, slideIndex) => {
      const path = `$.slides[${slideIndex}]`;
      const frames = slide.scene.mode === 'semantic'
        ? this.resolveConstraintFrames(slide.scene.elements, slide.scene.constraints, options, path, diagnostics)
        : new Map(slide.scene.elements.map((element) => [element.id, this.clone(element.frame)]));

      const elements: ResolvedPresentationElement[] = [];
      for (let index = 0; index < slide.scene.elements.length; index += 1) {
        const element = slide.scene.elements[index] as PresentationElementContent;
        const frame = frames.get(element.id);
        const elementPath = `${path}.scene.elements[${index}]`;
        if (!frame) {
          diagnostics.push(this.error('PRESENTATION_FRAME_UNRESOLVED', `Could not resolve frame for element ${element.id}.`, elementPath));
          continue;
        }
        this.checkFrame(frame, element.allowBleed === true, options.page, elementPath, diagnostics);
        const item = this.resolveElement(element, frame, options, elementPath, diagnostics);
        if (item) elements.push(item);
      }

      this.checkOverlap(elements, path, diagnostics);
      resolved.push({
        id: slide.id,
        purpose: this.optionalText(slide.purpose),
        background: slide.background ? this.normalizeFill(slide.background) : this.backgroundFromDNA(options.designDNA),
        elements: this.sortElements(elements),
      });
    });

    return diagnostics.some((item) => item.severity === 'error')
      ? failure(diagnostics)
      : success(resolved, diagnostics);
  }

  private resolveConstraintFrames(
    elements: PresentationSemanticElement[],
    constraints: PresentationLayoutConstraint[],
    options: ResolveOptions,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): Map<string, PresentationFrame> {
    const states = new Map<string, LayoutState>();
    for (const element of elements) {
      states.set(element.id, this.initialState(element));
    }

    let changed = true;
    for (let pass = 0; pass < MAX_SOLVER_PASSES && changed; pass += 1) {
      changed = false;
      for (const state of states.values()) changed = this.applyIntrinsicSizing(state, options) || changed;
      for (const state of states.values()) changed = this.applyAspectRatio(state) || changed;
      for (const constraint of constraints) changed = this.applyConstraint(constraint, states, `${path}.scene.constraints`, diagnostics) || changed;
      for (const state of states.values()) changed = this.applyIntrinsicSizing(state, options) || changed;
      for (const state of states.values()) changed = this.applyAspectRatio(state) || changed;
    }

    const frames = new Map<string, PresentationFrame>();
    for (const state of states.values()) {
      const unresolved = (['x', 'y', 'width', 'height'] as VariableName[]).filter((name) => state[name].value == null);
      if (unresolved.length > 0) {
        diagnostics.push(this.error(
          'PRESENTATION_CONSTRAINT_UNRESOLVED',
          `Element ${state.element.id} has unresolved layout variables: ${unresolved.join(', ')}.`,
          `${path}.scene.elements`,
          { elementId: state.element.id, unresolved },
        ));
        continue;
      }
      const frame = {
        x: state.x.value!,
        y: state.y.value!,
        width: state.width.value!,
        height: state.height.value!,
      };
      this.checkSizingBounds(state.element.sizing, frame, state.element.id, path, diagnostics);
      frames.set(state.element.id, frame);
    }
    return frames;
  }

  private initialState(element: PresentationSemanticElement): LayoutState {
    const sizing = element.sizing;
    return {
      element,
      x: { strength: 1 },
      y: { strength: 1 },
      width: sizing?.width != null
        ? { value: Number(sizing.width), strength: 3, source: 'authored width' }
        : { strength: 1 },
      height: sizing?.height != null
        ? { value: Number(sizing.height), strength: 3, source: 'authored height' }
        : { strength: 1 },
    };
  }

  private applyIntrinsicSizing(state: LayoutState, options: ResolveOptions): boolean {
    const sizing = state.element.sizing;
    if (!sizing?.fitContent || state.element.type !== 'text') return false;
    let changed = false;

    if ((sizing.fitContent === 'width' || sizing.fitContent === 'both') && state.width.strength <= 1) {
      const preferred = this.intrinsicTextWidth(state.element, options);
      changed = this.assign(state, 'width', this.bound(preferred, sizing.minWidth, sizing.maxWidth), 1, 'intrinsic text width') || changed;
    }

    if ((sizing.fitContent === 'height' || sizing.fitContent === 'both') && state.width.value != null && state.height.strength <= 1) {
      const preferred = this.intrinsicTextHeight(state.element, state.width.value, options);
      changed = this.assign(state, 'height', this.bound(preferred, sizing.minHeight, sizing.maxHeight), 1, 'intrinsic text height') || changed;
    }

    return changed;
  }

  private applyAspectRatio(state: LayoutState): boolean {
    const ratio = this.elementAspectRatio(state.element);
    if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return false;
    if (state.width.value != null && state.height.value == null) {
      return this.assign(state, 'height', state.width.value / ratio, 2, 'aspect ratio');
    }
    if (state.height.value != null && state.width.value == null) {
      return this.assign(state, 'width', state.height.value * ratio, 2, 'aspect ratio');
    }
    return false;
  }

  private elementAspectRatio(element: PresentationSemanticElement): number | null {
    const authored = Number(element.sizing?.aspectRatio);
    if (Number.isFinite(authored) && authored > 0) return authored;
    if (element.type === 'image') {
      const width = Number(element.widthPx);
      const height = Number(element.heightPx);
      if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) return width / height;
    }
    if (element.type === 'svg') {
      const viewBox = /\bviewBox\s*=\s*["']\s*[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?[ ,]+[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?[ ,]+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)[ ,]+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i.exec(element.svg);
      if (viewBox) {
        const width = Number(viewBox[1]);
        const height = Number(viewBox[2]);
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) return width / height;
      }
      const width = /\bwidth\s*=\s*["']\s*([0-9]*\.?[0-9]+)/i.exec(element.svg);
      const height = /\bheight\s*=\s*["']\s*([0-9]*\.?[0-9]+)/i.exec(element.svg);
      if (width && height && Number(width[1]) > 0 && Number(height[1]) > 0) return Number(width[1]) / Number(height[1]);
    }
    return null;
  }

  private applyConstraint(
    constraint: PresentationLayoutConstraint,
    states: Map<string, LayoutState>,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): boolean {
    if (constraint.type === 'anchor') {
      const state = states.get(constraint.target);
      if (!state) return false;
      let changed = false;
      const offsetX = finite(constraint.offsetX, 0);
      const offsetY = finite(constraint.offsetY, 0);
      changed = this.assignEdge(state, constraint.horizontal === 'left' ? 'left' : constraint.horizontal === 'right' ? 'right' : 'centerX', constraint.horizontal === 'left' ? offsetX : constraint.horizontal === 'right' ? 1 + offsetX : 0.5 + offsetX, diagnostics, path, `anchor:${constraint.target}:horizontal`) || changed;
      changed = this.assignEdge(state, constraint.vertical === 'top' ? 'top' : constraint.vertical === 'bottom' ? 'bottom' : 'centerY', constraint.vertical === 'top' ? offsetY : constraint.vertical === 'bottom' ? 1 + offsetY : 0.5 + offsetY, diagnostics, path, `anchor:${constraint.target}:vertical`) || changed;
      return changed;
    }

    if (constraint.type === 'edge') {
      const state = states.get(constraint.target);
      if (!state) return false;
      const reference = constraint.to ? states.get(constraint.to) : undefined;
      const toEdge = constraint.toEdge ?? constraint.edge;
      const referenceValue = reference
        ? this.edgeValue(reference, toEdge)
        : this.canvasEdgeValue(toEdge);
      if (referenceValue == null) return false;
      return this.assignEdge(state, constraint.edge, referenceValue + finite(constraint.offset, 0), diagnostics, path, `edge:${constraint.target}:${constraint.edge}:${constraint.to ?? 'canvas'}:${toEdge}:${finite(constraint.offset, 0)}`);
    }

    if (constraint.type === 'matchSize') {
      const target = states.get(constraint.target);
      const source = states.get(constraint.to);
      if (!target || !source) return false;
      let changed = false;
      if (constraint.axis === 'width' || constraint.axis === 'both') {
        if (source.width.value != null) changed = this.assign(target, 'width', source.width.value, 3, `matchSize:${constraint.target}:${constraint.to}:${constraint.axis}`) || changed;
      }
      if (constraint.axis === 'height' || constraint.axis === 'both') {
        if (source.height.value != null) changed = this.assign(target, 'height', source.height.value, 3, `matchSize:${constraint.target}:${constraint.to}:${constraint.axis}`) || changed;
      }
      return changed;
    }

    return this.applyDistribution(constraint, states, diagnostics, path);
  }

  private applyDistribution(
    constraint: Extract<PresentationLayoutConstraint, { type: 'distribute' }>,
    states: Map<string, LayoutState>,
    diagnostics: RenderPlanDiagnostic[],
    path: string,
  ): boolean {
    const targets = constraint.targets.map((id) => states.get(id)).filter(Boolean) as LayoutState[];
    if (targets.length !== constraint.targets.length || targets.length < 2) return false;
    const dimension: VariableName = constraint.axis === 'horizontal' ? 'width' : 'height';
    if (targets.some((state) => state[dimension].value == null)) return false;
    const total = targets.reduce((sum, state) => sum + state[dimension].value!, 0);
    const range = Number(constraint.end) - Number(constraint.start);
    const gap = constraint.gap == null
      ? (range - total) / (targets.length - 1)
      : Number(constraint.gap);
    if (!Number.isFinite(gap) || gap < -SOLVER_EPSILON) {
      diagnostics.push(this.error(
        'PRESENTATION_DISTRIBUTION_IMPOSSIBLE',
        'Distribution range is too small for the resolved element sizes.',
        path,
        { targets: constraint.targets, start: constraint.start, end: constraint.end, totalSize: total },
      ));
      return false;
    }
    const occupied = total + gap * (targets.length - 1);
    if (constraint.gap != null && occupied > range + SOLVER_EPSILON) {
      diagnostics.push(this.error(
        'PRESENTATION_DISTRIBUTION_IMPOSSIBLE',
        'Authored distribution gap does not fit inside the requested range.',
        path,
        { targets: constraint.targets, range, occupied },
      ));
      return false;
    }

    let cursor = Number(constraint.start);
    let changed = false;
    const position: VariableName = constraint.axis === 'horizontal' ? 'x' : 'y';
    for (const state of targets) {
      changed = this.assign(state, position, cursor, 3, `distribute:${constraint.axis}:${constraint.targets.join(',')}:${constraint.start}:${constraint.end}:${constraint.gap ?? 'auto'}`, diagnostics, path) || changed;
      cursor += state[dimension].value! + gap;
    }
    return changed;
  }

  private assignEdge(
    state: LayoutState,
    edge: PresentationConstraintEdge,
    value: number,
    diagnostics: RenderPlanDiagnostic[],
    path: string,
    source: string,
  ): boolean {
    if (!Number.isFinite(value)) return false;
    if (edge === 'left') return this.assign(state, 'x', value, 3, source, diagnostics, path);
    if (edge === 'top') return this.assign(state, 'y', value, 3, source, diagnostics, path);
    if (edge === 'right') {
      if (state.x.value != null && (state.width.value == null || state.width.strength < 3)) {
        return this.assign(state, 'width', value - state.x.value, 3, source, diagnostics, path);
      }
      if (state.width.value != null) return this.assign(state, 'x', value - state.width.value, 3, source, diagnostics, path);
      return false;
    }
    if (edge === 'bottom') {
      if (state.y.value != null && (state.height.value == null || state.height.strength < 3)) {
        return this.assign(state, 'height', value - state.y.value, 3, source, diagnostics, path);
      }
      if (state.height.value != null) return this.assign(state, 'y', value - state.height.value, 3, source, diagnostics, path);
      return false;
    }
    if (edge === 'centerX') {
      if (state.x.value != null && (state.width.value == null || state.width.strength < 3)) {
        return this.assign(state, 'width', (value - state.x.value) * 2, 3, source, diagnostics, path);
      }
      if (state.width.value != null) return this.assign(state, 'x', value - state.width.value / 2, 3, source, diagnostics, path);
      return false;
    }
    if (state.y.value != null && (state.height.value == null || state.height.strength < 3)) {
      return this.assign(state, 'height', (value - state.y.value) * 2, 3, source, diagnostics, path);
    }
    if (state.height.value != null) return this.assign(state, 'y', value - state.height.value / 2, 3, source, diagnostics, path);
    return false;
  }

  private edgeValue(state: LayoutState, edge: PresentationConstraintEdge): number | null {
    if (edge === 'left') return state.x.value ?? null;
    if (edge === 'top') return state.y.value ?? null;
    if (edge === 'right') return state.x.value != null && state.width.value != null ? state.x.value + state.width.value : null;
    if (edge === 'bottom') return state.y.value != null && state.height.value != null ? state.y.value + state.height.value : null;
    if (edge === 'centerX') return state.x.value != null && state.width.value != null ? state.x.value + state.width.value / 2 : null;
    return state.y.value != null && state.height.value != null ? state.y.value + state.height.value / 2 : null;
  }

  private canvasEdgeValue(edge: PresentationConstraintEdge): number {
    if (edge === 'left' || edge === 'top') return 0;
    if (edge === 'right' || edge === 'bottom') return 1;
    return 0.5;
  }

  private assign(
    state: LayoutState,
    name: VariableName,
    value: number,
    strength: VariableStrength,
    source: string,
    diagnostics?: RenderPlanDiagnostic[],
    path?: string,
  ): boolean {
    if (!Number.isFinite(value)) return false;
    const variable = state[name];
    if (variable.value == null) {
      variable.value = value;
      variable.strength = strength;
      variable.source = source;
      return true;
    }
    if (Math.abs(variable.value - value) <= SOLVER_EPSILON) {
      if (strength > variable.strength) {
        variable.strength = strength;
        variable.source = source;
      }
      return false;
    }
    if (strength > variable.strength) {
      variable.value = value;
      variable.strength = strength;
      variable.source = source;
      return true;
    }
    if (strength < variable.strength) return false;
    if (variable.source === source || strength === 1) {
      variable.value = value;
      variable.source = source;
      return true;
    }
    if (diagnostics && !diagnostics.some((item) =>
      item.code === 'PRESENTATION_CONSTRAINT_CONFLICT'
      && item.detail?.elementId === state.element.id
      && item.detail?.variable === name
      && item.detail?.existingSource === variable.source
      && item.detail?.incomingSource === source
    )) diagnostics.push(this.error(
      'PRESENTATION_CONSTRAINT_CONFLICT',
      `Conflicting constraints resolve ${state.element.id}.${name} to different values.`,
      path,
      { elementId: state.element.id, variable: name, existing: variable.value, incoming: value, existingSource: variable.source, incomingSource: source },
    ));
    return false;
  }

  private checkSizingBounds(
    sizing: PresentationSemanticSizing | undefined,
    frame: PresentationFrame,
    elementId: string,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!sizing) return;
    const checks: Array<[number | undefined, boolean, string]> = [
      [sizing.minWidth, frame.width + SOLVER_EPSILON >= Number(sizing.minWidth), 'minWidth'],
      [sizing.maxWidth, frame.width - SOLVER_EPSILON <= Number(sizing.maxWidth), 'maxWidth'],
      [sizing.minHeight, frame.height + SOLVER_EPSILON >= Number(sizing.minHeight), 'minHeight'],
      [sizing.maxHeight, frame.height - SOLVER_EPSILON <= Number(sizing.maxHeight), 'maxHeight'],
    ];
    for (const [authored, ok, key] of checks) {
      if (authored != null && !ok) diagnostics.push(this.error('PRESENTATION_SIZING_CONSTRAINT_VIOLATION', `${elementId} violates authored ${key}.`, `${path}.scene.elements`, { elementId, frame, key, authored }));
    }
    if (sizing.aspectRatio != null && Math.abs(frame.width / Math.max(SOLVER_EPSILON, frame.height) - Number(sizing.aspectRatio)) > 0.01) {
      diagnostics.push(this.error('PRESENTATION_ASPECT_RATIO_VIOLATION', `${elementId} violates authored aspectRatio.`, `${path}.scene.elements`, { elementId, frame, aspectRatio: sizing.aspectRatio }));
    }
  }

  private resolveElement(
    element: PresentationElementContent,
    frame: PresentationFrame,
    options: ResolveOptions,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): ResolvedPresentationElement | null {
    const common = {
      id: element.id,
      frame,
      opacity: clampUnit(element.opacity, 1),
      rotationDeg: finite(element.rotationDeg, 0),
      zIndex: finite(element.zIndex, 0),
      allowOverlap: element.allowOverlap === true,
      allowBleed: element.allowBleed === true,
    };

    if (element.type === 'text') return this.resolveText(element, common, options, path, diagnostics);
    if (element.type === 'shape') return {
      type: 'shape',
      ...common,
      shape: element.shape,
      fill: element.fill ? this.normalizeFill(element.fill) : undefined,
      stroke: this.normalizeStroke(element.stroke),
      shadow: this.normalizeShadow(element.shadow),
    };
    if (element.type === 'freeform') return {
      type: 'freeform',
      ...common,
      path: this.normalizePath(element.path),
      fill: element.fill ? this.normalizeFill(element.fill) : undefined,
      stroke: this.normalizeStroke(element.stroke),
      shadow: this.normalizeShadow(element.shadow),
    };
    if (element.type === 'line') return {
      type: 'line',
      ...common,
      color: cleanPresentationHex(element.color),
      widthPt: Number(element.widthPt),
      dash: element.dash,
      startArrow: element.startArrow,
      endArrow: element.endArrow,
    };
    if (element.type === 'image') return this.resolveImage(element, common, path, diagnostics);
    if (element.type === 'svg') return {
      type: 'svg',
      ...common,
      svg: element.svg,
      alt: this.optionalText(element.alt),
      mask: element.mask ? this.clone(element.mask) : undefined,
    } satisfies ResolvedPresentationSvgElement;
    return this.resolveGroup(element, common, options, path, diagnostics);
  }

  private resolveImage(
    element: Extract<PresentationElementContent, { type: 'image' }>,
    common: Omit<ResolvedPresentationImageElement, 'type' | 'dataBase64' | 'mimeType' | 'widthPx' | 'heightPx' | 'alt' | 'fit' | 'focalPoint' | 'mask'>,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): ResolvedPresentationImageElement | null {
    const dataBase64 = String(element.dataBase64 ?? '').trim();
    const mimeType = element.mimeType;
    const widthPx = Number(element.widthPx);
    const heightPx = Number(element.heightPx);
    if (!dataBase64 || !mimeType || !Number.isFinite(widthPx) || widthPx <= 0 || !Number.isFinite(heightPx) || heightPx <= 0) {
      diagnostics.push(this.error('PRESENTATION_IMAGE_NOT_RESOLVED', 'Image bytes and dimensions must be resolved before layout.', path, { elementId: element.id }));
      return null;
    }
    return {
      type: 'image',
      ...common,
      dataBase64,
      mimeType,
      widthPx,
      heightPx,
      alt: this.optionalText(element.alt),
      fit: element.fit,
      focalPoint: element.focalPoint ? { x: clampUnit(element.focalPoint.x, 0.5), y: clampUnit(element.focalPoint.y, 0.5) } : undefined,
      mask: element.mask ? this.clone(element.mask) : undefined,
    };
  }

  private resolveGroup(
    element: Extract<PresentationElementContent, { type: 'group' }>,
    common: Omit<ResolvedPresentationGroupElement, 'type' | 'children'>,
    options: ResolveOptions,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): ResolvedPresentationGroupElement {
    const children: ResolvedPresentationElement[] = [];
    const groupOpacity = common.opacity;
    element.children.forEach((child, index) => {
      const absoluteFrame = this.mapChildFrame(common.frame, child.frame);
      const resolved = this.resolveElement(
        { ...child, opacity: clampUnit(child.opacity, 1) * groupOpacity } as PresentationElementContent,
        absoluteFrame,
        options,
        `${path}.children[${index}]`,
        diagnostics,
      );
      if (!resolved) return;
      children.push({ ...resolved, frame: this.clone(child.frame) } as ResolvedPresentationElement);
    });
    return {
      type: 'group',
      ...common,
      opacity: 1,
      children: this.sortElements(children),
    };
  }

  private mapChildFrame(group: PresentationFrame, child: PresentationFrame): PresentationFrame {
    return {
      x: group.x + child.x * group.width,
      y: group.y + child.y * group.height,
      width: child.width * group.width,
      height: child.height * group.height,
    };
  }

  private resolveText(
    element: PresentationTextContent,
    common: {
      id: string;
      frame: PresentationFrame;
      opacity: number;
      rotationDeg: number;
      zIndex: number;
      allowOverlap: boolean;
      allowBleed: boolean;
    },
    options: ResolveOptions,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): ResolvedPresentationTextElement {
    const style = element.style;
    const padding = normalizePresentationInsets(style.padding);
    const source = this.sourceParagraphs(element, options.designDNA, 1);
    let lines = this.wrapParagraphs(source, this.innerWidthPt(common.frame.width, padding, options.page));
    let resolved = this.textElementFromLines(element, common, padding, lines);
    if (this.textLinesFit(resolved, options.page)) return resolved;

    if (style.fit === 'shrink') {
      const minimum = Math.max(MIN_READABLE_FONT_PT, Number(style.minFontSizePt ?? MIN_READABLE_FONT_PT));
      const authored = Number(style.fontSizePt);
      for (let size = authored - 0.5; size >= minimum; size -= 0.5) {
        const scale = size / authored;
        const candidateSource = this.sourceParagraphs(element, options.designDNA, scale);
        const candidateLines = this.wrapParagraphs(candidateSource, this.innerWidthPt(common.frame.width, padding, options.page));
        const candidate = this.textElementFromLines(element, common, padding, candidateLines);
        if (!this.textLinesFit(candidate, options.page)) continue;
        diagnostics.push(this.info(
          'PRESENTATION_TEXT_FIT_APPLIED',
          `Text ${element.id} was reduced to fit its authored frame.`,
          path,
          { elementId: element.id, fromFontSizePt: authored, toFontSizePt: Math.round(size * 2) / 2 },
        ));
        return candidate;
      }
    }

    diagnostics.push(this.error('PRESENTATION_TEXT_OVERFLOW', 'Text is estimated to overflow its resolved frame.', path, { elementId: element.id }));
    return resolved;
  }

  private textElementFromLines(
    element: PresentationTextContent,
    common: {
      id: string;
      frame: PresentationFrame;
      opacity: number;
      rotationDeg: number;
      zIndex: number;
      allowOverlap: boolean;
      allowBleed: boolean;
    },
    padding: Required<{ top: number; right: number; bottom: number; left: number }>,
    lines: ResolvedPresentationTextLine[],
  ): ResolvedPresentationTextElement {
    return {
      type: 'text',
      ...common,
      lines,
      verticalAlign: element.style.verticalAlign,
      padding,
      fill: element.style.fill ? this.normalizeFill(element.style.fill) : undefined,
    };
  }

  private sourceParagraphs(element: PresentationTextContent, dna: PresentationDesignDNA, scale: number): SourceParagraph[] {
    const style = element.style;
    const base = {
      fontFamily: String(style.fontFamily ?? dna.typography.fontFamily).trim(),
      fontSizePt: Number(style.fontSizePt) * scale,
      color: cleanPresentationHex(style.color ?? dna.palette.text),
      bold: style.bold === true,
      italic: style.italic === true,
      underline: style.underline === true,
      strike: style.strike === true,
      letterSpacingPt: finite(style.letterSpacingPt, 0) * scale,
    };
    const paragraphs: PresentationTextParagraph[] = Array.isArray(element.paragraphs)
      ? element.paragraphs
      : String(element.text ?? '').split(/\r?\n/).map((text) => ({ runs: [{ text }] }));
    return paragraphs.map((paragraph) => ({
      align: paragraph.align ?? style.align,
      lineHeight: Number(paragraph.lineHeight ?? style.lineHeight),
      runs: paragraph.runs.map((run) => ({
        text: String(run.text ?? ''),
        fontFamily: String(run.fontFamily ?? base.fontFamily).trim(),
        fontSizePt: Number(run.fontSizePt ?? base.fontSizePt) * (run.fontSizePt != null ? scale : 1),
        color: cleanPresentationHex(run.color ?? base.color),
        bold: run.bold ?? base.bold,
        italic: run.italic ?? base.italic,
        underline: run.underline ?? base.underline,
        strike: run.strike ?? base.strike,
        letterSpacingPt: finite(run.letterSpacingPt, base.letterSpacingPt) * (run.letterSpacingPt != null ? scale : 1),
      })),
    }));
  }

  private wrapParagraphs(paragraphs: SourceParagraph[], widthPt: number): ResolvedPresentationTextLine[] {
    const output: ResolvedPresentationTextLine[] = [];
    for (const paragraph of paragraphs) {
      const lines: ResolvedPresentationTextRun[][] = [];
      let current: ResolvedPresentationTextRun[] = [];
      let currentWidth = 0;
      const pushLine = () => {
        lines.push(current.length > 0 ? current : [{ ...paragraph.runs[0], text: '' }]);
        current = [];
        currentWidth = 0;
      };
      for (const sourceRun of paragraph.runs) {
        const text = String(sourceRun.text ?? '');
        if (text.length === 0) {
          if (current.length === 0) current.push({ ...sourceRun, text: '' });
          continue;
        }
        let segment = '';
        const flushSegment = () => {
          if (!segment) return;
          const segmentWidth = measurePresentationTextRunPt({ ...sourceRun, text: segment });
          if (current.length > 0 && currentWidth + segmentWidth > widthPt + 0.01) pushLine();
          if (segmentWidth <= widthPt + 0.01) {
            this.appendRun(current, sourceRun, segment);
            currentWidth += segmentWidth;
            segment = '';
            return;
          }
          for (const char of Array.from(segment)) {
            const charWidth = measurePresentationTextRunPt({ ...sourceRun, text: char });
            if (current.length > 0 && currentWidth + charWidth > widthPt + 0.01) pushLine();
            this.appendRun(current, sourceRun, char);
            currentWidth += charWidth;
          }
          segment = '';
        };
        for (const char of Array.from(text)) {
          if (char === '\n') {
            flushSegment();
            pushLine();
            continue;
          }
          segment += char;
          if (/\s/.test(char)) flushSegment();
        }
        flushSegment();
      }
      if (current.length > 0 || lines.length === 0) pushLine();
      lines.forEach((runs) => output.push({ runs, align: paragraph.align, lineHeight: paragraph.lineHeight }));
    }
    return output;
  }

  private appendRun(target: ResolvedPresentationTextRun[], source: ResolvedPresentationTextRun, text: string): void {
    const last = target[target.length - 1];
    if (last && this.sameRunStyle(last, source)) last.text += text;
    else target.push({ ...source, text });
  }

  private sameRunStyle(left: ResolvedPresentationTextRun, right: ResolvedPresentationTextRun): boolean {
    return left.fontFamily === right.fontFamily
      && Math.abs(left.fontSizePt - right.fontSizePt) < 0.001
      && left.color === right.color
      && left.bold === right.bold
      && left.italic === right.italic
      && left.underline === right.underline
      && left.strike === right.strike
      && Math.abs(left.letterSpacingPt - right.letterSpacingPt) < 0.001;
  }

  private intrinsicTextWidth(element: PresentationTextContent, options: ResolveOptions): number {
    const padding = normalizePresentationInsets(element.style.padding);
    const paragraphs = this.sourceParagraphs(element, options.designDNA, 1);
    const contentWidth = Math.max(1, ...paragraphs.map((paragraph) => paragraph.runs.reduce((sum, run) => sum + measurePresentationTextRunPt(run), 0)));
    const usable = Math.max(0.05, 1 - padding.left - padding.right);
    return contentWidth / (options.page.widthInch * 72 * usable);
  }

  private intrinsicTextHeight(element: PresentationTextContent, width: number, options: ResolveOptions): number {
    const padding = normalizePresentationInsets(element.style.padding);
    const paragraphs = this.sourceParagraphs(element, options.designDNA, 1);
    const lines = this.wrapParagraphs(paragraphs, this.innerWidthPt(width, padding, options.page));
    const contentHeight = this.textLinesHeightPt(lines);
    const usable = Math.max(0.05, 1 - padding.top - padding.bottom);
    return contentHeight / (options.page.heightInch * 72 * usable);
  }

  private innerWidthPt(width: number, padding: Required<{ left: number; right: number }>, page: PresentationPageSpec): number {
    return Math.max(1, width * page.widthInch * 72 * Math.max(0.05, 1 - padding.left - padding.right));
  }

  private textLinesFit(element: ResolvedPresentationTextElement, page: PresentationPageSpec): boolean {
    const heightPt = Math.max(1, element.frame.height * page.heightInch * 72 * Math.max(0.05, 1 - element.padding.top - element.padding.bottom));
    return this.textLinesHeightPt(element.lines) <= heightPt * 1.015;
  }

  private textLinesHeightPt(lines: ResolvedPresentationTextLine[]): number {
    return lines.reduce((sum, line) => {
      return sum + presentationTextLineHeightPt(line);
    }, 0);
  }

  private normalizeStroke(stroke: PresentationStroke | undefined): PresentationStroke | undefined {
    if (!stroke) return undefined;
    return {
      ...stroke,
      color: cleanPresentationHex(stroke.color),
      widthPt: Math.max(0, Number(stroke.widthPt)),
      opacity: clampUnit(stroke.opacity, 1),
      dash: stroke.dash,
    };
  }

  private normalizeShadow(shadow: PresentationShadow | undefined): PresentationShadow | undefined {
    if (!shadow) return undefined;
    return {
      ...shadow,
      color: cleanPresentationHex(shadow.color),
      opacity: clampUnit(shadow.opacity, 0),
      blurPt: Math.max(0, Number(shadow.blurPt)),
      offsetXPt: Number(shadow.offsetXPt),
      offsetYPt: Number(shadow.offsetYPt),
    };
  }

  private normalizePath(path: PresentationPathCommand[]): PresentationPathCommand[] {
    return path.map((command) => {
      if (command.type === 'close') return { type: 'close' };
      const next: Record<string, number | string> = { type: command.type };
      for (const [key, value] of Object.entries(command)) {
        if (key === 'type') continue;
        next[key] = clampUnit(value, 0);
      }
      return next as unknown as PresentationPathCommand;
    });
  }

  private checkFrame(
    frame: PresentationFrame,
    allowBleed: boolean,
    page: PresentationPageSpec,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) || frame.width < 0 || frame.height < 0) {
      diagnostics.push(this.error('PRESENTATION_FRAME_INVALID', 'Resolved frame contains invalid coordinates or size.', path));
      return;
    }
    const left = frame.x;
    const top = frame.y;
    const right = frame.x + frame.width;
    const bottom = frame.y + frame.height;
    if (allowBleed) {
      if (left < -MAX_BLEED_EXTENSION || top < -MAX_BLEED_EXTENSION || right > 1 + MAX_BLEED_EXTENSION || bottom > 1 + MAX_BLEED_EXTENSION) diagnostics.push(this.error('PRESENTATION_BLEED_EXCESSIVE', 'Bleed element extends excessively outside the slide canvas.', path, { frame }));
      return;
    }
    if (left < 0 || top < 0 || right > 1 || bottom > 1) {
      diagnostics.push(this.error('PRESENTATION_ELEMENT_OUT_OF_BOUNDS', 'Element extends outside the slide canvas.', path, { frame }));
      return;
    }
    const safeX = Math.min(0.05, ENGINEERING_EDGE_GUARD_INCH / Math.max(0.1, page.widthInch));
    const safeY = Math.min(0.05, ENGINEERING_EDGE_GUARD_INCH / Math.max(0.1, page.heightInch));
    if (left < safeX || top < safeY || right > 1 - safeX || bottom > 1 - safeY) diagnostics.push(this.error(
      'PRESENTATION_SAFE_AREA_VIOLATION',
      'Element enters the engineering edge guard. Mark intentional edge/bleed elements with allowBleed=true.',
      path,
      { frame, safeArea: { left: safeX, top: safeY, right: 1 - safeX, bottom: 1 - safeY } },
    ));
  }

  private checkOverlap(elements: ResolvedPresentationElement[], path: string, diagnostics: RenderPlanDiagnostic[]): void {
    for (let leftIndex = 0; leftIndex < elements.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < elements.length; rightIndex += 1) {
        const left = elements[leftIndex];
        const right = elements[rightIndex];
        if (left.type === 'line' || right.type === 'line' || left.allowOverlap || right.allowOverlap) continue;
        const ratio = this.overlapRatio(left.frame, right.frame);
        if (ratio <= 0.02) continue;
        diagnostics.push(this.error('PRESENTATION_UNDECLARED_OVERLAP', `Elements ${left.id} and ${right.id} overlap without allowOverlap=true.`, path, { leftId: left.id, rightId: right.id, overlapRatio: ratio }));
      }
    }
  }

  private overlapRatio(left: PresentationFrame, right: PresentationFrame): number {
    const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
    const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
    const intersection = width * height;
    if (intersection <= 0) return 0;
    const smaller = Math.min(left.width * left.height, right.width * right.height);
    return smaller > 0 ? intersection / smaller : 0;
  }

  private normalizeFill(fill: PresentationFill): PresentationFill {
    if (fill.type === 'solid') return { type: 'solid', color: cleanPresentationHex(fill.color), opacity: clampUnit(fill.opacity, 1) };
    return {
      type: 'linearGradient',
      angleDeg: Number(fill.angleDeg),
      stops: fill.stops.map((stop) => ({ offset: clampUnit(stop.offset, 0), color: cleanPresentationHex(stop.color), opacity: clampUnit(stop.opacity, 1) })).sort((left, right) => left.offset - right.offset),
    };
  }

  private backgroundFromDNA(dna: PresentationDesignDNA): PresentationFill {
    return { type: 'solid', color: cleanPresentationHex(dna.palette.background), opacity: 1 };
  }

  private bound(value: number, minimum?: number, maximum?: number): number {
    let output = value;
    if (minimum != null) output = Math.max(output, Number(minimum));
    if (maximum != null) output = Math.min(output, Number(maximum));
    return output;
  }

  private sortElements(elements: ResolvedPresentationElement[]): ResolvedPresentationElement[] {
    return elements
      .map((element, order) => ({ element, order }))
      .sort((left, right) => left.element.zIndex - right.element.zIndex || left.order - right.order)
      .map(({ element }) => element);
  }

  private optionalText(value: unknown): string | undefined {
    const text = String(value ?? '').trim();
    return text || undefined;
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private error(code: string, message: string, path?: string, detail?: Record<string, unknown>): RenderPlanDiagnostic {
    return { stage: 'compilation', code, message, path, severity: 'error', repairable: true, detail };
  }

  private info(code: string, message: string, path?: string, detail?: Record<string, unknown>): RenderPlanDiagnostic {
    return { stage: 'compilation', code, message, path, severity: 'info', repairable: false, detail };
  }
}
