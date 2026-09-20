import { Injectable } from '@nestjs/common';
import {
  failure,
  success,
  type RenderPlanDiagnostic,
  type RenderStageResult,
} from '../planning/core/render-plan-diagnostics.types';
import type {
  PresentationAdvancedElement,
  PresentationDesignDNA,
  PresentationDesignStudy,
  PresentationElementContent,
  PresentationFill,
  PresentationFrame,
  PresentationGroupChild,
  PresentationLayoutConstraint,
  PresentationMask,
  PresentationPathCommand,
  PresentationScene,
  PresentationSemanticElement,
  PresentationSlideSpec,
  PresentationTextParagraph,
  PresentationTextRun,
} from './presentation.types';

const SHAPES = new Set(['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'chevron', 'rightArrow', 'leftArrow']);
const DASHES = new Set(['solid', 'dash', 'dot', 'dashDot']);
const ARROWS = new Set(['none', 'triangle', 'stealth', 'diamond', 'oval']);
const EDGES = new Set(['left', 'right', 'top', 'bottom', 'centerX', 'centerY']);
const MAX_ELEMENTS_PER_SLIDE = 200;
const MAX_GROUP_CHILDREN = 100;
const MIN_READABLE_FONT_PT = 8;

@Injectable()
export class PresentationContractValidator {
  validateDesignStudy(value: unknown): RenderStageResult<PresentationDesignStudy> {
    const diagnostics: RenderPlanDiagnostic[] = [];
    if (!this.record(value)) {
      return failure([this.error('PRESENTATION_DESIGN_STUDY_REQUIRED', 'designStudy must be an object.', '$.designStudy')]);
    }
    const study = value as PresentationDesignStudy;
    if (!['researched', 'user_reference', 'mixed'].includes(String(study.source ?? ''))) {
      diagnostics.push(this.error('PRESENTATION_DESIGN_STUDY_SOURCE_INVALID', 'designStudy.source is invalid.', '$.designStudy.source'));
    }
    if (!Array.isArray(study.references)) {
      diagnostics.push(this.error('PRESENTATION_DESIGN_STUDY_REFERENCES_INVALID', 'designStudy.references must be an array.', '$.designStudy.references'));
    }
    if (!this.record(study.methods)) {
      diagnostics.push(this.error('PRESENTATION_DESIGN_STUDY_METHODS_INVALID', 'designStudy.methods must be an object.', '$.designStudy.methods'));
    }
    const methods = this.record(study.methods) ? study.methods : {};
    const methodValues = Object.values(methods as Record<string, unknown>)
      .filter(Array.isArray)
      .flatMap((items) => items as unknown[])
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
    const constraints = Array.isArray(study.constraints) ? study.constraints.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
    const avoid = Array.isArray(study.avoid) ? study.avoid.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
    if (methodValues.length === 0 && constraints.length === 0 && avoid.length === 0) {
      diagnostics.push(this.error(
        'PRESENTATION_DESIGN_STUDY_EMPTY',
        'designStudy must contain at least one learned method, constraint, or avoid item.',
        '$.designStudy',
      ));
    }
    return diagnostics.some((item) => item.severity === 'error')
      ? failure(diagnostics)
      : success(this.clone(study), diagnostics);
  }

  validateDesignDNA(value: unknown): RenderStageResult<PresentationDesignDNA> {
    if (value == null) return failure([this.error('PRESENTATION_DESIGN_DNA_REQUIRED', 'designDNA is required.', '$.designDNA')]);
    const diagnostics: RenderPlanDiagnostic[] = [];
    if (!this.record(value)) {
      return failure([this.error('PRESENTATION_DESIGN_DNA_INVALID', 'designDNA must be an object.', '$.designDNA')]);
    }
    const dna = value as PresentationDesignDNA;
    if (!dna.palette || !dna.typography) {
      diagnostics.push(this.error('PRESENTATION_DESIGN_DNA_CORE_REQUIRED', 'designDNA.palette and designDNA.typography are required.', '$.designDNA'));
    }
    if (!String(dna.palette?.background ?? '').trim() || !String(dna.palette?.text ?? '').trim()) {
      diagnostics.push(this.error('PRESENTATION_DESIGN_DNA_PALETTE_REQUIRED', 'designDNA.palette.background and designDNA.palette.text are required.', '$.designDNA.palette'));
    }
    if (!String(dna.typography?.fontFamily ?? '').trim()) {
      diagnostics.push(this.error('PRESENTATION_DESIGN_DNA_FONT_REQUIRED', 'designDNA.typography.fontFamily is required.', '$.designDNA.typography.fontFamily'));
    }
    if (dna.palette) {
      if (dna.palette.background != null) this.validateColor(dna.palette.background, '$.designDNA.palette.background', diagnostics);
      if (dna.palette.text != null) this.validateColor(dna.palette.text, '$.designDNA.palette.text', diagnostics);
      if (dna.palette.accents != null) {
        if (!Array.isArray(dna.palette.accents)) diagnostics.push(this.error('PRESENTATION_DESIGN_DNA_ACCENTS_INVALID', 'designDNA.palette.accents must be an array.', '$.designDNA.palette.accents'));
        else dna.palette.accents.forEach((color, index) => this.validateColor(color, `$.designDNA.palette.accents[${index}]`, diagnostics));
      }
    }
    return diagnostics.some((item) => item.severity === 'error')
      ? failure(diagnostics)
      : success(this.clone(dna), diagnostics);
  }

  validateSlide(
    value: unknown,
    options: { designDNA: PresentationDesignDNA },
  ): RenderStageResult<PresentationSlideSpec> {
    const diagnostics: RenderPlanDiagnostic[] = [];
    if (!this.record(value)) return failure([this.error('PRESENTATION_SLIDE_INVALID', 'Slide must be an object.', '$.slide')]);
    const slide = value as PresentationSlideSpec;
    if (!String(slide.id ?? '').trim()) diagnostics.push(this.error('PRESENTATION_SLIDE_ID_REQUIRED', 'Slide id is required.', '$.slide.id'));
    if (slide.background != null) this.validateFill(slide.background, '$.slide.background', diagnostics);
    this.validateScene(slide.scene, options.designDNA, diagnostics);
    return diagnostics.some((item) => item.severity === 'error')
      ? failure(diagnostics)
      : success(this.clone(slide), diagnostics);
  }

  private validateScene(
    scene: PresentationScene,
    dna: PresentationDesignDNA,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!this.record(scene) || !['semantic', 'advanced'].includes(String(scene.mode ?? ''))) {
      diagnostics.push(this.error('PRESENTATION_SCENE_INVALID', 'scene.mode must be semantic or advanced.', '$.slide.scene'));
      return;
    }
    if (!Array.isArray(scene.elements) || scene.elements.length === 0) {
      diagnostics.push(this.error('PRESENTATION_SCENE_ELEMENTS_REQUIRED', 'scene.elements must contain at least one element.', '$.slide.scene.elements'));
      return;
    }
    if (scene.elements.length > MAX_ELEMENTS_PER_SLIDE) diagnostics.push(this.error('PRESENTATION_ELEMENT_LIMIT', `A slide cannot exceed ${MAX_ELEMENTS_PER_SLIDE} elements.`, '$.slide.scene.elements', false));

    const ids = new Set<string>();
    scene.elements.slice(0, MAX_ELEMENTS_PER_SLIDE).forEach((element, index) => {
      const path = `$.slide.scene.elements[${index}]`;
      this.validateElement(element as PresentationElementContent, path, dna, diagnostics);
      const id = String(element?.id ?? '').trim();
      if (id && ids.has(id)) diagnostics.push(this.error('PRESENTATION_DUPLICATE_ELEMENT_ID', `Duplicate element id: ${id}.`, `${path}.id`));
      if (id) ids.add(id);
      if (scene.mode === 'semantic') this.validateSemanticGeometry(element as PresentationSemanticElement, path, diagnostics);
      else this.validateAdvancedGeometry(element as PresentationAdvancedElement, path, diagnostics);
    });

    if (scene.mode === 'semantic') {
      if (!Array.isArray(scene.constraints)) {
        diagnostics.push(this.error('PRESENTATION_CONSTRAINTS_REQUIRED', 'Semantic scene constraints must be an array.', '$.slide.scene.constraints'));
        return;
      }
      scene.constraints.forEach((constraint, index) => this.validateConstraint(constraint, ids, `$.slide.scene.constraints[${index}]`, diagnostics));
    }
  }

  private validateElement(
    element: PresentationElementContent,
    path: string,
    dna: PresentationDesignDNA,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!this.record(element)) {
      diagnostics.push(this.error('PRESENTATION_ELEMENT_INVALID', 'Element must be an object.', path));
      return;
    }
    if (!String(element.id ?? '').trim()) diagnostics.push(this.error('PRESENTATION_ELEMENT_ID_REQUIRED', 'Element id is required.', `${path}.id`));
    if (element.opacity != null && !this.range(element.opacity, 0, 1)) diagnostics.push(this.error('PRESENTATION_OPACITY_INVALID', 'opacity must be between 0 and 1.', `${path}.opacity`));
    if (element.rotationDeg != null && !Number.isFinite(Number(element.rotationDeg))) diagnostics.push(this.error('PRESENTATION_ROTATION_INVALID', 'rotationDeg must be finite.', `${path}.rotationDeg`));

    if (element.type === 'text') {
      this.validateText(element, path, dna, diagnostics);
      return;
    }
    if (element.type === 'shape') {
      if (!SHAPES.has(String(element.shape ?? ''))) diagnostics.push(this.error('PRESENTATION_SHAPE_INVALID', 'shape is invalid.', `${path}.shape`));
      this.validatePaint(element, path, diagnostics);
      return;
    }
    if (element.type === 'freeform') {
      this.validatePath(element.path, `${path}.path`, diagnostics);
      this.validatePaint(element, path, diagnostics);
      return;
    }
    if (element.type === 'line') {
      this.validateColor(element.color, `${path}.color`, diagnostics);
      if (!this.positive(element.widthPt)) diagnostics.push(this.error('PRESENTATION_LINE_WIDTH_INVALID', 'widthPt must be greater than zero.', `${path}.widthPt`));
      if (!DASHES.has(String(element.dash ?? ''))) diagnostics.push(this.error('PRESENTATION_LINE_DASH_INVALID', 'dash is invalid.', `${path}.dash`));
      if (!ARROWS.has(String(element.startArrow ?? '')) || !ARROWS.has(String(element.endArrow ?? ''))) diagnostics.push(this.error('PRESENTATION_LINE_ARROW_INVALID', 'Line arrow value is invalid.', path));
      return;
    }
    if (element.type === 'image') {
      if (!String(element.objectId ?? '').trim() && !String(element.dataBase64 ?? '').trim()) diagnostics.push(this.error('PRESENTATION_IMAGE_SOURCE_REQUIRED', 'Image requires objectId or dataBase64.', path));
      if (!['contain', 'cover'].includes(String(element.fit ?? ''))) diagnostics.push(this.error('PRESENTATION_IMAGE_FIT_INVALID', 'Image fit must be contain or cover.', `${path}.fit`));
      if (element.focalPoint && (!this.range(element.focalPoint.x, 0, 1) || !this.range(element.focalPoint.y, 0, 1))) diagnostics.push(this.error('PRESENTATION_IMAGE_FOCAL_POINT_INVALID', 'Image focalPoint coordinates must be between 0 and 1.', `${path}.focalPoint`));
      if (element.mask) this.validateMask(element.mask, `${path}.mask`, diagnostics);
      return;
    }
    if (element.type === 'svg') {
      const svg = String(element.svg ?? '').trim();
      if (!/^<svg\b/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) diagnostics.push(this.error('PRESENTATION_SVG_INVALID', 'svg must contain one complete SVG root element.', `${path}.svg`));
      if (/<script\b|<foreignObject\b|\bon(?:load|error|click|mouseover)\s*=|(?:href|xlink:href)\s*=\s*["'](?:https?:|file:|javascript:)/i.test(svg)) {
        diagnostics.push(this.error('PRESENTATION_SVG_UNSAFE', 'svg cannot contain scripts, foreignObject, event handlers, or external references.', `${path}.svg`, false));
      }
      if (element.mask) this.validateMask(element.mask, `${path}.mask`, diagnostics);
      return;
    }
    if (element.type === 'group') {
      if (!Array.isArray(element.children) || element.children.length === 0) {
        diagnostics.push(this.error('PRESENTATION_GROUP_CHILDREN_REQUIRED', 'group.children must contain at least one child.', `${path}.children`));
        return;
      }
      if (element.children.length > MAX_GROUP_CHILDREN) diagnostics.push(this.error('PRESENTATION_GROUP_CHILD_LIMIT', `A group cannot exceed ${MAX_GROUP_CHILDREN} children.`, `${path}.children`, false));
      const ids = new Set<string>();
      element.children.slice(0, MAX_GROUP_CHILDREN).forEach((child, index) => {
        const childPath = `${path}.children[${index}]`;
        this.validateElement(child, childPath, dna, diagnostics);
        this.validateGroupChildGeometry(child, childPath, diagnostics);
        const childId = String(child.id ?? '').trim();
        if (childId && ids.has(childId)) diagnostics.push(this.error('PRESENTATION_GROUP_DUPLICATE_CHILD_ID', `Duplicate child id: ${childId}.`, `${childPath}.id`));
        if (childId) ids.add(childId);
      });
      return;
    }
    diagnostics.push(this.error('PRESENTATION_ELEMENT_TYPE_INVALID', 'Element type is invalid.', `${path}.type`));
  }

  private validateText(
    element: Extract<PresentationElementContent, { type: 'text' }>,
    path: string,
    dna: PresentationDesignDNA,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (element.text == null && !Array.isArray(element.paragraphs)) diagnostics.push(this.error('PRESENTATION_TEXT_CONTENT_REQUIRED', 'Text requires text or paragraphs.', path));
    if (element.text != null && typeof element.text !== 'string') diagnostics.push(this.error('PRESENTATION_TEXT_INVALID', 'text must be a string.', `${path}.text`));
    if (element.paragraphs != null) {
      if (!Array.isArray(element.paragraphs) || element.paragraphs.length === 0) diagnostics.push(this.error('PRESENTATION_TEXT_PARAGRAPHS_INVALID', 'paragraphs must contain at least one paragraph.', `${path}.paragraphs`));
      else element.paragraphs.forEach((paragraph, index) => this.validateParagraph(paragraph, `${path}.paragraphs[${index}]`, dna, element.style, diagnostics));
    }
    if (!this.record(element.style)) {
      diagnostics.push(this.error('PRESENTATION_TEXT_STYLE_REQUIRED', 'Text style is required.', `${path}.style`));
      return;
    }
    const style = element.style;
    if (!this.positive(style.fontSizePt)) diagnostics.push(this.error('PRESENTATION_FONT_SIZE_INVALID', 'fontSizePt must be greater than zero.', `${path}.style.fontSizePt`));
    if (this.positive(style.fontSizePt) && Number(style.fontSizePt) < MIN_READABLE_FONT_PT) diagnostics.push(this.error('PRESENTATION_FONT_UNREADABLE', `fontSizePt must be at least ${MIN_READABLE_FONT_PT}pt.`, `${path}.style.fontSizePt`, false));
    if (style.minFontSizePt != null && (!this.positive(style.minFontSizePt) || Number(style.minFontSizePt) < MIN_READABLE_FONT_PT)) diagnostics.push(this.error('PRESENTATION_MIN_FONT_SIZE_INVALID', `minFontSizePt must be at least ${MIN_READABLE_FONT_PT}pt.`, `${path}.style.minFontSizePt`, false));
    if (!['left', 'center', 'right'].includes(String(style.align ?? ''))) diagnostics.push(this.error('PRESENTATION_TEXT_ALIGN_INVALID', 'Text align is invalid.', `${path}.style.align`));
    if (!['top', 'middle', 'bottom'].includes(String(style.verticalAlign ?? ''))) diagnostics.push(this.error('PRESENTATION_TEXT_VERTICAL_ALIGN_INVALID', 'Text verticalAlign is invalid.', `${path}.style.verticalAlign`));
    if (!this.positive(style.lineHeight)) diagnostics.push(this.error('PRESENTATION_LINE_HEIGHT_INVALID', 'lineHeight must be greater than zero.', `${path}.style.lineHeight`));
    if (style.color != null) this.validateColor(style.color, `${path}.style.color`, diagnostics);
    if (style.fontFamily != null && !String(style.fontFamily).trim()) diagnostics.push(this.error('PRESENTATION_FONT_FAMILY_INVALID', 'fontFamily must be non-empty.', `${path}.style.fontFamily`));
    if (!String(style.fontFamily ?? dna.typography.fontFamily).trim()) diagnostics.push(this.error('PRESENTATION_FONT_FAMILY_REQUIRED', 'Text requires a font family.', `${path}.style.fontFamily`));
    if (style.letterSpacingPt != null && !Number.isFinite(Number(style.letterSpacingPt))) diagnostics.push(this.error('PRESENTATION_LETTER_SPACING_INVALID', 'letterSpacingPt must be finite.', `${path}.style.letterSpacingPt`));
    if (style.fill) this.validateFill(style.fill, `${path}.style.fill`, diagnostics);
  }

  private validateParagraph(
    paragraph: PresentationTextParagraph,
    path: string,
    dna: PresentationDesignDNA,
    baseStyle: Extract<PresentationElementContent, { type: 'text' }>['style'],
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!this.record(paragraph) || !Array.isArray(paragraph.runs) || paragraph.runs.length === 0) {
      diagnostics.push(this.error('PRESENTATION_TEXT_PARAGRAPH_INVALID', 'Paragraph must contain at least one run.', path));
      return;
    }
    if (paragraph.align != null && !['left', 'center', 'right'].includes(String(paragraph.align))) diagnostics.push(this.error('PRESENTATION_TEXT_PARAGRAPH_ALIGN_INVALID', 'Paragraph align is invalid.', `${path}.align`));
    if (paragraph.lineHeight != null && !this.positive(paragraph.lineHeight)) diagnostics.push(this.error('PRESENTATION_TEXT_PARAGRAPH_LINE_HEIGHT_INVALID', 'Paragraph lineHeight must be greater than zero.', `${path}.lineHeight`));
    paragraph.runs.forEach((run, index) => this.validateRun(run, `${path}.runs[${index}]`, dna, baseStyle, diagnostics));
  }

  private validateRun(
    run: PresentationTextRun,
    path: string,
    dna: PresentationDesignDNA,
    baseStyle: Extract<PresentationElementContent, { type: 'text' }>['style'],
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!this.record(run) || typeof run.text !== 'string') {
      diagnostics.push(this.error('PRESENTATION_TEXT_RUN_INVALID', 'Text run must contain string text.', path));
      return;
    }
    if (run.fontSizePt != null && (!this.positive(run.fontSizePt) || Number(run.fontSizePt) < MIN_READABLE_FONT_PT)) diagnostics.push(this.error('PRESENTATION_TEXT_RUN_FONT_SIZE_INVALID', `Run fontSizePt must be at least ${MIN_READABLE_FONT_PT}pt.`, `${path}.fontSizePt`, false));
    if (run.color != null) this.validateColor(run.color, `${path}.color`, diagnostics);
    if (run.fontFamily != null && !String(run.fontFamily).trim()) diagnostics.push(this.error('PRESENTATION_TEXT_RUN_FONT_INVALID', 'Run fontFamily must be non-empty.', `${path}.fontFamily`));
    if (!String(run.fontFamily ?? baseStyle.fontFamily ?? dna.typography.fontFamily).trim()) diagnostics.push(this.error('PRESENTATION_TEXT_RUN_FONT_REQUIRED', 'Text run requires a font family.', `${path}.fontFamily`));
    if (run.letterSpacingPt != null && !Number.isFinite(Number(run.letterSpacingPt))) diagnostics.push(this.error('PRESENTATION_TEXT_RUN_LETTER_SPACING_INVALID', 'Run letterSpacingPt must be finite.', `${path}.letterSpacingPt`));
  }

  private validatePaint(
    element: Extract<PresentationElementContent, { type: 'shape' | 'freeform' }>,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (element.fill) this.validateFill(element.fill, `${path}.fill`, diagnostics);
    if (element.stroke) {
      this.validateColor(element.stroke.color, `${path}.stroke.color`, diagnostics);
      if (!this.nonNegative(element.stroke.widthPt)) diagnostics.push(this.error('PRESENTATION_STROKE_WIDTH_INVALID', 'stroke.widthPt must be non-negative.', `${path}.stroke.widthPt`));
      if (element.stroke.opacity != null && !this.range(element.stroke.opacity, 0, 1)) diagnostics.push(this.error('PRESENTATION_STROKE_OPACITY_INVALID', 'stroke.opacity must be between 0 and 1.', `${path}.stroke.opacity`));
      if (!DASHES.has(String(element.stroke.dash ?? ''))) diagnostics.push(this.error('PRESENTATION_STROKE_DASH_INVALID', 'stroke.dash is invalid.', `${path}.stroke.dash`));
    }
    if (element.shadow) {
      this.validateColor(element.shadow.color, `${path}.shadow.color`, diagnostics);
      if (!this.range(element.shadow.opacity, 0, 1)) diagnostics.push(this.error('PRESENTATION_SHADOW_OPACITY_INVALID', 'shadow.opacity must be between 0 and 1.', `${path}.shadow.opacity`));
      if (!this.nonNegative(element.shadow.blurPt)) diagnostics.push(this.error('PRESENTATION_SHADOW_BLUR_INVALID', 'shadow.blurPt must be non-negative.', `${path}.shadow.blurPt`));
      if (!Number.isFinite(Number(element.shadow.offsetXPt)) || !Number.isFinite(Number(element.shadow.offsetYPt))) diagnostics.push(this.error('PRESENTATION_SHADOW_OFFSET_INVALID', 'shadow offsets must be finite numbers.', `${path}.shadow`));
    }
  }

  private validatePath(pathValue: PresentationPathCommand[], path: string, diagnostics: RenderPlanDiagnostic[]): void {
    if (!Array.isArray(pathValue) || pathValue.length < 2) {
      diagnostics.push(this.error('PRESENTATION_PATH_INVALID', 'Freeform path must contain at least two commands.', path));
      return;
    }
    if (pathValue[0]?.type !== 'moveTo') diagnostics.push(this.error('PRESENTATION_PATH_START_INVALID', 'Freeform path must start with moveTo.', `${path}[0]`));
    pathValue.forEach((command, index) => {
      if (!this.record(command) || !['moveTo', 'lineTo', 'cubicTo', 'quadraticTo', 'close'].includes(String(command.type ?? ''))) {
        diagnostics.push(this.error('PRESENTATION_PATH_COMMAND_INVALID', 'Freeform path command is invalid.', `${path}[${index}]`));
        return;
      }
      for (const [key, value] of Object.entries(command)) {
        if (key === 'type') continue;
        if (!this.range(value, 0, 1)) diagnostics.push(this.error('PRESENTATION_PATH_COORDINATE_INVALID', 'Freeform path coordinates must be normalized between 0 and 1.', `${path}[${index}].${key}`));
      }
    });
  }

  private validateMask(mask: PresentationMask, path: string, diagnostics: RenderPlanDiagnostic[]): void {
    if (!this.record(mask) || !['rect', 'ellipse', 'roundRect', 'freeform'].includes(String(mask.type ?? ''))) {
      diagnostics.push(this.error('PRESENTATION_MASK_INVALID', 'Mask type is invalid.', path));
      return;
    }
    if (mask.type === 'roundRect' && !this.range(mask.radius, Number.EPSILON, 0.5)) diagnostics.push(this.error('PRESENTATION_MASK_RADIUS_INVALID', 'roundRect mask radius must be within (0, 0.5].', `${path}.radius`));
    if (mask.type === 'freeform') this.validatePath(mask.path, `${path}.path`, diagnostics);
  }

  private validateSemanticGeometry(element: PresentationSemanticElement, path: string, diagnostics: RenderPlanDiagnostic[]): void {
    if (element.sizing == null) return;
    if (!this.record(element.sizing)) {
      diagnostics.push(this.error('PRESENTATION_SIZING_INVALID', 'sizing must be an object.', `${path}.sizing`));
      return;
    }
    const sizing = element.sizing;
    for (const key of ['width', 'height', 'maxWidth', 'maxHeight', 'aspectRatio'] as const) {
      if (sizing[key] != null && !this.positive(sizing[key])) diagnostics.push(this.error('PRESENTATION_SIZING_VALUE_INVALID', `${key} must be greater than zero.`, `${path}.sizing.${key}`));
    }
    for (const key of ['minWidth', 'minHeight'] as const) {
      if (sizing[key] != null && !this.nonNegative(sizing[key])) diagnostics.push(this.error('PRESENTATION_SIZING_VALUE_INVALID', `${key} must be non-negative.`, `${path}.sizing.${key}`));
    }
    if (sizing.minWidth != null && sizing.maxWidth != null && Number(sizing.minWidth) > Number(sizing.maxWidth)) diagnostics.push(this.error('PRESENTATION_SIZING_RANGE_INVALID', 'minWidth cannot exceed maxWidth.', `${path}.sizing`));
    if (sizing.minHeight != null && sizing.maxHeight != null && Number(sizing.minHeight) > Number(sizing.maxHeight)) diagnostics.push(this.error('PRESENTATION_SIZING_RANGE_INVALID', 'minHeight cannot exceed maxHeight.', `${path}.sizing`));
    if (sizing.fitContent != null && !['width', 'height', 'both'].includes(String(sizing.fitContent))) diagnostics.push(this.error('PRESENTATION_FIT_CONTENT_INVALID', 'fitContent is invalid.', `${path}.sizing.fitContent`));
    if (sizing.fitContent != null && element.type !== 'text') diagnostics.push(this.error('PRESENTATION_FIT_CONTENT_TYPE_INVALID', 'fitContent is only valid for text elements.', `${path}.sizing.fitContent`));
  }

  private validateConstraint(
    constraint: PresentationLayoutConstraint,
    ids: Set<string>,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!this.record(constraint) || !['anchor', 'edge', 'matchSize', 'distribute'].includes(String(constraint.type ?? ''))) {
      diagnostics.push(this.error('PRESENTATION_CONSTRAINT_INVALID', 'Constraint type is invalid.', path));
      return;
    }
    const requireId = (id: unknown, idPath: string) => {
      const value = String(id ?? '').trim();
      if (!value || !ids.has(value)) diagnostics.push(this.error('PRESENTATION_CONSTRAINT_TARGET_INVALID', `Constraint references unknown element: ${value || '(empty)'}.`, idPath));
      return value;
    };

    if (constraint.type === 'anchor') {
      requireId(constraint.target, `${path}.target`);
      if (!['left', 'center', 'right'].includes(String(constraint.horizontal)) || !['top', 'center', 'bottom'].includes(String(constraint.vertical))) diagnostics.push(this.error('PRESENTATION_ANCHOR_CONSTRAINT_INVALID', 'Anchor horizontal/vertical values are invalid.', path));
      return;
    }
    if (constraint.type === 'edge') {
      const target = requireId(constraint.target, `${path}.target`);
      if (!EDGES.has(String(constraint.edge))) diagnostics.push(this.error('PRESENTATION_EDGE_CONSTRAINT_INVALID', 'edge is invalid.', `${path}.edge`));
      if (constraint.to != null) {
        const to = requireId(constraint.to, `${path}.to`);
        if (target && to && target === to) diagnostics.push(this.error('PRESENTATION_CONSTRAINT_SELF_REFERENCE', 'An edge constraint cannot reference the same element.', path));
      }
      if (constraint.toEdge != null && !EDGES.has(String(constraint.toEdge))) diagnostics.push(this.error('PRESENTATION_EDGE_CONSTRAINT_INVALID', 'toEdge is invalid.', `${path}.toEdge`));
      const sourceEdge = String(constraint.edge);
      const targetEdge = String(constraint.toEdge ?? constraint.edge);
      if (this.edgeAxis(sourceEdge) !== this.edgeAxis(targetEdge)) diagnostics.push(this.error('PRESENTATION_EDGE_AXIS_MISMATCH', 'edge and toEdge must use the same axis.', path));
      return;
    }
    if (constraint.type === 'matchSize') {
      const target = requireId(constraint.target, `${path}.target`);
      const to = requireId(constraint.to, `${path}.to`);
      if (target && to && target === to) diagnostics.push(this.error('PRESENTATION_CONSTRAINT_SELF_REFERENCE', 'matchSize cannot reference the same element.', path));
      if (!['width', 'height', 'both'].includes(String(constraint.axis))) diagnostics.push(this.error('PRESENTATION_MATCH_SIZE_AXIS_INVALID', 'matchSize.axis is invalid.', `${path}.axis`));
      return;
    }
    if (constraint.type === 'distribute') {
      if (!Array.isArray(constraint.targets) || constraint.targets.length < 2) diagnostics.push(this.error('PRESENTATION_DISTRIBUTE_TARGETS_INVALID', 'distribute requires at least two targets.', `${path}.targets`));
      else {
        const unique = new Set<string>();
        constraint.targets.forEach((target, index) => {
          const id = requireId(target, `${path}.targets[${index}]`);
          if (id && unique.has(id)) diagnostics.push(this.error('PRESENTATION_DISTRIBUTE_DUPLICATE_TARGET', `Duplicate distribute target: ${id}.`, `${path}.targets[${index}]`));
          if (id) unique.add(id);
        });
      }
      if (!['horizontal', 'vertical'].includes(String(constraint.axis))) diagnostics.push(this.error('PRESENTATION_DISTRIBUTE_AXIS_INVALID', 'distribute.axis is invalid.', `${path}.axis`));
      if (!Number.isFinite(Number(constraint.start)) || !Number.isFinite(Number(constraint.end)) || Number(constraint.end) <= Number(constraint.start)) diagnostics.push(this.error('PRESENTATION_DISTRIBUTE_RANGE_INVALID', 'distribute start/end must be finite with end greater than start.', path));
      if (constraint.gap != null && !this.nonNegative(constraint.gap)) diagnostics.push(this.error('PRESENTATION_DISTRIBUTE_GAP_INVALID', 'distribute.gap must be non-negative.', `${path}.gap`));
    }
  }

  private validateAdvancedGeometry(element: PresentationAdvancedElement, path: string, diagnostics: RenderPlanDiagnostic[]): void {
    if (!this.record(element.frame)) {
      diagnostics.push(this.error('PRESENTATION_FRAME_REQUIRED', 'Advanced elements require frame.', `${path}.frame`));
      return;
    }
    this.validateFrame(element.frame, `${path}.frame`, diagnostics);
  }

  private validateGroupChildGeometry(element: PresentationGroupChild, path: string, diagnostics: RenderPlanDiagnostic[]): void {
    if (!this.record(element.frame)) {
      diagnostics.push(this.error('PRESENTATION_GROUP_CHILD_FRAME_REQUIRED', 'Group children require frame.', `${path}.frame`));
      return;
    }
    this.validateFrame(element.frame, `${path}.frame`, diagnostics);
    const frame = element.frame;
    if (frame.x < 0 || frame.y < 0 || frame.x + frame.width > 1 || frame.y + frame.height > 1) diagnostics.push(this.error('PRESENTATION_GROUP_CHILD_OUT_OF_BOUNDS', 'Group child frame must stay within the normalized group coordinate space.', `${path}.frame`));
  }

  private validateFrame(frame: PresentationFrame, path: string, diagnostics: RenderPlanDiagnostic[]): void {
    if (![frame.x, frame.y, frame.width, frame.height].every((value) => Number.isFinite(Number(value)))) {
      diagnostics.push(this.error('PRESENTATION_FRAME_INVALID', 'Frame values must be finite numbers.', path));
      return;
    }
    if (frame.width < 0 || frame.height < 0) diagnostics.push(this.error('PRESENTATION_FRAME_SIZE_INVALID', 'Frame width and height must be non-negative.', path));
  }

  private validateFill(fill: PresentationFill, path: string, diagnostics: RenderPlanDiagnostic[]): void {
    if (!this.record(fill)) {
      diagnostics.push(this.error('PRESENTATION_FILL_INVALID', 'Fill must be an object.', path));
      return;
    }
    if (fill.type === 'solid') {
      this.validateColor(fill.color, `${path}.color`, diagnostics);
      if (fill.opacity != null && !this.range(fill.opacity, 0, 1)) diagnostics.push(this.error('PRESENTATION_FILL_OPACITY_INVALID', 'Fill opacity must be between 0 and 1.', `${path}.opacity`));
      return;
    }
    if (fill.type === 'linearGradient') {
      if (!Number.isFinite(Number(fill.angleDeg))) diagnostics.push(this.error('PRESENTATION_GRADIENT_ANGLE_INVALID', 'Gradient angleDeg must be a finite number.', `${path}.angleDeg`));
      if (!Array.isArray(fill.stops) || fill.stops.length < 2) diagnostics.push(this.error('PRESENTATION_GRADIENT_STOPS_INVALID', 'Gradient requires at least two stops.', `${path}.stops`));
      else fill.stops.forEach((stop, index) => {
        if (!this.range(stop.offset, 0, 1)) diagnostics.push(this.error('PRESENTATION_GRADIENT_OFFSET_INVALID', 'Gradient offset must be between 0 and 1.', `${path}.stops[${index}].offset`));
        this.validateColor(stop.color, `${path}.stops[${index}].color`, diagnostics);
        if (stop.opacity != null && !this.range(stop.opacity, 0, 1)) diagnostics.push(this.error('PRESENTATION_GRADIENT_OPACITY_INVALID', 'Gradient opacity must be between 0 and 1.', `${path}.stops[${index}].opacity`));
      });
      return;
    }
    diagnostics.push(this.error('PRESENTATION_FILL_TYPE_INVALID', 'Fill type is invalid.', `${path}.type`));
  }

  private edgeAxis(edge: string): 'x' | 'y' | 'invalid' {
    if (['left', 'right', 'centerX'].includes(edge)) return 'x';
    if (['top', 'bottom', 'centerY'].includes(edge)) return 'y';
    return 'invalid';
  }

  private validateColor(value: unknown, path: string, diagnostics: RenderPlanDiagnostic[]): void {
    if (!/^#?[0-9a-fA-F]{6}$/.test(String(value ?? '').trim())) diagnostics.push(this.error('PRESENTATION_COLOR_INVALID', 'Color must be a six-digit hex value.', path));
  }

  private record(value: unknown): value is Record<string, any> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  private positive(value: unknown): boolean {
    const number = Number(value);
    return Number.isFinite(number) && number > 0;
  }

  private nonNegative(value: unknown): boolean {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0;
  }

  private range(value: unknown, minimum: number, maximum: number): boolean {
    const number = Number(value);
    return Number.isFinite(number) && number >= minimum && number <= maximum;
  }

  private error(
    code: string,
    message: string,
    path?: string,
    repairable = true,
  ): RenderPlanDiagnostic {
    return { stage: 'validation', code, message, path, severity: 'error', repairable };
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
