                                                           
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ChatGateway } from '../chat.gateway';
import { EVT_CHAT_TITLE_CREATED, EVT_CHAT_TITLE_UPDATED } from '../types/chat.events';

@Injectable()
export class TitleWsListener {
  private readonly logger = new Logger(TitleWsListener.name);
  constructor(private readonly gateway: ChatGateway) {}

  @OnEvent(EVT_CHAT_TITLE_CREATED, { async: true })
  onCreated(payload: {
    userId: string;
    agentId: string;
    conversationId: string;
    title: string;
    titleVersion: number;
    titleUpdatedAt: string | Date;
  }) {
    this.logger.debug(`[TitleWS] created -> push`, payload);
    this.gateway.emitTitleCreated(payload.userId, {
      conversationId: payload.conversationId,
      title: payload.title,
      agentId: payload.agentId,
      titleVersion: payload.titleVersion,
      titleUpdatedAt: new Date(payload.titleUpdatedAt).toISOString(),
    });
  }

  @OnEvent(EVT_CHAT_TITLE_UPDATED, { async: true })
  onUpdated(payload: {
    userId: string;
    agentId: string;
    conversationId: string;
    title: string;
    titleVersion: number;
    titleUpdatedAt: string | Date;
  }) {
    this.logger.debug(`[TitleWS] updated -> push`, payload);
    this.gateway.emitTitleUpdated(payload.userId, {
      conversationId: payload.conversationId,
      title: payload.title,
      agentId: payload.agentId,
      titleVersion: payload.titleVersion,
      titleUpdatedAt: new Date(payload.titleUpdatedAt).toISOString(),
    });
  }
}