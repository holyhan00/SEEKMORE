export type RuntimeActivityStatus = 'queued'|'running'|'waiting'|'blocked'|'succeeded'|'failed'|'partial'|'cancelled'|'skipped';
export type RuntimeActivityKind = 'phase'|'tool'|'observation'|'verification'|'approval'|'clarification'|'repair'|'result';
export type RuntimeStepStatus = 'running'|'waiting'|'succeeded'|'failed';
export type RuntimeStepKind = 'analysis'|'execution'|'verification'|'recovery'|'delivery';

export type RuntimePresentation = {
  key: string;
  params?: Record<string, string|number|boolean|null>;
};
export type RuntimeExecutionTiming = { startedAt:number; finishedAt:number|null; durationMs:number|null };
export type RuntimeStep = { stepId:string; parentStepId:string|null; kind:RuntimeStepKind; iteration:number|null; title:string|null; presentation?:RuntimePresentation|null; status:RuntimeStepStatus; startedAt:number; finishedAt:number|null; timing:RuntimeExecutionTiming|null };
export type RuntimeReasoningSummary = { summaryId:string; stepId:string; markdown:string; status:'streaming'|'completed' };
export type RuntimeActivity = { activityId:string; assistantMessageId:string; conversationId:string; workflowId:string|null; stepId:string|null; parentActivityId:string|null; sequence:number; version:number; kind:RuntimeActivityKind; operation:string; target:{kind:string;label:string|null;resourceId:string|null}|null; status:RuntimeActivityStatus; title:string; presentation?:RuntimePresentation|null; summary:string|null; summaryPresentation?:RuntimePresentation|null; progress:{completed:number;total:number|null;unit:string|null}|null; evidenceRefs:string[]; startedAt:number|null; finishedAt:number|null; createdAt:number; detail?:Record<string,unknown>|null };

type RuntimeEventBase = { eventId:string; sequence:number; userId:string|null; conversationId:string; assistantMessageId:string; traceId:string|null; createdAt:number; replayCursor?:string|null };
export type RuntimeContentEvent = RuntimeEventBase & { type:'assistant.timeline.content'; block:{blockId:string;role:'commentary'|'final';markdown:string;final:boolean;stepId?:string|null} };
export type RuntimeStepEvent = RuntimeEventBase & { type:'assistant.timeline.step'; step:RuntimeStep };
export type RuntimeReasoningSummaryEvent = RuntimeEventBase & { type:'assistant.timeline.reasoning_summary'; summary:RuntimeReasoningSummary };
export type RuntimeActivityEvent = RuntimeEventBase & { type:'assistant.timeline.activity'; activity:RuntimeActivity };
export type RuntimeEvent = RuntimeContentEvent|RuntimeStepEvent|RuntimeReasoningSummaryEvent|RuntimeActivityEvent;
export type RuntimeDeliveryProjection = Record<string,unknown>; export type RuntimeRiskLevel='low'|'medium'|'high'|'critical';

