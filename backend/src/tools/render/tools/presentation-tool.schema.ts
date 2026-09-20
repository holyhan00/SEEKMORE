import {
  PRESENTATION_SLIDE_GRAMMAR_IDS,
  PRESENTATION_SLIDE_GRAMMAR_SELECTION_GUIDE,
} from '../presentation/presentation-design.guidance';

const COLOR_SCHEMA = {
  type: 'string',
  pattern: '^#?[0-9A-Fa-f]{6}$',
} as const;

const FILL_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'color'],
      properties: {
        type: { const: 'solid' },
        color: COLOR_SCHEMA,
        opacity: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'angleDeg', 'stops'],
      properties: {
        type: { const: 'linearGradient' },
        angleDeg: { type: 'number' },
        stops: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['offset', 'color'],
            properties: {
              offset: { type: 'number', minimum: 0, maximum: 1 },
              color: COLOR_SCHEMA,
              opacity: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
      },
    },
  ],
} as const;

const FRAME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'width', 'height'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number', minimum: 0 },
    height: { type: 'number', minimum: 0 },
  },
} as const;

const ELEMENT_COMMON_PROPERTIES = {
  id: { type: 'string', minLength: 1 },
  opacity: { type: 'number', minimum: 0, maximum: 1 },
  rotationDeg: { type: 'number' },
  zIndex: { type: 'number' },
  allowOverlap: { type: 'boolean' },
  allowBleed: { type: 'boolean' },
} as const;

const TEXT_RUN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: {
    text: { type: 'string' },
    fontFamily: { type: 'string', minLength: 1 },
    fontSizePt: { type: 'number', minimum: 1 },
    color: COLOR_SCHEMA,
    bold: { type: 'boolean' },
    italic: { type: 'boolean' },
    underline: { type: 'boolean' },
    strike: { type: 'boolean' },
    letterSpacingPt: { type: 'number', minimum: -5, maximum: 40 },
  },
} as const;

const TEXT_PARAGRAPH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['runs'],
  properties: {
    runs: { type: 'array', minItems: 1, maxItems: 128, items: TEXT_RUN_SCHEMA },
    align: { type: 'string', enum: ['left', 'center', 'right'] },
    lineHeight: { type: 'number', minimum: 0.5, maximum: 4 },
  },
} as const;

const TEXT_STYLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['fontSizePt', 'align', 'verticalAlign', 'lineHeight'],
  properties: {
    fontFamily: { type: 'string', minLength: 1 },
    fontSizePt: { type: 'number', minimum: 1 },
    minFontSizePt: { type: 'number', minimum: 1 },
    color: COLOR_SCHEMA,
    bold: { type: 'boolean' },
    italic: { type: 'boolean' },
    underline: { type: 'boolean' },
    strike: { type: 'boolean' },
    letterSpacingPt: { type: 'number', minimum: -5, maximum: 40 },
    align: { type: 'string', enum: ['left', 'center', 'right'] },
    verticalAlign: { type: 'string', enum: ['top', 'middle', 'bottom'] },
    lineHeight: { type: 'number', minimum: 0.5, maximum: 4 },
    padding: {
      oneOf: [
        { type: 'number', minimum: 0, maximum: 0.5 },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            top: { type: 'number', minimum: 0, maximum: 0.5 },
            right: { type: 'number', minimum: 0, maximum: 0.5 },
            bottom: { type: 'number', minimum: 0, maximum: 0.5 },
            left: { type: 'number', minimum: 0, maximum: 0.5 },
          },
        },
      ],
    },
    fill: FILL_SCHEMA,
    fit: { type: 'string', enum: ['shrink', 'clip'] },
  },
} as const;

const STROKE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['color', 'widthPt', 'dash'],
  properties: {
    color: COLOR_SCHEMA,
    widthPt: { type: 'number', minimum: 0 },
    opacity: { type: 'number', minimum: 0, maximum: 1 },
    dash: { type: 'string', enum: ['solid', 'dash', 'dot', 'dashDot'] },
  },
} as const;

