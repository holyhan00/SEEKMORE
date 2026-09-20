import type { ChatObjectCard } from '../../../utils/types';

export type ObjectPreviewKind =
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

export interface ObjectPreviewManifest {
  objectId: string;
  objectKind: string;
  mimeType: string;
  extension: string;
  displayName: string;
  downloadUrl: string;
  preview: {
    kind: ObjectPreviewKind;
    available: boolean;
    mimeType?: string;
    url?: string;
  };
}

export interface ObjectPreviewContextValue {
  open: boolean;
  selectedObject: ChatObjectCard | null;
  objects: ChatObjectCard[];
  activeDeliveryKey: string | null;
  openObject: (
    object: ChatObjectCard,
    relatedObjects?: ChatObjectCard[],
  ) => void;
  close: () => void;
  selectObject: (objectId: string) => void;
  registerLiveDelivery: (
    messageId: string,
    objects: ChatObjectCard[],
  ) => void;
}
