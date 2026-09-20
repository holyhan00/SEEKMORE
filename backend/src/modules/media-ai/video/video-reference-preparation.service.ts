import { BadRequestException, Injectable } from '@nestjs/common';
import { RuntimeObjectService } from '../../object-runtime/object/object.service';
import { prepareModelImage } from '../image-input/model-image-input';
import type {
  PreparedVideoReference,
  VideoReferenceDescriptor,
  VideoReferenceRole,
} from './video-generation.types';

const MAX_REFERENCE_BYTES = 100 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

@Injectable()
export class VideoReferencePreparationService {
  constructor(private readonly objects: RuntimeObjectService) {}

  async prepare(input: {
    userId: string;
    agentId: string;
    conversationId: string;
    references: VideoReferenceDescriptor[];
  }): Promise<PreparedVideoReference[]> {
    const normalized = normalizeReferences(input.references);
    assertReferenceShape(normalized);

    const prepared: PreparedVideoReference[] = [];
    for (const reference of normalized) {
      const { object, buffer } = await this.objects.readBuffer(
        input,
        reference.objectId,
        MAX_REFERENCE_BYTES,
      );

      if (reference.role === 'reference_video') {
        if (object.objectKind !== 'video') {
          throw new BadRequestException('VIDEO_REFERENCE_VIDEO_OBJECT_INVALID');
        }
        if (String(object.mimeType ?? '').trim().toLowerCase() !== 'video/mp4') {
          throw new BadRequestException('VIDEO_REFERENCE_VIDEO_FORMAT_UNSUPPORTED');
        }
        prepared.push({
          objectId: reference.objectId,
          role: 'reference_video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          buffer,
        });
        continue;
      }

      if (object.objectKind !== 'image') {
        throw new BadRequestException('VIDEO_REFERENCE_OBJECT_INVALID');
      }
      const mimeType = normalizeImageMimeType(object.mimeType);
      if (!mimeType) {
        throw new BadRequestException('VIDEO_REFERENCE_IMAGE_FORMAT_UNSUPPORTED');
      }
      const normalizedImage = await prepareModelImage({
        buffer,
        mimeType,
      });
      prepared.push({
        ...reference,
        mediaType: 'image',
        mimeType: normalizedImage.mimeType,
        buffer: normalizedImage.buffer,
        width: normalizedImage.width,
        height: normalizedImage.height,
      });
    }
    return prepared;
  }
}

function normalizeReferences(references: VideoReferenceDescriptor[]): VideoReferenceDescriptor[] {
  const output: VideoReferenceDescriptor[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(references) ? references : []) {
    const objectId = String(item?.objectId ?? '').trim();
    const role = normalizeRole(item?.role);
    if (!objectId || !role) throw new BadRequestException('VIDEO_REFERENCE_INVALID');
    const key = `${role}:${objectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ objectId, role });
  }
  return output;
}

function assertReferenceShape(references: VideoReferenceDescriptor[]): void {
  if (references.length > 12) {
    throw new BadRequestException('VIDEO_REFERENCE_LIMIT_EXCEEDED');
  }
  const byRole = (role: VideoReferenceRole) => references.filter((item) => item.role === role);
  if (byRole('first_frame').length > 1 || byRole('last_frame').length > 1) {
    throw new BadRequestException('VIDEO_FRAME_REFERENCE_DUPLICATE');
  }
}

function normalizeRole(value: unknown): VideoReferenceRole | null {
  const role = String(value ?? '').trim();
  return role === 'first_frame'
    || role === 'last_frame'
    || role === 'subject'
    || role === 'style'
    || role === 'reference'
    || role === 'reference_video'
    ? role
    : null;
}

function normalizeImageMimeType(value: unknown): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const mime = String(value ?? '').trim().toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) return null;
  return mime === 'image/jpg'
    ? 'image/jpeg'
    : mime as 'image/png' | 'image/jpeg' | 'image/webp';
}
