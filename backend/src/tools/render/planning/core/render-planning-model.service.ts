import { Injectable, Logger } from '@nestjs/common';
import { LLMClientService } from '../../../../modules/llm/llm-client.service';
import type { RenderPlanningModelPort, RenderPlanningModelRequest } from './render-planning-model.port';
import { RenderPlanningError } from './render-planning.errors';

@Injectable()
export class RenderPlanningModelService implements RenderPlanningModelPort {
  private readonly logger = new Logger(RenderPlanningModelService.name);

  constructor(private readonly llm: LLMClientService) {}

  async generate(request: RenderPlanningModelRequest): Promise<string> {
    const agentId = this.stringMetadata(request.context, 'agentId');
    const modelId = this.stringMetadata(request.context, 'modelId');
    const startedAt = Date.now();

    this.logger.log(
      `[RenderPlanningModel] start trace=${request.context.traceId ?? '-'} agent=${agentId ?? '-'} model=${modelId ?? '-'}`,
    );

    try {
      const output = await this.llm.chat({
        userId: request.context.userId,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        agentId,
        modelId,
        temperature: request.temperature ?? 0.2,
        thinking: {
          enabled: false,
          type: 'disabled',
        },
        abortSignal: request.context.abortSignal,
      });

      this.logger.log(
        `[RenderPlanningModel] done trace=${request.context.traceId ?? '-'} durationMs=${Date.now() - startedAt} chars=${output.length}`,
      );
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[RenderPlanningModel] failed trace=${request.context.traceId ?? '-'} durationMs=${Date.now() - startedAt} message=${message}`,
      );
      throw new RenderPlanningError(
        request.context.abortSignal?.aborted
          ? 'RENDER_PLANNING_CANCELED'
          : 'RENDER_PLANNING_MODEL_FAILED',
        request.context.abortSignal?.aborted
          ? 'Render planning was canceled.'
          : message,
        'planning',
        [],
        !request.context.abortSignal?.aborted,
      );
    }
  }

  private stringMetadata(
    context: RenderPlanningModelRequest['context'],
    key: string,
  ): string | undefined {
    const value = context.metadata?.[key];
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized || undefined;
  }
}
