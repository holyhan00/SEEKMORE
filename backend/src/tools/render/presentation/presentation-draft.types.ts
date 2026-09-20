import type {
  PresentationDesignDNA,
  PresentationDesignStudy,
  PresentationFill,
  PresentationPageSpec,
  PresentationScene,
  PresentationSlideDesignIntent,
} from './presentation.types';

export interface PresentationOutlineItem {
  id: string;
  title?: string;
  purpose: string;
  keyMessage?: string;
  designIntent?: PresentationSlideDesignIntent;
}

export interface PresentationDraftSlideSpec {
  id: string;
  purpose?: string;
  designIntent?: PresentationSlideDesignIntent;
  background?: PresentationFill;
  scene: PresentationScene;
}

export interface PresentationDraftPartition {
  userId: string;
  agentId: string;
  conversationId: string;
}

export interface PresentationDraftDocument {
  id: string;
  revision: number;
  partition: PresentationDraftPartition;
  objective: {
    purpose: string;
    audience?: string;
    usage?: string;
    language?: string;
  };
  narrative: {
    title: string;
    storyline?: string;
    outline: PresentationOutlineItem[];
  };
  design: {
    page: PresentationPageSpec;
    study: PresentationDesignStudy;
    dna: PresentationDesignDNA;
  };
  output: {
    format: 'pptx';
    filename: string;
  };
  slides: Record<string, PresentationDraftSlideSpec>;
  createdAt: string;
  updatedAt: string;
  lastFinalized?: {
    revision: number;
    objectId: string;
    finalizedAt: string;
  };
}
