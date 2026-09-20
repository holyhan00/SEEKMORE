import { Injectable } from '@nestjs/common';
import type { ObjectKind } from '../object/object.types';
import { AudioObjectProcessor } from './audio-object.processor';
import { DocumentObjectProcessor } from './document-object.processor';
import { ImageObjectProcessor } from './image-object.processor';
import type { ObjectProcessingInput, ObjectProcessingResult, ObjectProcessor } from './object-processor.types';

@Injectable()
export class ObjectProcessingRegistry {
  private readonly processors: ObjectProcessor[];

  constructor(
    image: ImageObjectProcessor,
    audio: AudioObjectProcessor,
    document: DocumentObjectProcessor,
  ) {
    this.processors = [image, audio, document];
  }

  async process(input: ObjectProcessingInput): Promise<ObjectProcessingResult> {
    const processor = this.processors.find((item) => item.supports(input.objectKind));
    if (!processor) throw new Error(`OBJECT_PROCESSOR_NOT_FOUND:${input.objectKind}`);
    return processor.process(input);
  }

  supports(kind: ObjectKind): boolean {
    return this.processors.some((item) => item.supports(kind));
  }
}
