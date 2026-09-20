import type { RenderArtifact, RenderToolDescriptor } from '../render.types';

export interface RenderDeliveredFile {
  filename: string;
  path: string;
  relativePath: string;
  absolutePath: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  created: true;
}

export interface RenderDeliveryResult {
  artifact: RenderArtifact & {
    id: string;
    artifactId: string;
    relativePath: string;
    absolutePath: string;
    path: string;
    sizeBytes: number;
    status: 'ready';
  };
  files: RenderDeliveredFile[];
  objects?: Array<Record<string, unknown>>;
  tool?: RenderToolDescriptor;
  meta: Record<string, unknown>;
}
