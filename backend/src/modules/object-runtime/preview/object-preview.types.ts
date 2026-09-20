export type RuntimeObjectPreviewKind =
  | 'image'
  | 'pdf'
  | 'html'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'markdown'
  | 'text'
  | 'audio'
  | 'video'
  | 'unsupported';

export interface RuntimeObjectPreviewManifest {
  objectId: string;
  objectKind: string;
  mimeType: string;
  extension: string;
  displayName: string;
  downloadUrl: string;
  preview: {
    kind: RuntimeObjectPreviewKind;
    available: boolean;
    mimeType?: string;
    url?: string;
  };
}

export interface RuntimeObjectPreviewSource {
  objectId: string;
  kind: Exclude<RuntimeObjectPreviewKind, 'unsupported'>;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  displayName: string;
}
