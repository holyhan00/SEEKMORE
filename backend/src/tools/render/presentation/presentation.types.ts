export interface PresentationFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PresentationInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export type PresentationSpacing = number | PresentationInsets;

export interface PresentationSolidFill {
  type: 'solid';
  color: string;
  opacity?: number;
}

export interface PresentationGradientStop {
  offset: number;
  color: string;
  opacity?: number;
}

export interface PresentationLinearGradientFill {
  type: 'linearGradient';
  angleDeg: number;
  stops: PresentationGradientStop[];
}

export type PresentationFill = PresentationSolidFill | PresentationLinearGradientFill;

export interface PresentationStroke {
  color: string;
  widthPt: number;
  opacity?: number;
  dash: 'solid' | 'dash' | 'dot' | 'dashDot';
}

export interface PresentationShadow {
  color: string;
  opacity: number;
  blurPt: number;
  offsetXPt: number;
  offsetYPt: number;
}

export interface PresentationDesignStudy {
  source: 'researched' | 'user_reference' | 'mixed';
  references: Array<{
    title?: string;
    url?: string;
    objectId?: string;
    kind?: 'brand' | 'presentation' | 'visual' | 'document' | 'other';
  }>;
  methods: {
    composition?: string[];
    hierarchy?: string[];
    typography?: string[];
    whitespace?: string[];
    imagery?: string[];
    dataVisualization?: string[];
    deckRhythm?: string[];
  };
  constraints?: string[];
  avoid?: string[];
}

export interface PresentationDesignDNA {
  palette: {
    background: string;
    text: string;
    accents?: string[];
  };
  typography: {
    fontFamily: string;
  };
  visualLanguage?: string[];
  imageLanguage?: string[];
  constraints?: string[];
}

export type PresentationSlideGrammar =
  | 'hero'
  | 'statement'
  | 'section'
  | 'split'
  | 'comparison'
  | 'flow'
  | 'metrics'
  | 'data_story'
  | 'grid'
  | 'gallery'
  | 'closing'
  | 'custom';

export interface PresentationSlideDesignIntent {
  grammar?: PresentationSlideGrammar;
  density?: 'low' | 'medium' | 'high';
  visualWeight?: 'text' | 'balanced' | 'visual' | 'data';
  composition?: string;
}

export interface PresentationPageSpec {
  widthInch: number;
  heightInch: number;
}

export interface PresentationElementBase {
  id: string;
  opacity?: number;
  rotationDeg?: number;
  zIndex?: number;
  allowOverlap?: boolean;
  allowBleed?: boolean;
}

export interface PresentationTextRun {
  text: string;
  fontFamily?: string;
  fontSizePt?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  letterSpacingPt?: number;
}

export interface PresentationTextParagraph {
  runs: PresentationTextRun[];
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
}

export interface PresentationTextStyle {
  fontFamily?: string;
  fontSizePt: number;
  minFontSizePt?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  letterSpacingPt?: number;
  align: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  padding?: PresentationSpacing;
  fill?: PresentationFill;
  fit?: 'shrink' | 'clip';
}

export type PresentationShapeType =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'hexagon'
  | 'chevron'
  | 'rightArrow'
  | 'leftArrow';

export interface PresentationPathMoveTo {
  type: 'moveTo';
  x: number;
  y: number;
}

export interface PresentationPathLineTo {
  type: 'lineTo';
  x: number;
  y: number;
}

export interface PresentationPathCubicTo {
  type: 'cubicTo';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x: number;
  y: number;
}

export interface PresentationPathQuadraticTo {
  type: 'quadraticTo';
  x1: number;
  y1: number;
  x: number;
  y: number;
}

export interface PresentationPathClose {
  type: 'close';
}

export type PresentationPathCommand =
  | PresentationPathMoveTo
  | PresentationPathLineTo
  | PresentationPathCubicTo
  | PresentationPathQuadraticTo
  | PresentationPathClose;

