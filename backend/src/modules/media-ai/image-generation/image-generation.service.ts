import { BadRequestException, Injectable } from '@nestjs/common';
import { RuntimeObjectService } from '../../object-runtime/object/object.service';
import type { ObjectCatalogCard } from '../../object-runtime/object/object.types';
import type {
  GenerateImageInput,
} from '../contracts/image-generation.types';
import { ImageProviderRegistry } from './image-provider.registry';
import { ImageReferencePreparationService } from './image-reference-preparation.service';
import { normalizedCount, normalizedOutputSize } from './providers/image-provider.util';

@Injectable()
export class ImageGenerationService {
  constructor(
    private readonly objects: RuntimeObjectService,
    private readonly providers: ImageProviderRegistry,
    private readonly referencePreparation: ImageReferencePreparationService,
  ) {}

  async generate(input: GenerateImageInput): Promise<{ objects: ObjectCatalogCard[] }> {
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new BadRequestException('IMAGE_PROMPT_REQUIRED');
    const config = input.model;
    const referenceIds = input.sourceObjectIds ?? [];
    if (referenceIds.length > 0 && !config.capabilities.imageEditing) {
      throw new BadRequestException('IMAGE_EDITING_NOT_SUPPORTED');
    }
    if (input.maskObjectId && !config.capabilities.imageMaskEditing) {
      throw new BadRequestException('IMAGE_MASK_EDITING_NOT_SUPPORTED');
    }
    if (input.maskObjectId && referenceIds.length === 0) {
      throw new BadRequestException('IMAGE_MASK_SOURCE_REQUIRED');
    }
    const maximumInputImages = Math.max(1, Number(config.capabilities.maximumInputImages ?? 1));
    const prepared = await this.referencePreparation.prepare({
      partition: input,
      referenceIds,
      maximumInputImages,
      maskObjectId: input.maskObjectId,
    });
    const references = prepared.references;
    const mask = prepared.mask;
    const outputFormat = input.outputFormat ?? 'png';
    const result = await this.providers.resolve(config).generate({
      config,
      prompt,
      references,
      mask,
      count: normalizedCount(input.count ?? 1),
      aspectRatio: String(input.aspectRatio ?? '').trim() || null,
      outputSize: normalizedOutputSize(input.outputSize),
      quality: input.quality ?? 'standard',
      outputFormat,
      signal: input.signal,
    });

    const cards: ObjectCatalogCard[] = [];
    for (const [index, image] of result.images.entries()) {
      const extension = extensionForMime(image.mimeType, outputFormat);
      const object = await this.objects.createGenerated({
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        originalName: `generated-image-${Date.now()}-${index + 1}.${extension}`,
        mimeType: image.mimeType,
        buffer: image.buffer,
        metadata: {
          origin: {
            type: references.length || mask ? 'edited' : 'generated',
            sourceObjectIds: references.map((item) => item.objectId),
            maskObjectId: mask?.objectId ?? null,
          },
          generation: {
            sourceTool: 'image.generate',
            batchId: input.generationBatchId,
            index,
            provider: config.providerKey,
            model: config.model,
            prompt,
            aspectRatio: String(input.aspectRatio ?? '').trim() || null,
            outputSize: normalizedOutputSize(input.outputSize),
            revisedPrompt: result.revisedPrompt ?? null,
          },
        },
      });
      cards.push(await this.objects.inspectCard({
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
      }, object.id));
    }
    return { objects: cards };
  }
}

function extensionForMime(mimeType: string, fallback: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/png') return 'png';
  return fallback === 'jpeg' ? 'jpg' : fallback;
}
