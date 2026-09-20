import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Tool } from '../../../tools/toolstypes';
import type { AgentRuntimeToolDefinition } from '../contracts/agent-turn.types';

export interface ToolRuntimeNameResolution {
  tool: Tool;
  canonicalName: string;
  runtimeName: string;
  matchedBy: 'canonical' | 'runtime' | 'legacy';
}

@Injectable()
export class ToolSchemaAdapterService {
  toRuntime(tool: Tool): AgentRuntimeToolDefinition {
    return {
      name: this.encodeName(tool.name),
      metadata: { canonicalName: tool.name, namespace: tool.name.split('.')[0], capabilityKinds: tool.capabilityKinds ?? [],
        requiredSurfaces: tool.requiredSurfaces ?? [], sourceTypes: tool.sourceTypes ?? [], providerKind: tool.providerKind,
        sideEffectClass: tool.sideEffectClass, runtimeOnly: tool.runtimeOnly },
      description: [
        tool.displayName ? `${tool.displayName}.` : '',
        tool.description,
        `Canonical Seekmore tool id: ${tool.name}.`,
      ].filter(Boolean).join(' ').trim(),
      inputSchema: this.objectSchema(tool.inputSchema),
    };
  }

  resolveRuntimeName(name: string, tools: Tool[]): Tool | null {
    return this.resolveRuntimeNameDetailed(name, tools)?.tool ?? null;
  }

     
                                                                        
                                                                            
                                                                          
     
  resolveRuntimeNameDetailed(
    name: string,
    tools: Tool[],
  ): ToolRuntimeNameResolution | null {
    const requested = String(name ?? '').trim();
    if (!requested) return null;

    const candidates = this.uniqueByCanonicalName(tools);
    const canonical = candidates.filter((tool) => tool.name === requested);
    if (canonical.length === 1) {
      return this.resolution(canonical[0], 'canonical');
    }
    if (canonical.length > 1) return null;

    const runtime = candidates.filter(
      (tool) => this.encodeName(tool.name) === requested,
    );
    if (runtime.length === 1) {
      return this.resolution(runtime[0], 'runtime');
    }
    if (runtime.length > 1) return null;

    const legacy = candidates.filter(
      (tool) => this.legacyEncodedName(tool.name) === requested,
    );
    if (legacy.length === 1) {
      return this.resolution(legacy[0], 'legacy');
    }

                                                           
    return null;
  }

  encodeName(name: string): string {
    const legacy = this.legacyEncodedName(name);
    if (legacy === name && legacy.length <= 64) return legacy;
    const suffix = createHash('sha256').update(name).digest('hex').slice(0, 8);
    return `${legacy.slice(0, Math.max(1, 55))}_${suffix}`;
  }

  private uniqueByCanonicalName(tools: Tool[]): Tool[] {
    const seen = new Set<string>();
    const output: Tool[] = [];

    for (const tool of tools) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      output.push(tool);
    }

    return output;
  }

  private resolution(
    tool: Tool,
    matchedBy: ToolRuntimeNameResolution['matchedBy'],
  ): ToolRuntimeNameResolution {
    return {
      tool,
      canonicalName: tool.name,
      runtimeName: this.encodeName(tool.name),
      matchedBy,
    };
  }

  private legacyEncodedName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '__');
  }

  private objectSchema(value: object | undefined): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        type: 'object',
        properties: {},
        additionalProperties: true,
      };
    }
    return value as Record<string, unknown>;
  }
}