const SHADOW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['color', 'opacity', 'blurPt', 'offsetXPt', 'offsetYPt'],
  properties: {
    color: COLOR_SCHEMA,
    opacity: { type: 'number', minimum: 0, maximum: 1 },
    blurPt: { type: 'number', minimum: 0 },
    offsetXPt: { type: 'number' },
    offsetYPt: { type: 'number' },
  },
} as const;

const PATH_COMMAND_SCHEMA = {
  oneOf: [
    {
      type: 'object', additionalProperties: false, required: ['type', 'x', 'y'],
      properties: { type: { const: 'moveTo' }, x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } },
    },
    {
      type: 'object', additionalProperties: false, required: ['type', 'x', 'y'],
      properties: { type: { const: 'lineTo' }, x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } },
    },
    {
      type: 'object', additionalProperties: false, required: ['type', 'x1', 'y1', 'x2', 'y2', 'x', 'y'],
      properties: {
        type: { const: 'cubicTo' },
        x1: { type: 'number', minimum: 0, maximum: 1 }, y1: { type: 'number', minimum: 0, maximum: 1 },
        x2: { type: 'number', minimum: 0, maximum: 1 }, y2: { type: 'number', minimum: 0, maximum: 1 },
        x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    {
      type: 'object', additionalProperties: false, required: ['type', 'x1', 'y1', 'x', 'y'],
      properties: {
        type: { const: 'quadraticTo' },
        x1: { type: 'number', minimum: 0, maximum: 1 }, y1: { type: 'number', minimum: 0, maximum: 1 },
        x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'close' } } },
  ],
} as const;

const PATH_SCHEMA = {
  type: 'array',
  minItems: 2,
  maxItems: 512,
  items: PATH_COMMAND_SCHEMA,
} as const;

const MASK_SCHEMA = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'rect' } } },
    { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'ellipse' } } },
    {
      type: 'object', additionalProperties: false, required: ['type', 'radius'],
      properties: { type: { const: 'roundRect' }, radius: { type: 'number', exclusiveMinimum: 0, maximum: 0.5 } },
    },
    {
      type: 'object', additionalProperties: false, required: ['type', 'path'],
      properties: { type: { const: 'freeform' }, path: PATH_SCHEMA },
    },
  ],
} as const;

const LEAF_CONTENT_VARIANTS = [
  {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'style'],
    anyOf: [{ required: ['text'] }, { required: ['paragraphs'] }],
    properties: {
      ...ELEMENT_COMMON_PROPERTIES,
      type: { const: 'text' },
      text: { type: 'string' },
      paragraphs: { type: 'array', minItems: 1, maxItems: 128, items: TEXT_PARAGRAPH_SCHEMA },
      style: TEXT_STYLE_SCHEMA,
    },
  },
  {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'shape'],
    properties: {
      ...ELEMENT_COMMON_PROPERTIES,
      type: { const: 'shape' },
      shape: { type: 'string', enum: ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'chevron', 'rightArrow', 'leftArrow'] },
      fill: FILL_SCHEMA,
      stroke: STROKE_SCHEMA,
      shadow: SHADOW_SCHEMA,
    },
  },
  {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'path'],
    properties: {
      ...ELEMENT_COMMON_PROPERTIES,
      type: { const: 'freeform' },
      path: PATH_SCHEMA,
      fill: FILL_SCHEMA,
      stroke: STROKE_SCHEMA,
      shadow: SHADOW_SCHEMA,
    },
  },
  {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'color', 'widthPt', 'dash', 'startArrow', 'endArrow'],
    properties: {
      ...ELEMENT_COMMON_PROPERTIES,
      type: { const: 'line' },
      color: COLOR_SCHEMA,
      widthPt: { type: 'number', minimum: 0.1 },
      dash: { type: 'string', enum: ['solid', 'dash', 'dot', 'dashDot'] },
      startArrow: { type: 'string', enum: ['none', 'triangle', 'stealth', 'diamond', 'oval'] },
      endArrow: { type: 'string', enum: ['none', 'triangle', 'stealth', 'diamond', 'oval'] },
    },
  },
  {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'fit'],
    properties: {
      ...ELEMENT_COMMON_PROPERTIES,
      type: { const: 'image' },
      objectId: { type: 'string', minLength: 1 },
      dataBase64: { type: 'string', minLength: 1 },
      alt: { type: 'string' },
      fit: { type: 'string', enum: ['contain', 'cover'] },
      focalPoint: {
        type: 'object', additionalProperties: false, required: ['x', 'y'],
        properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } },
      },
      mask: MASK_SCHEMA,
    },
  },
  {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'svg'],
    properties: {
      ...ELEMENT_COMMON_PROPERTIES,
      type: { const: 'svg' },
      svg: { type: 'string', minLength: 1, maxLength: 2000000 },
      alt: { type: 'string' },
      mask: MASK_SCHEMA,
    },
  },
] as const;

