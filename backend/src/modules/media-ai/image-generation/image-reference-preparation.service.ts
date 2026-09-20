import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import { RuntimeObjectService } from '../../object-runtime/object/object.service';
import type {
  GenerateImageInput,
  ImageReferenceInput,
} from '../contracts/image-generation.types';
import { prepareModelImage } from '../image-input/model-image-input';

const DEFAULT_TARGET_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_LONG_SIDE = 2048;

@Injectable()
export class ImageReferencePreparationService {
  constructor(
    private readonly objects: RuntimeObjectService,
  ) {}

  async prepare(input: {
    partition: Pick<
      GenerateImageInput,
      'userId' | 'agentId' | 'conversationId'
    >;
    referenceIds: string[];
    maximumInputImages: number;
    maskObjectId?: string | null;
  }): Promise<{
    references: ImageReferenceInput[];
    mask: ImageReferenceInput | null;
  }> {
    const unique = [
      ...new Set(
        input.referenceIds
          .map((value) => String(value ?? '').trim())
          .filter(Boolean),
      ),
    ];

    if (unique.length > input.maximumInputImages) {
      throw new BadRequestException(
        'IMAGE_REFERENCE_LIMIT_EXCEEDED',
      );
    }

    const maskObjectId = String(
      input.maskObjectId ?? '',
    ).trim();

    const references: ImageReferenceInput[] = [];
    for (const objectId of unique) {
      references.push(
        await this.prepareReference(
          input.partition,
          objectId,
          Boolean(maskObjectId),
        ),
      );
    }

    const mask = maskObjectId
      ? await this.prepareMask(
          input.partition,
          maskObjectId,
          references[0] ?? null,
        )
      : null;

    return { references, mask };
  }

  private async prepareReference(
    partition: Pick<
      GenerateImageInput,
      'userId' | 'agentId' | 'conversationId'
    >,
    objectId: string,
    forceNormalize: boolean,
  ): Promise<ImageReferenceInput> {
    const { object, buffer } =
      await this.objects.readBuffer(
        partition,
        objectId,
        this.maxSourceBytes(),
      );

    if (object.objectKind !== 'image') {
      throw new BadRequestException(
        'IMAGE_REFERENCE_OBJECT_INVALID',
      );
    }

    const prepared = await prepareModelImage({
      buffer,
      mimeType: object.mimeType,
      targetBytes: this.targetBytes(),
      maxLongSide: this.maxLongSide(),
      forceNormalize,
      decodeFailureCode: 'IMAGE_REFERENCE_DECODE_FAILED',
      tooLargeCode: 'IMAGE_REFERENCE_PREPARATION_TOO_LARGE',
      processorUnavailableCode: 'IMAGE_REFERENCE_PROCESSOR_UNAVAILABLE',
    });

    return {
      objectId,
      mimeType: prepared.mimeType,
      buffer: prepared.buffer,
      width: prepared.width,
      height: prepared.height,
    };
  }

  private async prepareMask(
    partition: Pick<
      GenerateImageInput,
      'userId' | 'agentId' | 'conversationId'
    >,
    objectId: string,
    firstReference: ImageReferenceInput | null,
  ): Promise<ImageReferenceInput> {
    const { object, buffer } =
      await this.objects.readBuffer(
        partition,
        objectId,
        this.maxSourceBytes(),
      );

    if (object.objectKind !== 'image') {
      throw new BadRequestException(
        'IMAGE_REFERENCE_OBJECT_INVALID',
      );
    }

    const sharp = this.sharp();
    const referenceMetadata = firstReference
      ? await sharp(firstReference.buffer, {
          failOn: 'none',
        }).metadata()
      : null;

    const targetWidth = positiveInt(
      firstReference?.width
      ?? referenceMetadata?.width,
    );
    const targetHeight = positiveInt(
      firstReference?.height
      ?? referenceMetadata?.height,
    );

    let pipeline = sharp(buffer, {
      failOn: 'none',
      limitInputPixels: 100_000_000,
    });

    if (targetWidth && targetHeight) {
      pipeline = pipeline.resize(
        targetWidth,
        targetHeight,
        {
          fit: 'fill',
          kernel: 'nearest',
        },
      );
    } else {
      pipeline = pipeline.resize({
        width: this.maxLongSide(),
        height: this.maxLongSide(),
        fit: 'inside',
        withoutEnlargement: true,
        kernel: 'nearest',
      });
    }

    const prepared = await pipeline
      .png({
        compressionLevel: 9,
        palette: true,
        colours: 256,
      })
      .toBuffer({ resolveWithObject: true });

    if (prepared.data.length > this.targetBytes()) {
      throw new BadRequestException(
        'IMAGE_MASK_PREPARATION_TOO_LARGE',
      );
    }

    return {
      objectId,
      mimeType: 'image/png',
      buffer: prepared.data,
      width: positiveInt(prepared.info.width) ?? undefined,
      height: positiveInt(prepared.info.height) ?? undefined,
    };
  }

  private targetBytes(): number {
    return boundedPositiveInt(
      process.env.IMAGE_EDIT_REFERENCE_TARGET_BYTES,
      DEFAULT_TARGET_BYTES,
      256 * 1024,
      8 * 1024 * 1024,
    );
  }

  private maxSourceBytes(): number {
    return boundedPositiveInt(
      process.env.IMAGE_EDIT_REFERENCE_MAX_SOURCE_BYTES,
      DEFAULT_MAX_SOURCE_BYTES,
      8 * 1024 * 1024,
      512 * 1024 * 1024,
    );
  }

  private maxLongSide(): number {
    return boundedPositiveInt(
      process.env.IMAGE_EDIT_REFERENCE_MAX_LONG_SIDE,
      DEFAULT_MAX_LONG_SIDE,
      768,
      4096,
    );
  }

  private sharp(): any {
    try {
                                                                           
                                                               
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loaded = require('sharp');
      return loaded?.default ?? loaded;
    } catch {
      throw new InternalServerErrorException(
        'IMAGE_REFERENCE_PROCESSOR_UNAVAILABLE',
      );
    }
  }
}

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : null;
}

function boundedPositiveInt(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = positiveInt(value) ?? fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}
