                                                           
import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { LLMModule } from '../../llm/llm.module';

import { ChatTitleController } from './chat-title.controller';
import { ChatTitleService } from './chat-title.service';
import { TitleEnsurerListener } from './title-ensurer.listener';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => LLMModule),
  ],
  controllers: [ChatTitleController],
  providers: [
    ChatTitleService,
    TitleEnsurerListener,
  ],
  exports: [ChatTitleService],
})
export class ChatTitleModule {}