                                           
export type RenderToolName =
  | 'document.render.docx'
  | 'document.render.pdf'
  | 'spreadsheet.render.xlsx'
  | 'presentation.pptx.write'
  | 'package.render.zip';

export type RenderCategory =
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'package';

export type RenderPayload = Record<string, unknown>;

export interface RenderRequest<
  TPayload extends RenderPayload = RenderPayload,
> {
  toolName: RenderToolName;

  userId?: string;
  conversationId?: string;
  requestId?: string;

     
                                                 
                             
     
  source?: string;

  filename?: string;
  title?: string;

  payload: TPayload;

     
                                            
     
  meta?: Record<string, unknown>;
}

export interface RenderArtifactPreview {
  kind:
    | 'document'
    | 'spreadsheet'
    | 'presentation'
    | 'html'
    | 'markdown'
    | 'text'
    | 'image'
    | 'pdf';
  mimeType: string;
  extension: string;
  buffer: Buffer;
}

export interface RenderArtifact {
  id?: string;
  artifactId?: string;

  userId?: string;
  conversationId?: string;
  requestId?: string;

  filename: string;
  originalName?: string;
  mimeType: string;
  extension: string;

     
                            
                                                               
     
  buffer?: Buffer;
  sizeBytes?: number;
  preview?: RenderArtifactPreview;

     
                              
                                                     
     
  storageKey?: string;
  absolutePath?: string;

     
                        
                                                                  
     
  url?: string | null;
  publicUrl?: string | null;
  relativeUrl?: string | null;

  provider?: string;
  status?: string;

  source?: string;
  category?: string;
  renderer?: string;
  rendererVersion?: string;

  createdAt?: string;
  updatedAt?: string;

  meta?: Record<string, unknown>;
}

export interface RenderToolDescriptor {
  name: RenderToolName;
  version: string;
  category: RenderCategory;
  enabled: boolean;
  description?: string;
  outputMimeType: string;
  outputExtension: string;

     
                                         
     
  tags?: string[];

     
                                       
     
  defaultTimeoutMs?: number;
}

export interface RenderTool<
  TPayload extends RenderPayload = RenderPayload,
> {
  readonly descriptor: RenderToolDescriptor;
  canHandle(request: RenderRequest): boolean;
  render(request: RenderRequest<TPayload>): Promise<RenderArtifact>;
}

export interface RenderDispatchResult {
  ok: true;
  artifact: RenderArtifact;
  tool: RenderToolDescriptor;
  meta: {
    toolName: RenderToolName;
    durationMs: number;
    requestId?: string;
    conversationId?: string;
    userId?: string;
    source?: string;
  };
}