function withAdvancedGeometry(variant: Record<string, unknown>) {
  const properties = (variant as { properties: Record<string, unknown> }).properties;
  const required = (variant as { required: string[] }).required;
  return {
    ...variant,
    required: [...required, 'frame'],
    properties: { ...properties, frame: FRAME_SCHEMA },
  };
}

const GROUP_VARIANT = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'children'],
  properties: {
    ...ELEMENT_COMMON_PROPERTIES,
    type: { const: 'group' },
    children: {
      type: 'array', minItems: 1, maxItems: 100,
      items: { oneOf: LEAF_CONTENT_VARIANTS.map((variant) => withAdvancedGeometry(variant as unknown as Record<string, unknown>)) },
    },
  },
} as const;

const CONTENT_VARIANTS = [...LEAF_CONTENT_VARIANTS, GROUP_VARIANT] as const;

const SIZING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    width: { type: 'number', exclusiveMinimum: 0, maximum: 1.5 },
    height: { type: 'number', exclusiveMinimum: 0, maximum: 1.5 },
    minWidth: { type: 'number', minimum: 0, maximum: 1.5 },
    maxWidth: { type: 'number', exclusiveMinimum: 0, maximum: 1.5 },
    minHeight: { type: 'number', minimum: 0, maximum: 1.5 },
    maxHeight: { type: 'number', exclusiveMinimum: 0, maximum: 1.5 },
    aspectRatio: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
    fitContent: { type: 'string', enum: ['width', 'height', 'both'] },
  },
} as const;

function withSemanticSizing(variant: Record<string, unknown>) {
  const properties = (variant as { properties: Record<string, unknown> }).properties;
  return { ...variant, properties: { ...properties, sizing: SIZING_SCHEMA } };
}

const EDGE_ENUM = ['left', 'right', 'top', 'bottom', 'centerX', 'centerY'] as const;

const CONSTRAINT_SCHEMA = {
  oneOf: [
    {
      type: 'object', additionalProperties: false, required: ['type', 'target', 'horizontal', 'vertical'],
      properties: {
        type: { const: 'anchor' }, target: { type: 'string', minLength: 1 },
        horizontal: { type: 'string', enum: ['left', 'center', 'right'] },
        vertical: { type: 'string', enum: ['top', 'center', 'bottom'] },
        offsetX: { type: 'number' }, offsetY: { type: 'number' },
      },
    },
    {
      type: 'object', additionalProperties: false, required: ['type', 'target', 'edge'],
      properties: {
        type: { const: 'edge' }, target: { type: 'string', minLength: 1 }, edge: { type: 'string', enum: EDGE_ENUM },
        to: { type: 'string', minLength: 1 }, toEdge: { type: 'string', enum: EDGE_ENUM }, offset: { type: 'number' },
      },
    },
    {
      type: 'object', additionalProperties: false, required: ['type', 'target', 'to', 'axis'],
      properties: {
        type: { const: 'matchSize' }, target: { type: 'string', minLength: 1 }, to: { type: 'string', minLength: 1 },
        axis: { type: 'string', enum: ['width', 'height', 'both'] },
      },
    },
    {
      type: 'object', additionalProperties: false, required: ['type', 'targets', 'axis', 'start', 'end'],
      properties: {
        type: { const: 'distribute' },
        targets: { type: 'array', minItems: 2, maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1 } },
        axis: { type: 'string', enum: ['horizontal', 'vertical'] },
        start: { type: 'number' }, end: { type: 'number' }, gap: { type: 'number', minimum: 0 },
      },
    },
  ],
} as const;


