import type {
  PresentationSlideDesignIntent,
  PresentationSlideGrammar,
} from './presentation.types';

export const PRESENTATION_SLIDE_GRAMMAR_IDS = [
  'hero',
  'statement',
  'section',
  'split',
  'comparison',
  'flow',
  'metrics',
  'data_story',
  'grid',
  'gallery',
  'closing',
  'custom',
] as const satisfies readonly PresentationSlideGrammar[];

export const PRESENTATION_SLIDE_GRAMMAR_SELECTION_GUIDE =
  'Choose the preferred structure by message: hero for openings or major ideas; statement for one decisive point; section for narrative dividers; split for image-and-text stories; comparison for explicit contrasts; flow for processes, timelines, systems, or progression; metrics for quantitative highlights; data_story for insight-led charts or evidence; grid for genuinely peer-level items; gallery for image-led stories; closing for summaries, actions, or endings; custom only when the common structures do not fit.';

export const PRESENTATION_DESIGN_FOUNDATION = [
  'Give each slide one clear primary focal point, then subordinate supporting information to it.',
  'Use substantial visual hierarchy between display text, titles, supporting copy, captions, and data callouts; avoid making adjacent levels look nearly equal.',
  'Treat whitespace as part of the composition. Do not add containers, decoration, or copy simply to fill unused space.',
  'Use images, diagrams, charts, and shapes to carry meaning or establish composition rather than as disconnected decoration.',
  'Use cards or grids when the content is genuinely peer-level; do not make card grids the default structure for unrelated content.',
  'Apply the stored design study and design DNA consistently across typography, spacing, imagery, color, geometry, and visual language.',
  'Vary structure, density, and visual weight across adjacent slides when it supports the narrative; repeat a structure only when the repetition is intentional.',
] as const;

export const PRESENTATION_SLIDE_GRAMMAR_GUIDE = [
  {
    id: 'hero',
    useFor: 'Openings, major ideas, product or concept introductions, and high-impact transitions.',
    composition: 'One dominant visual or statement with one concise supporting message cluster and generous negative space.',
    avoid: 'Dense body copy, equal-weight blocks, and default card grids.',
  },
  {
    id: 'statement',
    useFor: 'A single conclusion, thesis, quote, strategic point, or narrative turn.',
    composition: 'Make the statement itself the visual anchor with minimal supporting material.',
    avoid: 'Breaking one idea into many small containers or adding decoration without meaning.',
  },
  {
    id: 'section',
    useFor: 'Section dividers and clear narrative transitions.',
    composition: 'A strong section marker and title with intentionally low information density.',
    avoid: 'Treating the page like a normal content slide.',
  },
  {
    id: 'split',
    useFor: 'Image-and-text stories, concept explanations, products, people, or before/after narratives with one dominant side.',
    composition: 'Two related regions with deliberately unequal or balanced visual weight depending on the message.',
    avoid: 'Automatic 50/50 symmetry when the content has a clear dominant element.',
  },
  {
    id: 'comparison',
    useFor: 'Alternatives, contrasts, before/after, trade-offs, or side-by-side evaluation.',
    composition: 'Expose the comparison axis clearly so corresponding information is easy to scan.',
    avoid: 'Two unrelated card stacks that hide the actual contrast.',
  },
  {
    id: 'flow',
    useFor: 'Processes, sequences, timelines, systems, journeys, and causal progression.',
    composition: 'Make direction, order, and relationships visually explicit through a coherent path.',
    avoid: 'Independent boxes with no visible progression or relationship.',
  },
  {
    id: 'metrics',
    useFor: 'Key results, KPIs, evidence, milestones, and quantitative highlights.',
    composition: 'Let the most important number or result become a primary visual element, supported by concise context.',
    avoid: 'Reducing every metric to the same small card treatment.',
  },
  {
    id: 'data_story',
    useFor: 'Charts, trends, analytical findings, and evidence-led explanation.',
    composition: 'Lead with the insight, use the visualization as evidence, and annotate only what supports the takeaway.',
    avoid: 'A chart placed without a clear message or with unnecessary visual noise.',
  },
  {
    id: 'grid',
    useFor: 'Truly peer-level features, categories, portfolios, examples, or repeated comparable items.',
    composition: 'Use a consistent alignment system and strong grouping while preserving breathing room.',
    avoid: 'Using a grid simply because several pieces of content exist.',
  },
  {
    id: 'gallery',
    useFor: 'Case studies, visual references, portfolios, products, places, and image-led storytelling.',
    composition: 'Make imagery dominant and use text as concise orientation or annotation.',
    avoid: 'Shrinking meaningful visuals into decorative thumbnails.',
  },
  {
    id: 'closing',
    useFor: 'Summaries, calls to action, next steps, final takeaways, and endings.',
    composition: 'Create a decisive final hierarchy with a small number of memorable points or one clear action.',
    avoid: 'Ending with another dense generic content page.',
  },
  {
    id: 'custom',
    useFor: 'A composition that does not fit the common structures and has a clear reason to be different.',
    composition: 'Preserve the same hierarchy, whitespace, consistency, and narrative discipline as the common structures.',
    avoid: 'Using custom as a reason to ignore the deck design language or spatial logic.',
  },
] as const;

export const PRESENTATION_VISUAL_REVIEW_CRITERIA = [
  'Does the rendered slide have one clear focal point and a readable hierarchy that matches its purpose?',
  'Is whitespace intentional, with comfortable margins and grouping rather than crowded or artificially filled space?',
  'Do imagery, charts, shapes, and typography carry the intended visual weight instead of competing equally?',
  'Are image crops, alignment, text density, and element scale visually convincing at normal presentation viewing size?',
  'Does the slide follow the stored design study, design DNA, and its own design intent without becoming mechanically templated?',
  'Does the slide contribute useful rhythm relative to nearby slides instead of repeating the same composition by default?',
] as const;

export function presentationAuthoringGuide(): Record<string, unknown> {
  return {
    foundation: PRESENTATION_DESIGN_FOUNDATION,
    slideGrammars: PRESENTATION_SLIDE_GRAMMAR_GUIDE,
    deckRhythm:
      'Plan slide structure, density, and visual weight as a sequence across the deck. Avoid mechanical repetition, but keep repeated structures when they intentionally form a series.',
    sceneAuthoring:
      'Use the grammar as a design starting point, not a fixed template. The authored scene remains free to choose exact geometry, composition, imagery, and visual treatment within the stored design study and design DNA.',
  };
}

export function presentationDesignIntentSummary(
  intent: PresentationSlideDesignIntent | undefined,
): PresentationSlideDesignIntent | null {
  if (!intent) return null;
  return {
    ...(intent.grammar ? { grammar: intent.grammar } : {}),
    ...(intent.density ? { density: intent.density } : {}),
    ...(intent.visualWeight ? { visualWeight: intent.visualWeight } : {}),
    ...(intent.composition ? { composition: intent.composition } : {}),
  };
}
