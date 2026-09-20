import { Injectable } from '@nestjs/common';
import type { ToolContext } from '../../toolstypes';
import type { RenderArtifact, RenderToolDescriptor } from '../render.types';
import type { RenderDeliveryResult } from './render-delivery.types';
import { RenderObjectDeliveryService } from './render-object-delivery.service';

@Injectable()
export class RenderOutputCommitService {
  constructor(
    private readonly objectDelivery: RenderObjectDeliveryService,
  ) {}

  persist(input: {
    artifact: RenderArtifact;
    context: ToolContext;
    filename?: string;
    tool?: RenderToolDescriptor;
    meta?: Record<string, unknown>;
  }): Promise<RenderDeliveryResult> {
    return this.objectDelivery.persist(input);
  }
}