export function normalizeRuntimeEvent(value:unknown):RuntimeEvent|null {
  const event=record(value); const type=String(event.type??'');
  if (!['assistant.timeline.content','assistant.timeline.step','assistant.timeline.reasoning_summary','assistant.timeline.activity'].includes(type)) return null;
  const eventId=String(event.eventId??'').trim(), conversationId=String(event.conversationId??'').trim(), assistantMessageId=String(event.assistantMessageId??'').trim(), sequence=Number(event.sequence);
  if(!eventId||!conversationId||!assistantMessageId||!Number.isFinite(sequence)||sequence<=0)return null;
  const base={eventId,sequence,userId:textOrNull(event.userId),conversationId,assistantMessageId,traceId:textOrNull(event.traceId),createdAt:finite(event.createdAt)??Date.now(),replayCursor:textOrNull(event.replayCursor)};
  if(type==='assistant.timeline.content'){const b=record(event.block),blockId=String(b.blockId??'').trim(),markdown=String(b.markdown??'');if(!blockId||!markdown)return null;return {...base,type,block:{blockId,role:b.role==='commentary'?'commentary':'final',markdown,final:Boolean(b.final),stepId:textOrNull(b.stepId)}} as RuntimeContentEvent;}
  if(type==='assistant.timeline.step'){const s=record(event.step),stepId=String(s.stepId??'').trim(),status=String(s.status??'running') as RuntimeStepStatus,kind=String(s.kind??'analysis') as RuntimeStepKind;if(!stepId)return null;return {...base,type,step:{stepId,parentStepId:textOrNull(s.parentStepId),kind,iteration:finite(s.iteration),title:textOrNull(s.title),presentation:normalizePresentation(s.presentation),status,startedAt:finite(s.startedAt)??Date.now(),finishedAt:finite(s.finishedAt),timing:normalizeTiming(s.timing)}} as RuntimeStepEvent;}
  if(type==='assistant.timeline.reasoning_summary'){const s=record(event.summary),summaryId=String(s.summaryId??'').trim(),stepId=String(s.stepId??'').trim(),markdown=String(s.markdown??'');if(!summaryId||!stepId||!markdown)return null;return {...base,type,summary:{summaryId,stepId,markdown,status:s.status==='completed'?'completed':'streaming'}} as RuntimeReasoningSummaryEvent;}
  const a=normalizeActivity(event.activity);return a?{...base,type:'assistant.timeline.activity',activity:a}:null;
}
function normalizeActivity(value:unknown):RuntimeActivity|null{const i=record(value),activityId=String(i.activityId??'').trim(),title=String(i.title??'').trim();if(!activityId||!title)return null;return{activityId,assistantMessageId:String(i.assistantMessageId??''),conversationId:String(i.conversationId??''),workflowId:textOrNull(i.workflowId),stepId:textOrNull(i.stepId),parentActivityId:textOrNull(i.parentActivityId),sequence:finite(i.sequence)??1,version:Math.max(1,finite(i.version)??1),kind:String(i.kind??'tool') as RuntimeActivityKind,operation:String(i.operation??''),target:normalizeTarget(i.target),status:String(i.status??'running') as RuntimeActivityStatus,title,presentation:normalizePresentation(i.presentation),summary:textOrNull(i.summary),summaryPresentation:normalizePresentation(i.summaryPresentation),progress:normalizeProgress(i.progress),evidenceRefs:strings(i.evidenceRefs),startedAt:finite(i.startedAt),finishedAt:finite(i.finishedAt),createdAt:finite(i.createdAt)??Date.now(),detail:Object.keys(record(i.detail)).length?record(i.detail):null};}
function normalizePresentation(value:unknown):RuntimePresentation|null{const i=record(value),key=String(i.key??'').trim();if(!key)return null;const raw=record(i.params),params:Record<string,string|number|boolean|null>={};for(const [name,item] of Object.entries(raw)){if(item==null||typeof item==='string'||typeof item==='number'||typeof item==='boolean')params[name]=item as string|number|boolean|null;}return{key,...(Object.keys(params).length?{params}:{} )};}
function normalizeTarget(v:unknown){const i=record(v);return Object.keys(i).length?{kind:String(i.kind??'resource'),label:textOrNull(i.label),resourceId:textOrNull(i.resourceId)}:null;} function normalizeProgress(v:unknown){const i=record(v),completed=finite(i.completed);return completed==null?null:{completed,total:finite(i.total),unit:textOrNull(i.unit)};} function record(v:unknown):Record<string,any>{return v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};} function strings(v:unknown):string[]{return Array.isArray(v)?v.map(x=>String(x??'').trim()).filter(Boolean):[];} function textOrNull(v:unknown):string|null{const x=String(v??'').trim();return x||null;} function finite(v:unknown):number|null{if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}

function normalizeTiming(value:unknown):RuntimeExecutionTiming|null{const input=record(value),startedAt=finite(input.startedAt);if(startedAt==null)return null;return{startedAt,finishedAt:finite(input.finishedAt),durationMs:finite(input.durationMs)};}
