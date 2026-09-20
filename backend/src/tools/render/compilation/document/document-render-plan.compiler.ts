import { Injectable } from '@nestjs/common';
import type { DocxBlock, DocxParagraphStyle, DocxRenderPayload } from '../../document/docx/docx-render.types';
import type { RenderToolName } from '../../render.types';
import { failure, success, type RenderPlanDiagnostic, type RenderStageResult } from '../../planning/core/render-plan-diagnostics.types';
import { cleanHex, isRenderPlaceholderText, safeFilename } from '../../planning/core/render-plan.util';
import type { RenderPlanningRequest } from '../../planning/core/render-plan.types';
import type { DocumentPlanBlock, DocumentPlanTextStyle, DocumentRenderPlan } from '../../planning/document/document-render-plan.types';
@Injectable()
export class DocumentRenderPlanCompiler {
  compile(plan:DocumentRenderPlan,request:RenderPlanningRequest):RenderStageResult<{toolName:RenderToolName;payload:DocxRenderPayload;filename:string}>{
    if(plan.output.format!==request.output.format)return failure([{stage:'compilation',code:'DOCUMENT_PLAN_OUTPUT_FORMAT_MISMATCH',message:`Plan output format ${plan.output.format} does not match requested format ${request.output.format}.`,path:'$.output.format',severity:'error',repairable:true}]);
    const contentDiagnostic=this.contentDiagnostic(plan,request); if(contentDiagnostic)return failure([contentDiagnostic]);
    const d=plan.design; const t=d.typography; const p=d.paragraph; const c=d.colors; const table=d.table;
    const payload:DocxRenderPayload={
      title:plan.composition.title,
      theme:{pageSize:d.page.size,orientation:d.page.orientation,showPageNumber:d.footer?.showPageNumber===true,primaryColor:this.color(c.primary),accentColor:this.color(c.accent),textColor:this.color(c.text),mutedColor:this.color(c.muted),borderColor:this.color(c.border),fontFamily:t.bodyFontFamily,titleFontFamily:t.titleFontFamily,headingFontFamily:t.headingFontFamily,numberFontFamily:t.numberFontFamily,defaultParagraph:{align:p.align,fontSizePt:t.bodyFontSizePt,lineSpacingTwips:this.lineMultipleToTwips(p.lineSpacingMultiple),spacingBeforeTwips:this.ptToTwips(p.spacingBeforePt),spacingAfterTwips:this.ptToTwips(p.spacingAfterPt),firstLineTwips:this.charIndentToTwips(p.firstLineIndentChars,t.bodyFontSizePt)},defaultTable:{striped:table.striped,compact:table.compact,headerBold:table.headerBold,borderColor:this.color(c.border)}},
      rendererHints:{page:{marginTop:this.cmToTwips(d.page.marginsCm.top),marginRight:this.cmToTwips(d.page.marginsCm.right),marginBottom:this.cmToTwips(d.page.marginsCm.bottom),marginLeft:this.cmToTwips(d.page.marginsCm.left),orientation:d.page.orientation,pageSize:d.page.size},fonts:{bodyFontFamily:t.bodyFontFamily,titleFontFamily:t.titleFontFamily,headingFontFamily:t.headingFontFamily,numberFontFamily:t.numberFontFamily,fontSizePt:t.bodyFontSizePt},paragraph:{align:p.align,lineSpacingTwips:this.lineMultipleToTwips(p.lineSpacingMultiple),spacingBeforeTwips:this.ptToTwips(p.spacingBeforePt),spacingAfterTwips:this.ptToTwips(p.spacingAfterPt),firstLineTwips:this.charIndentToTwips(p.firstLineIndentChars,t.bodyFontSizePt)},table:{striped:table.striped,compact:table.compact,headerBold:table.headerBold,borderColor:this.color(c.border)},namedStyles:this.compileNamedStyles(d.namedStyles,t.bodyFontSizePt),header:d.header?{...d.header}:undefined,footer:d.footer?{...d.footer,fontFamily:t.bodyFontFamily}:undefined},
      blocks:plan.composition.blocks.map(b=>this.compileBlock(b,request,t.bodyFontSizePt)),
      meta:{renderPlanVersion:plan.version,renderPlanKind:plan.kind,designIntent:d.intent},
    };
    const format=request.output.format==='pdf'?'pdf':'docx';
    return success({toolName:format==='pdf'?'document.render.pdf':'document.render.docx',payload,filename:safeFilename(request.output.filename??plan.output.filename,plan.composition.title||'document',format)});
  }
  private compileBlock(block:DocumentPlanBlock,request:RenderPlanningRequest,bodySize:number):DocxBlock{
    const base={semanticRole:block.semanticRole,styleRef:block.styleRef,style:this.compileTextStyle(block.style,bodySize)};
    switch(block.type){
      case'heading':return{type:'heading',text:this.text(block.text,block.sourceRef,request),level:block.level,...base};
      case'paragraph':case'quote':return{type:block.type,text:this.text(block.text,block.sourceRef,request),...base} as DocxBlock;
      case'list':return{type:'list',ordered:block.ordered,items:block.items??this.list(block.sourceRef,request),...base};
      case'table':return{type:'table',semanticRole:block.semanticRole,styleRef:block.styleRef,table:{title:block.title,columns:block.columns,headers:block.headers,rows:block.rows,caption:block.caption,striped:block.striped,compact:block.compact,semanticRole:block.semanticRole,styleRef:block.styleRef}};
      case'image':return{type:'image',semanticRole:block.semanticRole,styleRef:block.styleRef,image:{dataBase64:block.dataBase64,width:block.width,height:block.height,alt:block.alt,caption:block.caption,align:block.align}};
      case'line':return{type:'line',semanticRole:block.semanticRole,border:{color:this.color(block.color),size:block.sizePt?this.ptToEighthPoints(block.sizePt):undefined}};
      case'pageBreak':return{type:'pageBreak',semanticRole:block.semanticRole};
      case'spacer':return{type:'spacer',size:block.sizePt?this.ptToTwips(block.sizePt):undefined,semanticRole:block.semanticRole};
    }
  }

