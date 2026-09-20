import { Injectable } from '@nestjs/common';
import type { RuntimeObject } from '@prisma/client';

@Injectable()
export class RuntimeObjectCapabilityPolicyService {
  isReadyForMessageInput(object: Pick<RuntimeObject, 'status' | 'objectKind' | 'metadata' | 'deletedAt'>): boolean {
    if (object.deletedAt || object.status !== 'available') return false;
    const metadata = record(object.metadata);
    const processing = record(metadata.processing);
    if (String(processing.status ?? '') !== 'ready') return false;
    const capabilities = new Set(
      Array.isArray(metadata.capabilities)
        ? metadata.capabilities.map((value) => String(value))
        : [],
    );
    if (object.objectKind === 'image') {
      return capabilities.has('vision_input') && capabilities.has('view');
    }
    if (object.objectKind === 'audio') {
      return capabilities.has('play') && capabilities.has('download');
    }
    return capabilities.has('read');
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
