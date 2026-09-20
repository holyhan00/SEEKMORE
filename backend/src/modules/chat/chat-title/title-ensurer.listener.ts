                                                                
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ChatTitleService } from './chat-title.service';
import { EVT_CHAT_MESSAGE_CREATED } from '../types/chat.events';

@Injectable()
export class TitleEnsurerListener {
  private readonly logger = new Logger(TitleEnsurerListener.name);

  constructor(private readonly titleSvc: ChatTitleService) {}

     
                    
    
                
                    
     
  @OnEvent(EVT_CHAT_MESSAGE_CREATED, { async: true })
  async handleMessageCreated(payload: {
    conversationId: string;
    userId?: string | null;
    role?: string | null;
  }) {
    const conversationId = String(payload?.conversationId ?? '').trim();
    if (!conversationId) return;

    const role = String(payload?.role ?? '').toLowerCase();

       
                             
                                             
       
    if (role && role !== 'user') return;

    this.logger.debug(`[TitleKick] on chat.message.created conv=${conversationId}`);

    try {
      const ret = await this.titleSvc.ensureTitleFromDB({
        conversationId,
        userId: payload?.userId ?? null,
      });

      if ((ret as any)?.updated) {
        this.logger.log(
          `[TitleKick] ensureTitleFromDB updated conv=${conversationId} title="${(ret as any)?.title}"`,
        );
      } else {
        this.logger.debug(
          `[TitleKick] ensureTitleFromDB no-update conv=${conversationId} reason=${(ret as any)?.reason}`,
        );
      }
    } catch (e: any) {
      this.logger.warn(
        `[TitleKick] ensureTitleFromDB failed conv=${conversationId} ${e?.message || e}`,
      );
    }
  }
}