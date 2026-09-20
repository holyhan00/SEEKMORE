                                                    

export const CHAT_PENDING_FILE_LIMIT = 10;

export type ChatPendingFileStatus =
  | "validating"
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "unsupported";

   
                          
                                           
   
export interface ChatPendingFile {
  clientId: string;
  position: number;

                                              
  objectId?: string;

  originalName: string;
  displayName: string;

  sizeBytes: number;
  sizeText: string;

  objectKind: string;
  extension?: string;
  mimeType?: string;

  downloadUrl?: string;
  previewUrl?: string;
  localUrl?: string;

  media?: {
    width?: number;
    height?: number;
    format?: string;
    hasAlpha?: boolean;
  };

  status: ChatPendingFileStatus;
  uploadProgress?: number;
  contentHash?: string;
  versionNo?: number;
  error?: string;
  capabilities?: string[];
  contentSummary?: string | null;
  parser?: string | null;
  processorVersion?: string | null;
}
