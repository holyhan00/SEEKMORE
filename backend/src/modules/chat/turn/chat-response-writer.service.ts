                                                                
import { Injectable } from '@nestjs/common';
import { ChatMessageRepository } from '../persistence/chat-message.repository';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';

type WriterState = {
  content: string;
  lastFlushedContent: string;
  timer: NodeJS.Timeout | null;
  flushing: Promise<void> | null;
  dirty: boolean;
  traceId: string | null;
};

@Injectable()
export class ChatResponseWriter {
  private readonly states = new Map<string, WriterState>();
  private readonly closedTraces = new Set<string>();
  private readonly flushDelayMs = 300;

  constructor(
    private readonly messages: ChatMessageRepository,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {}

     
                         
    
          
                                
                                           
                                                 
     
  appendBuffer(input: {
    messageId: string;
    chunk: string;
    traceId?: string | null;
  }): string {
    if (input.traceId && this.closedTraces.has(input.traceId)) {
      return this.states.get(input.messageId)?.content ?? '';
    }
    const state = this.getState(input.messageId, input.traceId ?? null);
    const beforeLen = state.content.length;

    state.content += input.chunk;
    state.dirty = true;

    this.trace.debug('writer.buffer_append', {
      trace: state.traceId,
      assistantMessageId: input.messageId,
      deltaLen: input.chunk.length,
      beforeLen,
      afterLen: state.content.length,
    });

    return state.content;
  }

     
          
    
                              
                 
                 
                                    
     
  scheduleFlush(input: {
    messageId: string;
    traceId?: string | null;
    delayMs?: number;
  }): void {
    const state = this.getState(input.messageId, input.traceId ?? null);

    if (state.timer) {
      return;
    }

    const delayMs = input.delayMs ?? this.flushDelayMs;

    this.trace.debug('writer.flush_scheduled', {
      trace: state.traceId,
      assistantMessageId: input.messageId,
      delayMs,
      contentLen: state.content.length,
      dirty: state.dirty,
    });

    state.timer = setTimeout(() => {
      state.timer = null;

      void this.flushNow({
        messageId: input.messageId,
        traceId: state.traceId,
        reason: 'scheduled',
      }).catch((error) => {
        this.trace.warn('writer.flush_failed', {
          trace: state.traceId,
          assistantMessageId: input.messageId,
          reason: 'scheduled',
          error: error?.message ?? String(error),
        });
      });
    }, delayMs);
  }

     
                        
    
        
                
                      
               
     
  async flushNow(input: {
    messageId: string;
    traceId?: string | null;
    reason?: string | null;
  }): Promise<void> {
    const state = this.states.get(input.messageId);

    if (!state) {
      this.trace.debug('writer.flush_skip_no_state', {
        trace: input.traceId ?? null,
        assistantMessageId: input.messageId,
        reason: input.reason ?? null,
      });
      return;
    }

    if (input.traceId && !state.traceId) {
      state.traceId = input.traceId;
    }

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (state.flushing) {
      this.trace.debug('writer.flush_wait_existing', {
        trace: state.traceId,
        assistantMessageId: input.messageId,
        reason: input.reason ?? null,
      });

      await state.flushing;

      if (!state.dirty || state.content === state.lastFlushedContent) {
        return;
      }
    }

    if (!state.dirty || state.content === state.lastFlushedContent) {
      this.trace.debug('writer.flush_skip_clean', {
        trace: state.traceId,
        assistantMessageId: input.messageId,
        reason: input.reason ?? null,
        contentLen: state.content.length,
      });
      return;
    }

    const contentToPersist = state.content;
    const previousPersistedLen = state.lastFlushedContent.length;

    this.trace.debug('writer.flush_start', {
      trace: state.traceId,
      assistantMessageId: input.messageId,
      reason: input.reason ?? null,
      previousPersistedLen,
      nextPersistedLen: contentToPersist.length,
    });

    state.flushing = this.messages
      .updateAssistantContent({
        messageId: input.messageId,
        content: contentToPersist,
      })
      .then(() => {
        state.lastFlushedContent = contentToPersist;
        state.dirty = state.content !== contentToPersist;

        this.trace.debug('writer.flush_done', {
          trace: state.traceId,
          assistantMessageId: input.messageId,
          reason: input.reason ?? null,
          persistedLen: contentToPersist.length,
          currentBufferLen: state.content.length,
          stillDirty: state.dirty,
        });
      })
      .finally(() => {
        state.flushing = null;
      });

    await state.flushing;

       
                                             
       
    if (state.dirty && state.content !== state.lastFlushedContent) {
      this.scheduleFlush({
        messageId: input.messageId,
        traceId: state.traceId,
      });
    }
  }

  read(messageId: string): string {
    const content = this.states.get(messageId)?.content ?? '';

    this.trace.debug('writer.read', {
      assistantMessageId: messageId,
      contentLen: content.length,
    });

    return content;
  }

  hydrate(input: {
    messageId: string;
    traceId: string;
    content: string;
  }): void {
    const existing = this.states.get(input.messageId);
    if (existing?.timer) clearTimeout(existing.timer);

    this.states.set(input.messageId, {
      content: input.content,
      lastFlushedContent: input.content,
      timer: null,
      flushing: null,
      dirty: false,
      traceId: input.traceId,
    });

    this.closedTraces.delete(input.traceId);

    this.trace.debug('writer.hydrated', {
      trace: input.traceId,
      assistantMessageId: input.messageId,
      contentLen: input.content.length,
    });
  }

  openTrace(traceId: string): void {
    this.closedTraces.delete(traceId);
  }

  closeTrace(traceId: string): void {
    if (traceId) this.closedTraces.add(traceId);
  }

  isTraceClosed(traceId: string): boolean {
    return this.closedTraces.has(traceId);
  }

  clear(messageId: string) {
    const state = this.states.get(messageId);
    const beforeLen = state?.content.length ?? 0;

    if (state?.timer) {
      clearTimeout(state.timer);
    }

    this.states.delete(messageId);

    this.trace.debug('writer.clear', {
      assistantMessageId: messageId,
      beforeLen,
    });
  }

  private getState(messageId: string, traceId: string | null): WriterState {
    const existing = this.states.get(messageId);

    if (existing) {
      if (traceId && !existing.traceId) {
        existing.traceId = traceId;
      }

      return existing;
    }

    const created: WriterState = {
      content: '',
      lastFlushedContent: '',
      timer: null,
      flushing: null,
      dirty: false,
      traceId,
    };

    this.states.set(messageId, created);

    this.trace.debug('writer.state_created', {
      trace: traceId,
      assistantMessageId: messageId,
    });

    return created;
  }
}