export type PresentationMask =
  | { type: 'rect' }
  | { type: 'ellipse' }
  | { type: 'roundRect'; radius: number }
  | { type: 'freeform'; path: PresentationPathCommand[] };

export interface PresentationTextContent extends PresentationElementBase {
  type: 'text';
  text?: string;
  paragraphs?: PresentationTextParagraph[];
  style: PresentationTextStyle;
}

export interface PresentationShapeContent extends PresentationElementBase {
  type: 'shape';
  shape: PresentationShapeType;
  fill?: PresentationFill;
  stroke?: PresentationStroke;
  shadow?: PresentationShadow;
}

export interface PresentationFreeformContent extends PresentationElementBase {
  type: 'freeform';
  path: PresentationPathCommand[];
  fill?: PresentationFill;
  stroke?: PresentationStroke;
  shadow?: PresentationShadow;
}

export interface PresentationLineContent extends PresentationElementBase {
  type: 'line';
  color: string;
  widthPt: number;
  dash: 'solid' | 'dash' | 'dot' | 'dashDot';
  startArrow: 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval';
  endArrow: 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval';
}

export interface PresentationImageContent extends PresentationElementBase {
  type: 'image';
  objectId?: string;
  dataBase64?: string;
  mimeType?: 'image/png' | 'image/jpeg';
  widthPx?: number;
  heightPx?: number;
  alt?: string;
  fit: 'contain' | 'cover';
  focalPoint?: {
    x: number;
    y: number;
  };
  mask?: PresentationMask;
}

export interface PresentationSvgContent extends PresentationElementBase {
  type: 'svg';
  svg: string;
  alt?: string;
  mask?: PresentationMask;
}

export type PresentationLeafContent =
  | PresentationTextContent
  | PresentationShapeContent
  | PresentationFreeformContent
  | PresentationLineContent
  | PresentationImageContent
  | PresentationSvgContent;

export type PresentationGroupChild = PresentationLeafContent & {
  frame: PresentationFrame;
};

export interface PresentationGroupContent extends PresentationElementBase {
  type: 'group';
  children: PresentationGroupChild[];
}

export type PresentationElementContent = PresentationLeafContent | PresentationGroupContent;

export interface PresentationSemanticSizing {
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  aspectRatio?: number;
  fitContent?: 'width' | 'height' | 'both';
}

export type PresentationConstraintEdge =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'centerX'
  | 'centerY';

export interface PresentationAnchorConstraint {
  type: 'anchor';
  target: string;
  horizontal: 'left' | 'center' | 'right';
  vertical: 'top' | 'center' | 'bottom';
  offsetX?: number;
  offsetY?: number;
}

export interface PresentationEdgeConstraint {
  type: 'edge';
  target: string;
  edge: PresentationConstraintEdge;
  to?: string;
  toEdge?: PresentationConstraintEdge;
  offset?: number;
}

export interface PresentationMatchSizeConstraint {
  type: 'matchSize';
  target: string;
  to: string;
  axis: 'width' | 'height' | 'both';
}

export interface PresentationDistributeConstraint {
  type: 'distribute';
  targets: string[];
  axis: 'horizontal' | 'vertical';
  start: number;
  end: number;
  gap?: number;
}

export type PresentationLayoutConstraint =
  | PresentationAnchorConstraint
  | PresentationEdgeConstraint
  | PresentationMatchSizeConstraint
  | PresentationDistributeConstraint;

export type PresentationSemanticElement = PresentationElementContent & {
  sizing?: PresentationSemanticSizing;
};

export type PresentationAdvancedElement = PresentationElementContent & {
  frame: PresentationFrame;
};

export interface PresentationSemanticScene {
  mode: 'semantic';
  elements: PresentationSemanticElement[];
  constraints: PresentationLayoutConstraint[];
}

export interface PresentationAdvancedScene {
  mode: 'advanced';
  elements: PresentationAdvancedElement[];
}

export type PresentationScene = PresentationSemanticScene | PresentationAdvancedScene;

