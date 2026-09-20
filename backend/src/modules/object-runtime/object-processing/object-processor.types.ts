import type { ObjectKind } from '../object/object.types';

export interface ObjectProcessingInput {
  objectKind: ObjectKind;
  originalName: string;
  extension: string;
  mimeType: string;
  buffer: Buffer;
}

export interface ObjectMediaMetadata {
  width?: number;
  height?: number;
  format?: string;
  hasAlpha?: boolean;
  durationMs?: number;
  sampleRate?: number;
  channels?: number;
  bitrate?: number;
  codec?: string;
}

export interface ObjectProcessingResult {
  processor: string;
  processorVersion: string;
  capabilities: string[];
  contentSummary?: string | null;
  parsedContent?: Record<string, unknown> | null;
  media?: ObjectMediaMetadata | null;
  metadata?: Record<string, unknown>;
}

export interface ObjectProcessor {
  readonly name: string;
  supports(kind: ObjectKind): boolean;
  process(input: ObjectProcessingInput): Promise<ObjectProcessingResult>;
}
