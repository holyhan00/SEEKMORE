import { Injectable } from '@nestjs/common';
import { RuntimeObjectService } from '../../object-runtime/object/object.service';
import type { ResolvedUserLlmConfig } from '../../llm-settings/contracts/llm-settings.types';
import type { AgentRuntimeContentPart } from '../../seekmore-agent/contracts/agent-turn.types';
import { ModelGatewayService } from '../../seekmore-agent/runtime/model/model-gateway.service';
import type { VisionAnalysisResult, VisionAnalyzeRequest } from '../contracts/vision.types';
import {
  modelImageInputMaxSourceBytes,
  modelImageInputTargetBytes,
  modelImageInputTotalBudgetBytes,
  prepareModelImage,
} from '../image-input/model-image-input';

@Injectable()
export class VisionService {
  constructor(
    private readonly objects: RuntimeObjectService,
    private readonly gateway: ModelGatewayService,
  ) {}

  async analyze(
    input: VisionAnalyzeRequest & { model: ResolvedUserLlmConfig },
  ): Promise<VisionAnalysisResult> {
    const objectIds = [...new Set(
      input.objectIds
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    )];
    const parts: AgentRuntimeContentPart[] = [];
    const objectObservations: Array<{ objectId: string; contentHash: string; versionNo: number }> = [];
    const instruction = String(input.instruction ?? '').trim();
    if (instruction) parts.push({ type: 'text', text: instruction });

    const totalImageBudget = modelImageInputTotalBudgetBytes();
    const perImageTarget = Math.min(
      modelImageInputTargetBytes(),
      Math.max(
        256 * 1024,
        Math.floor(totalImageBudget / Math.max(1, objectIds.length)),
      ),
    );

    for (const objectId of objectIds) {
      const { object, buffer } = await this.objects.readBuffer(
        {
          userId: input.userId,
          agentId: input.agentId,
          conversationId: input.conversationId,
        },
        objectId,
        modelImageInputMaxSourceBytes(),
      );
      if (object.objectKind !== 'image') throw new Error('VISION_OBJECT_INVALID');
      objectObservations.push({ objectId: object.id, contentHash: object.contentHash, versionNo: object.versionNo });

      const prepared = await prepareModelImage({
        buffer,
        mimeType: object.mimeType,
        targetBytes: perImageTarget,
      });

      parts.push({
        type: 'image',
        objectId,
        mimeType: prepared.mimeType,
        dataBase64: prepared.buffer.toString('base64'),
      });
    }

    const result = await this.gateway.generate({
      traceId: input.traceId,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      route: {
        provider: input.model.provider,
        model: input.model.model,
        baseUrl: input.model.baseUrl,
        apiKey: input.model.apiKey,
        apiMode: input.model.apiMode,
        headers: input.model.headers,
        protocol: input.model.protocol,
        capabilities: input.model.capabilities,
      },
      messages: [{ role: 'user', content: parts }],
      tools: [],
      temperature: null,
      maxTokens: 4096,
      signal: input.signal,
      firstTokenTimeoutMs: 120_000,
      idleTimeoutMs: 300_000,
      totalTimeoutMs: 600_000,
    });

    return {
      analysis: {
        objectIds,
        summary: result.content,
        provider: input.model.providerKey,
        model: input.model.model,
      },
      objectObservations,
    };
  }
}
