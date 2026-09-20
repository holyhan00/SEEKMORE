                                                                         

import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

import { ToolsRegistry } from '../../../../tools/toolsregistry';
import type {
  Tool,
  ToolSideEffectClass,
} from '../../../../tools/toolstypes';

import type {
  SkillCapabilityDefinition,
  SkillCapabilityRiskLevel,
} from './skill-capability.types';

const RISK_WEIGHT: Record<SkillCapabilityRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  forbidden: 4,
};

@Injectable()
export class SkillCapabilityCatalogService {
  constructor(private readonly tools: ToolsRegistry) {}

  list(options: {
    availableOnly?: boolean;
    generationEligibleOnly?: boolean;
  } = {}): SkillCapabilityDefinition[] {
    const health = this.tools.health();
    const enabled = new Map<string, boolean>();

    for (const item of health) {
      enabled.set(
        this.providerKey(item.name, item.version),
        item.enabled,
      );
    }

    const grouped = new Map<
      string,
      SkillCapabilityDefinition
    >();

    for (const tool of this.tools.list()) {
      const capabilityKinds = [
        ...new Set(
          (tool.capabilityKinds ?? [])
            .map((item) => String(item ?? '').trim())
            .filter(Boolean),
        ),
      ];

      for (const capabilityId of capabilityKinds) {
        const key = capabilityId.toLowerCase();

        const providerEnabled =
          enabled.get(
            this.providerKey(tool.name, tool.version),
          ) ?? true;

        const current = grouped.get(key);

        const provider = {
          toolId: tool.name,
          version: tool.version ?? null,
          displayName: tool.displayName ?? tool.name,
          providerKind: tool.providerKind ?? null,
          enabled: providerEnabled,
        };

        const toolRiskLevel = tool.riskLevel ?? 'low';

        if (!current) {
          grouped.set(key, {
            id: capabilityId,
            description: this.description(tool),
            riskLevel: toolRiskLevel,
            confirmationRequired:
              tool.requiresApproval === true,
            sideEffectClasses: tool.sideEffectClass
              ? [tool.sideEffectClass]
              : [],
            requiredSurfaces: [
              ...new Set(tool.requiredSurfaces ?? []),
            ],
            sourceTypes: [
              ...new Set(tool.sourceTypes ?? []),
            ],
            providers: [provider],
            supported: true,
            available: providerEnabled,
            generationEligible:
              this.generationEligible(tool, capabilityId),
          });

          continue;
        }

        current.description = this.preferDescription(
          current.description,
          this.description(tool),
        );

        current.riskLevel = this.maxRisk(
          current.riskLevel,
          toolRiskLevel,
        );

        current.confirmationRequired ||=
          tool.requiresApproval === true;

        current.available ||= providerEnabled;

        current.generationEligible ||=
          this.generationEligible(tool, capabilityId);

        current.sideEffectClasses = this.unique([
          ...current.sideEffectClasses,
          ...(tool.sideEffectClass
            ? [tool.sideEffectClass]
            : []),
        ]);

        current.requiredSurfaces = this.unique([
          ...current.requiredSurfaces,
          ...(tool.requiredSurfaces ?? []),
        ]);

        current.sourceTypes = this.unique([
          ...current.sourceTypes,
          ...(tool.sourceTypes ?? []),
        ]);

        if (
          !current.providers.some(
            (item) =>
              item.toolId === provider.toolId &&
              item.version === provider.version,
          )
        ) {
          current.providers.push(provider);
        }
      }
    }

    return [...grouped.values()]
      .filter(
        (item) =>
          !options.availableOnly || item.available,
      )
      .filter(
        (item) =>
          !options.generationEligibleOnly ||
          item.generationEligible,
      )
      .sort((left, right) =>
        left.id.localeCompare(right.id),
      );
  }

  generationView(): SkillCapabilityDefinition[] {
    return this.list({
      availableOnly: true,
      generationEligibleOnly: true,
    });
  }

  find(
    capabilityId: string,
  ): SkillCapabilityDefinition | null {
    const normalized = String(capabilityId ?? '')
      .trim()
      .toLowerCase();

    if (!normalized) {
      return null;
    }

    return (
      this.list().find(
        (item) =>
          item.id.toLowerCase() === normalized,
      ) ?? null
    );
  }

  findByToolId(
    toolId: string,
  ): SkillCapabilityDefinition[] {
    const normalized = String(toolId ?? '')
      .trim()
      .toLowerCase();

    if (!normalized) {
      return [];
    }

    return this.list().filter((item) =>
      item.providers.some(
        (provider) =>
          provider.toolId.toLowerCase() === normalized,
      ),
    );
  }

  revision(): string {
    const payload = this.list().map((item) => ({
      id: item.id,
      available: item.available,
      providers: item.providers.map((provider) => ({
        toolId: provider.toolId,
        version: provider.version,
        enabled: provider.enabled,
      })),
    }));

    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  private generationEligible(
    tool: Tool,
    capabilityId: string,
  ): boolean {
      
                                        
                          
       
    if (tool.riskLevel === 'forbidden') {
      return false;
    }

    if (tool.providerKind === 'internal') {
      return false;
    }

    return !/^(?:skill|runtime|planning)\./i.test(
      capabilityId,
    );
  }

  private description(tool: Tool): string {
    return String(
      tool.description ||
        tool.displayName ||
        tool.name,
    ).trim();
  }

  private preferDescription(
    current: string,
    incoming: string,
  ): string {
    if (!current) {
      return incoming;
    }

    if (!incoming) {
      return current;
    }

    return incoming.length > current.length
      ? incoming
      : current;
  }

  private maxRisk(
    left: SkillCapabilityRiskLevel,
    right: SkillCapabilityRiskLevel,
  ): SkillCapabilityRiskLevel {
    return RISK_WEIGHT[right] > RISK_WEIGHT[left]
      ? right
      : left;
  }

  private providerKey(
    name: string,
    version?: string | null,
  ): string {
    return `${name}@${version ?? '1.0.0'}`;
  }

  private unique<T extends string>(
    items: T[],
  ): T[] {
    return [...new Set(items)];
  }
}