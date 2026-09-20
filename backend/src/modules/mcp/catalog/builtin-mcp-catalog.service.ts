import { Injectable } from '@nestjs/common';
import type { BuiltinMcpDefinition } from './builtin-mcp-definition';

/**
 * SEEKMORE does not ship built-in MCP service definitions.
 *
 * The empty catalog service remains intentionally so the existing system catalog
 * bootstrap can archive legacy SYSTEM definitions without changing the stable
 * user-created/imported MCP runtime contract.
 */
@Injectable()
export class BuiltinMcpCatalogService {
  private readonly definitions: ReadonlyArray<BuiltinMcpDefinition> =
    Object.freeze([]);

  async loadDefinitions(): Promise<ReadonlyArray<BuiltinMcpDefinition>> {
    return this.definitions;
  }

  async findByStableKey(
    _stableKey: string,
  ): Promise<BuiltinMcpDefinition | null> {
    return null;
  }
}
