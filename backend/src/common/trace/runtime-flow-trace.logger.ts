                                                        
import { Injectable, Logger } from '@nestjs/common';

type TraceValue = string | number | boolean | null | undefined;
export type RuntimeFlowTraceFields = Record<string, TraceValue>;

@Injectable()
export class RuntimeFlowTraceLogger {
  private readonly logger = new Logger('RuntimeFlowTrace');

     
            
                                               
     
  private readonly streamDebugStages = new Set<string>([
    'model.delta',
    'turn.on_token',
    'writer.state_created',
    'writer.buffer_append',
    'turn.delta_emit_start',
    'gateway.emit_delta',
    'turn.delta_emit_done',
    'writer.flush_scheduled',
    'writer.flush_start',
    'writer.flush_done',
    'writer.flush_skipped_clean',
    'writer.flush_rescheduled_dirty',
  ]);

     
                
     
  event(stage: string, fields: RuntimeFlowTraceFields = {}) {
    this.logger.log(this.format(stage, fields));
  }

     
                
    
                             
                  
    
                                      
                                         
     
  debug(stage: string, fields: RuntimeFlowTraceFields = {}) {
    if (!this.shouldPrintDebug(stage, fields)) return;
    this.logger.debug(this.format(stage, fields));
  }

  warn(stage: string, fields: RuntimeFlowTraceFields = {}) {
    this.logger.warn(this.format(stage, fields));
  }

  error(stage: string, fields: RuntimeFlowTraceFields = {}) {
    this.logger.error(this.format(stage, fields));
  }

  private shouldPrintDebug(stage: string, fields: RuntimeFlowTraceFields): boolean {
    const verboseDebug = process.env.RUNTIME_TRACE_DEBUG === 'true';
    const verboseStream = process.env.RUNTIME_TRACE_VERBOSE_STREAM === 'true';

    if (this.streamDebugStages.has(stage)) {
      return verboseStream;
    }

       
                                                           
                    
       
    if (stage === 'gateway.emit_to_user') {
      const event = String(fields.event ?? '');
      if (event === 'chat.response.delta') {
        return verboseStream;
      }
    }

    return verboseDebug;
  }

  private format(stage: string, fields: RuntimeFlowTraceFields): string {
    const payload = Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${this.safe(value)}`)
      .join(' ');

    return `stage=${stage}${payload ? ` ${payload}` : ''}`;
  }

  private safe(value: TraceValue): string {
    if (value === null) return 'null';

    const text = String(value).replace(/\s+/g, ' ').trim();
    const maxLen = this.maxValueLen();

    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}...<truncated>`;
  }

  private maxValueLen(): number {
    const raw = Number(process.env.RUNTIME_TRACE_VALUE_MAX_LEN ?? 300);
    if (!Number.isFinite(raw)) return 300;
    return Math.max(80, Math.min(raw, 2000));
  }
}