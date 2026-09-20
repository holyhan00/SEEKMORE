import { Injectable } from '@nestjs/common';
import type { RenderPlanningCapability } from './render-planning-capability';
import type { RenderPlanFormat, RenderPlanKind } from './render-plan.types';
import { RenderPlanningError } from './render-planning.errors';

@Injectable()
export class RenderPlanningRegistry {
  private readonly capabilities = new Map<RenderPlanKind, RenderPlanningCapability>();

  register(capability: RenderPlanningCapability): void {
    const existing = this.capabilities.get(capability.kind);
    if (existing) {
      throw new RenderPlanningError(
        'RENDER_PLANNING_CAPABILITY_DUPLICATE',
        `Render planning capability already registered: ${capability.kind}`,
        'planning',
      );
    }
    this.capabilities.set(capability.kind, capability);
  }

  resolve(kind: RenderPlanKind, format: RenderPlanFormat): RenderPlanningCapability {
    const capability = this.capabilities.get(kind);
    if (!capability) {
      throw new RenderPlanningError(
        'RENDER_PLANNING_CAPABILITY_NOT_FOUND',
        `No render planning capability registered for ${kind}`,
        'planning',
      );
    }
    if (!capability.formats.includes(format)) {
      throw new RenderPlanningError(
        'RENDER_PLANNING_FORMAT_UNSUPPORTED',
        `Render planning capability ${kind} does not support ${format}`,
        'planning',
      );
    }
    return capability;
  }

  list(): Array<{ kind: RenderPlanKind; formats: readonly RenderPlanFormat[] }> {
    return Array.from(this.capabilities.values()).map((capability) => ({
      kind: capability.kind,
      formats: capability.formats,
    }));
  }
}
