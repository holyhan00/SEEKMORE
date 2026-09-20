import { Injectable } from '@nestjs/common';
import type { AgentAttachedObject, AgentRuntimeToolDefinition } from '../../contracts/agent-turn.types';
import type { WorldSnapshot } from '../context/world-state.types';

export const CAPABILITY_SEARCH = 'seekmore_tools_search';
export function capabilitySearchDefinition(): AgentRuntimeToolDefinition {
  return { name: CAPABILITY_SEARCH, description: 'Search authorized SEEKMORE capabilities by task, namespace, or exact tool name. Matching tools become available on the next step. Does not grant permission or execute them.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 500 } }, required: ['query'], additionalProperties: false } };
}

@Injectable()
export class CapabilityResolverService {
  resolve(input: { goal: string; world: WorldSnapshot; currentInputObjects: AgentAttachedObject[]; authorizedTools: AgentRuntimeToolDefinition[]; loadedNames: ReadonlySet<string> }) {
    const authorized = new Map(input.authorizedTools.map((tool) => [tool.name, tool]));
    const names = new Set<string>();
    for (const tool of authorized.values()) {
      if (tool.name === CAPABILITY_SEARCH || tool.name === 'seekmore_request_user_input'
        || tool.metadata?.canonicalName === 'mcp.tools.search' || tool.metadata?.canonicalName === 'mcp.call'
        || input.loadedNames.has(tool.name)) names.add(tool.name);
    }
    const surfaces = new Set<string>();
    const workspace = input.world.sections.workspace;
    if (workspace?.status === 'observed' && workspace.freshness === 'current'
      && (workspace.value as { directory?: boolean } | null)?.directory === true) surfaces.add('workspace');
    const objects = input.world.sections.objects;
    if (objects?.status === 'observed' && objects.freshness === 'current'
      && Array.isArray(objects.value) && objects.value.length) surfaces.add('artifact');
    const currentObjectAtoms = this.objectAtoms(input.currentInputObjects);
    const objectSignal = [...currentObjectAtoms].join(' ');
    const ranked = this.rank([input.goal, objectSignal].filter(Boolean).join('\n'), [...authorized.values()], surfaces, currentObjectAtoms);
    for (const item of ranked.slice(0, 20)) names.add(item.tool.name);
    // Selection never creates a tool or substitutes a similarly named provider.
    const tools = [...authorized.values()].filter((tool) => names.has(tool.name));
    const namespaces = new Map<string, string[]>();
    for (const tool of authorized.values()) {
      const ns = tool.metadata?.namespace ?? 'runtime';
      namespaces.set(ns, [...(namespaces.get(ns) ?? []), tool.metadata?.canonicalName ?? tool.name]);
    }
    const catalog = [...namespaces].sort(([a], [b]) => a.localeCompare(b)).map(([name, tools]) => `${name}: ${tools.length} tools (${tools.slice(0, 4).join(', ')})`).join('\n');
    return { tools, catalog };
  }

  search(query: string, authorizedTools: AgentRuntimeToolDefinition[]): AgentRuntimeToolDefinition[] {
    if (!query.trim() || query.length > 500) return [];
    return this.rank(query, authorizedTools).filter((item) => item.score > 0).slice(0, 8).map((item) => item.tool);
  }

  private objectAtoms(objects: AgentAttachedObject[]): Set<string> {
    return this.atoms(objects.flatMap((object) => [
      object.objectKind,
      object.extension,
      object.mimeType,
      ...object.capabilities,
    ]));
  }

  private atoms(values: Array<string | null | undefined>): Set<string> {
    const output = new Set<string>();
    for (const value of values) {
      for (const token of String(value ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
        if (token.length >= 2) output.add(token);
      }
    }
    return output;
  }

  private rank(query: string, tools: AgentRuntimeToolDefinition[], observedSurfaces: ReadonlySet<string> = new Set(), currentObjectAtoms: ReadonlySet<string> = new Set()) {
    const normalized = query.toLowerCase();
    const tokens = normalized.match(/[\p{L}\p{N}_./-]{2,}/gu) ?? [];
    const terms = new Set(tokens);
    return tools.map((tool) => {
      const meta = tool.metadata;
      const identity = `${tool.name} ${meta?.canonicalName ?? ''} ${meta?.namespace ?? ''}`.toLowerCase();
      const tags = `${meta?.capabilityKinds.join(' ') ?? ''} ${meta?.requiredSurfaces.join(' ') ?? ''} ${meta?.sourceTypes?.join(' ') ?? ''}`.toLowerCase();
      const description = tool.description.toLowerCase();
      let score = normalized.includes(tool.name.toLowerCase()) ? 1000 : 0;
      for (const term of terms) score += identity.includes(term) ? 30 : tags.includes(term) ? 12 : description.includes(term) ? 2 : 0;
      if (currentObjectAtoms.size) {
        const toolAtoms = this.atoms([tool.name, meta?.canonicalName, meta?.providerKind, ...(meta?.capabilityKinds ?? []), ...(meta?.sourceTypes ?? [])]);
        score += [...currentObjectAtoms].filter((atom) => toolAtoms.has(atom)).length * 18;
        if (meta?.sourceTypes?.includes('object')) score += 6;
      }
      // Small availability preference from current observations, not an authorization grant.
      score += (meta?.requiredSurfaces ?? []).filter((surface) => observedSurfaces.has(surface)).length * 3;
      return { tool, score };
    }).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  }
}
