import type { RenderPlanBase } from '../core/render-plan.types';

export const DOCUMENT_RENDER_PLAN_BLOCK_TYPES = [
  'heading','paragraph','quote','list','table','image','line','pageBreak','spacer',
] as const;
export type DocumentRenderPlanBlockType = typeof DOCUMENT_RENDER_PLAN_BLOCK_TYPES[number];
export type DocumentHorizontalAlign = 'left' | 'center' | 'right' | 'justify';

export interface DocumentPlanTextStyle {
  fontFamily?: string;
  fontSizePt?: number;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: DocumentHorizontalAlign;
  spacingBeforePt?: number;
  spacingAfterPt?: number;
  lineSpacingMultiple?: number;
  firstLineIndentChars?: number;
  leftIndentPt?: number;
  rightIndentPt?: number;
  keepWithNext?: boolean;
  pageBreakBefore?: boolean;
}

interface DocumentPlanBlockBase {
  id?: string;
  semanticRole?: string;
  styleRef?: string;
  style?: DocumentPlanTextStyle;
}
export type DocumentPlanBlock =
  | (DocumentPlanBlockBase & { type:'heading'; text?:string; sourceRef?:string; level:1|2|3|4|5|6 })
  | (DocumentPlanBlockBase & { type:'paragraph'|'quote'; text?:string; sourceRef?:string })
  | (DocumentPlanBlockBase & { type:'list'; ordered?:boolean; items?:string[]; sourceRef?:string })
  | (DocumentPlanBlockBase & { type:'table'; title?:string; columns?:Array<{key:string;header:string;width?:number;align?:DocumentHorizontalAlign}>; headers?:string[]; rows:Array<Record<string,unknown>|unknown[]>; caption?:string; striped?:boolean; compact?:boolean })
  | (DocumentPlanBlockBase & { type:'image'; dataBase64:string; width?:number; height?:number; alt?:string; caption?:string; align?:'left'|'center'|'right' })
  | (DocumentPlanBlockBase & { type:'line'; color?:string; sizePt?:number })
  | (DocumentPlanBlockBase & { type:'pageBreak' })
  | (DocumentPlanBlockBase & { type:'spacer'; sizePt?:number });

export interface DocumentRenderPlan extends RenderPlanBase {
  kind:'document';
  composition:{ title:string; blocks:DocumentPlanBlock[] };
  design:{
    page:{ size:'A4'|'LETTER'; orientation:'portrait'|'landscape'; marginsCm:{top:number;right:number;bottom:number;left:number} };
    typography:{ bodyFontFamily:string; titleFontFamily?:string; headingFontFamily?:string; numberFontFamily?:string; bodyFontSizePt:number };
    paragraph:{ align:DocumentHorizontalAlign; lineSpacingMultiple:number; spacingBeforePt:number; spacingAfterPt:number; firstLineIndentChars:number };
    colors:{ text:string; primary?:string; accent?:string; muted?:string; border?:string };
    table:{ striped:boolean; compact:boolean; headerBold:boolean };
    namedStyles?:Record<string,DocumentPlanTextStyle>;
    header?:{ text:string; align:'left'|'center'|'right'; styleRef?:string };
    footer?:{ text?:string; align:'left'|'center'|'right'; showPageNumber:boolean; styleRef?:string };
    intent?:string;
  };
}