  private contentDiagnostic(plan:DocumentRenderPlan,request:RenderPlanningRequest):RenderPlanDiagnostic|undefined{
    for(const [index,block] of plan.composition.blocks.entries()){
      const path=`$.composition.blocks[${index}]`;
      if(block.type==='heading'||block.type==='paragraph'||block.type==='quote'){
        if(block.text!==undefined){if(isRenderPlaceholderText(block.text))return this.placeholderDiagnostic(`${path}.text`);continue;}
        if(block.sourceRef){const found=this.sourceBlock(block.sourceRef,request);if(!found)return this.sourceDiagnostic('DOCUMENT_SOURCE_REF_NOT_FOUND',`Source block ${block.sourceRef} was not found.`,`${path}.sourceRef`);const value=found.text??found.content;if(typeof value!=='string'||!value.trim())return this.sourceDiagnostic('DOCUMENT_SOURCE_REF_CONTENT_MISSING',`Source block ${block.sourceRef} does not contain real text content.`,`${path}.sourceRef`);if(isRenderPlaceholderText(value))return this.placeholderDiagnostic(`${path}.sourceRef`);}
      }
      if(block.type==='list'){
        if(Array.isArray(block.items)){const itemIndex=block.items.findIndex(item=>isRenderPlaceholderText(item));if(itemIndex>=0)return this.placeholderDiagnostic(`${path}.items[${itemIndex}]`);continue;}
        if(block.sourceRef){const found=this.sourceBlock(block.sourceRef,request);if(!found)return this.sourceDiagnostic('DOCUMENT_SOURCE_REF_NOT_FOUND',`Source block ${block.sourceRef} was not found.`,`${path}.sourceRef`);if(!Array.isArray(found.items))return this.sourceDiagnostic('DOCUMENT_SOURCE_REF_CONTENT_MISSING',`Source block ${block.sourceRef} does not contain list items.`,`${path}.sourceRef`);const itemIndex=found.items.findIndex((item:unknown)=>isRenderPlaceholderText(item));if(itemIndex>=0)return this.placeholderDiagnostic(`${path}.sourceRef`);}
      }
    }
    return undefined;
  }
  private sourceBlock(ref:string,request:RenderPlanningRequest):any{return request.source?.blocks?.find((b:any)=>b&&typeof b==='object'&&String(b.id??b.ref??'')===ref);}
  private placeholderDiagnostic(path:string):RenderPlanDiagnostic{return this.sourceDiagnostic('DOCUMENT_SOURCE_PLACEHOLDER_NOT_ALLOWED','Document content contains a block placeholder instead of real final content.',path);}
  private sourceDiagnostic(code:string,message:string,path:string):RenderPlanDiagnostic{return{stage:'compilation',code,message,path,severity:'error',repairable:false};}
  private compileTextStyle(style:DocumentPlanTextStyle|undefined,bodySize:number):DocxParagraphStyle|undefined{if(!style)return undefined;return{fontFamily:style.fontFamily,fontSizePt:style.fontSizePt,color:this.color(style.color),backgroundColor:this.color(style.backgroundColor),bold:style.bold,italic:style.italic,underline:style.underline,align:style.align,spacingBeforeTwips:style.spacingBeforePt===undefined?undefined:this.ptToTwips(style.spacingBeforePt),spacingAfterTwips:style.spacingAfterPt===undefined?undefined:this.ptToTwips(style.spacingAfterPt),lineSpacingTwips:style.lineSpacingMultiple===undefined?undefined:this.lineMultipleToTwips(style.lineSpacingMultiple),firstLineTwips:style.firstLineIndentChars===undefined?undefined:this.charIndentToTwips(style.firstLineIndentChars,style.fontSizePt??bodySize),leftTwips:style.leftIndentPt===undefined?undefined:this.ptToTwips(style.leftIndentPt),rightTwips:style.rightIndentPt===undefined?undefined:this.ptToTwips(style.rightIndentPt),keepWithNext:style.keepWithNext,pageBreakBefore:style.pageBreakBefore};}
  private compileNamedStyles(styles:Record<string,DocumentPlanTextStyle>|undefined,body:number){if(!styles)return undefined;return Object.fromEntries(Object.entries(styles).map(([k,v])=>[k,this.compileTextStyle(v,body)]));}
  private text(value:string|undefined,ref:string|undefined,request:RenderPlanningRequest):string{if(value!==undefined)return value;if(!ref)return'';const found=request.source?.blocks?.find((b:any)=>b&&typeof b==='object'&&String(b.id??b.ref??'')===ref) as any;return String(found?.text??found?.content??'');}
  private list(ref:string|undefined,request:RenderPlanningRequest):string[]{if(!ref)return[];const found=request.source?.blocks?.find((b:any)=>b&&typeof b==='object'&&String(b.id??b.ref??'')===ref) as any;return Array.isArray(found?.items)?found.items.map(String):[];}
  private color(v:unknown):string|undefined{if(typeof v!=='string'||!v.trim())return undefined;return cleanHex(v,'');}
  private ptToTwips(v:number){return Math.round(v*20)} private cmToTwips(v:number){return Math.round(v*567)} private lineMultipleToTwips(v:number){return Math.round(v*240)} private charIndentToTwips(chars:number,fontPt:number){return Math.round(chars*fontPt*20)} private ptToEighthPoints(v:number){return Math.max(1,Math.round(v*8))}
}