export interface PresentationSlideSpec {
  id: string;
  purpose?: string;
  background?: PresentationFill;
  scene: PresentationScene;
}

export interface ResolvedPresentationTextRun {
  text: string;
  fontFamily: string;
  fontSizePt: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  letterSpacingPt: number;
}

export interface ResolvedPresentationTextLine {
  runs: ResolvedPresentationTextRun[];
  align: 'left' | 'center' | 'right';
  lineHeight: number;
}

export interface ResolvedPresentationTextElement {
  type: 'text';
  id: string;
  frame: PresentationFrame;
  lines: ResolvedPresentationTextLine[];
  verticalAlign: 'top' | 'middle' | 'bottom';
  padding: Required<PresentationInsets>;
  fill?: PresentationFill;
  opacity: number;
  rotationDeg: number;
  zIndex: number;
  allowOverlap: boolean;
  allowBleed: boolean;
}

export interface ResolvedPresentationShapeElement {
  type: 'shape';
  id: string;
  frame: PresentationFrame;
  shape: PresentationShapeType;
  fill?: PresentationFill;
  stroke?: PresentationStroke;
  shadow?: PresentationShadow;
  opacity: number;
  rotationDeg: number;
  zIndex: number;
  allowOverlap: boolean;
  allowBleed: boolean;
}

export interface ResolvedPresentationFreeformElement {
  type: 'freeform';
  id: string;
  frame: PresentationFrame;
  path: PresentationPathCommand[];
  fill?: PresentationFill;
  stroke?: PresentationStroke;
  shadow?: PresentationShadow;
  opacity: number;
  rotationDeg: number;
  zIndex: number;
  allowOverlap: boolean;
  allowBleed: boolean;
}

export interface ResolvedPresentationLineElement {
  type: 'line';
  id: string;
  frame: PresentationFrame;
  color: string;
  widthPt: number;
  opacity: number;
  dash: 'solid' | 'dash' | 'dot' | 'dashDot';
  startArrow: 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval';
  endArrow: 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval';
  rotationDeg: number;
  zIndex: number;
  allowOverlap: boolean;
  allowBleed: boolean;
}

export interface ResolvedPresentationImageElement {
  type: 'image';
  id: string;
  frame: PresentationFrame;
  dataBase64: string;
  mimeType: 'image/png' | 'image/jpeg';
  widthPx: number;
  heightPx: number;
  alt?: string;
  fit: 'contain' | 'cover';
  focalPoint?: { x: number; y: number };
  mask?: PresentationMask;
  opacity: number;
  rotationDeg: number;
  zIndex: number;
  allowOverlap: boolean;
  allowBleed: boolean;
}

export interface ResolvedPresentationSvgElement {
  type: 'svg';
  id: string;
  frame: PresentationFrame;
  svg: string;
  alt?: string;
  mask?: PresentationMask;
  opacity: number;
  rotationDeg: number;
  zIndex: number;
  allowOverlap: boolean;
  allowBleed: boolean;
}

export interface ResolvedPresentationGroupElement {
  type: 'group';
  id: string;
  frame: PresentationFrame;
  children: ResolvedPresentationElement[];
  opacity: number;
  rotationDeg: number;
  zIndex: number;
  allowOverlap: boolean;
  allowBleed: boolean;
}

export type ResolvedPresentationElement =
  | ResolvedPresentationTextElement
  | ResolvedPresentationShapeElement
  | ResolvedPresentationFreeformElement
  | ResolvedPresentationLineElement
  | ResolvedPresentationImageElement
  | ResolvedPresentationSvgElement
  | ResolvedPresentationGroupElement;

export interface ResolvedPresentationSlide {
  id: string;
  purpose?: string;
  background?: PresentationFill;
  elements: ResolvedPresentationElement[];
}

export interface PresentationRuntimePayload {
  title: string;
  language?: string;
  page: PresentationPageSpec;
  designDNA: PresentationDesignDNA;
  slides: ResolvedPresentationSlide[];
  meta?: Record<string, unknown>;
}