export const PRESENTATION_SLIDE_DESIGN_INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    grammar: {
      type: 'string',
      enum: PRESENTATION_SLIDE_GRAMMAR_IDS,
      description: `Preferred slide structure. ${PRESENTATION_SLIDE_GRAMMAR_SELECTION_GUIDE} This is design guidance, not a fixed template.`,
    },
    density: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'Intended information density for the slide.',
    },
    visualWeight: {
      type: 'string',
      enum: ['text', 'balanced', 'visual', 'data'],
      description: 'Which kind of content should carry the dominant visual weight.',
    },
    composition: {
      type: 'string',
      maxLength: 600,
      description: 'Optional concise composition direction specific to this slide. Describe relationships and hierarchy rather than exact coordinates.',
    },
  },
} as const;

export const PRESENTATION_SCENE_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'elements', 'constraints'],
      properties: {
        mode: { const: 'semantic' },
        elements: {
          type: 'array', minItems: 1, maxItems: 200,
          items: { oneOf: CONTENT_VARIANTS.map((variant) => withSemanticSizing(variant as unknown as Record<string, unknown>)) },
        },
        constraints: { type: 'array', maxItems: 800, items: CONSTRAINT_SCHEMA },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'elements'],
      properties: {
        mode: { const: 'advanced' },
        elements: {
          type: 'array', minItems: 1, maxItems: 200,
          items: { oneOf: CONTENT_VARIANTS.map((variant) => withAdvancedGeometry(variant as unknown as Record<string, unknown>)) },
        },
      },
    },
  ],
} as const;

export const PRESENTATION_DESIGN_STUDY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'references', 'methods'],
  properties: {
    source: { type: 'string', enum: ['researched', 'user_reference', 'mixed'] },
    references: {
      type: 'array', maxItems: 24,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string' }, url: { type: 'string' }, objectId: { type: 'string' },
          kind: { type: 'string', enum: ['brand', 'presentation', 'visual', 'document', 'other'] },
        },
      },
    },
    methods: {
      type: 'object', additionalProperties: false,
      properties: {
        composition: { type: 'array', maxItems: 16, items: { type: 'string' } },
        hierarchy: { type: 'array', maxItems: 16, items: { type: 'string' } },
        typography: { type: 'array', maxItems: 16, items: { type: 'string' } },
        whitespace: { type: 'array', maxItems: 16, items: { type: 'string' } },
        imagery: { type: 'array', maxItems: 16, items: { type: 'string' } },
        dataVisualization: { type: 'array', maxItems: 16, items: { type: 'string' } },
        deckRhythm: { type: 'array', maxItems: 16, items: { type: 'string' } },
      },
    },
    constraints: { type: 'array', maxItems: 24, items: { type: 'string' } },
    avoid: { type: 'array', maxItems: 24, items: { type: 'string' } },
  },
} as const;

export const PRESENTATION_DESIGN_DNA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['palette', 'typography'],
  properties: {
    palette: {
      type: 'object', additionalProperties: false, required: ['background', 'text'],
      properties: {
        background: COLOR_SCHEMA, text: COLOR_SCHEMA,
        accents: { type: 'array', maxItems: 12, items: COLOR_SCHEMA },
      },
    },
    typography: {
      type: 'object', additionalProperties: false, required: ['fontFamily'],
      properties: { fontFamily: { type: 'string', minLength: 1 } },
    },
    visualLanguage: { type: 'array', maxItems: 24, items: { type: 'string' } },
    imageLanguage: { type: 'array', maxItems: 24, items: { type: 'string' } },
    constraints: { type: 'array', maxItems: 24, items: { type: 'string' } },
  },
} as const;

export const PRESENTATION_FILL_SCHEMA = FILL_SCHEMA;

export function canAuthorPresentation(ctx: {
  userId?: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}): boolean {
  return Boolean(
    ctx.userId
    && ctx.conversationId
    && String(ctx.metadata?.agentId ?? '').trim(),
  );
}
