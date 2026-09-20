import { Inject, Injectable } from '@nestjs/common';
import type { JsonObject, JsonValue } from '../domain/json.types';
import type {
  McpNormalizedToolResult,
  McpRuntimeConfig,
} from '../domain/mcp-runtime.types';
import { MCP_RUNTIME_CONFIG } from '../mcp-runtime.tokens';

@Injectable()
export class McpToolResultNormalizerService {
  constructor(
    @Inject(MCP_RUNTIME_CONFIG)
    private readonly config: McpRuntimeConfig,
  ) {}

  normalize(raw: unknown): McpNormalizedToolResult {
    const serialized = this.serialize(raw);
    const safeRaw = this.parseSerialized(serialized);
    const originalBytes = Buffer.byteLength(serialized, 'utf8');
    const limit = Math.max(1_024, this.config.maxResultBytes);
    const record = this.record(safeRaw);

    if (originalBytes > limit) {
      return this.truncatedResult(
        serialized,
        originalBytes,
        limit,
        record.isError === true,
      );
    }

    const content = Array.isArray(record.content)
      ? record.content.map((item) => this.jsonValue(item))
      : [];
    const structuredContent =
      Object.prototype.hasOwnProperty.call(record, 'structuredContent')
        ? this.jsonValue(record.structuredContent)
        : undefined;
    const resources = this.embeddedResources(content);

    return {
      content,
      structuredContent,
      resources,
      isError: record.isError === true,
      raw: safeRaw,
      truncated: false,
    };
  }

  private truncatedResult(
    serialized: string,
    originalBytes: number,
    limit: number,
    isError: boolean,
  ): McpNormalizedToolResult {
    const previewBudget = Math.max(128, limit - 1_024);
    const preview = this.utf8Preview(serialized, previewBudget);
    const notice =
      `MCP result exceeded the ${limit}-byte runtime limit and was truncated.`;

    return {
      content: [
        {
          type: 'text',
          text: `${notice}\n\n${preview}`,
        },
      ],
      structuredContent: {
        truncated: true,
        originalBytes,
        maximumBytes: limit,
      },
      resources: [],
      isError,
      raw: {
        truncated: true,
        originalBytes,
        maximumBytes: limit,
        preview,
      },
      truncated: true,
    };
  }

  private embeddedResources(content: JsonValue[]): JsonObject[] {
    const resources: JsonObject[] = [];
    for (const item of content) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const candidate = item as JsonObject;
      if (candidate.type === 'resource' || candidate.resource) {
        resources.push(candidate);
      }
    }
    return resources;
  }

  private utf8Preview(value: string, maximumBytes: number): string {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.byteLength <= maximumBytes) return value;

    let end = maximumBytes;
    while (end > 0 && (bytes[end] & 0b1100_0000) === 0b1000_0000) {
      end -= 1;
    }
    return bytes.subarray(0, Math.max(0, end)).toString('utf8');
  }

  private serialize(value: unknown): string {
    try {
      return JSON.stringify(value ?? null);
    } catch {
      return JSON.stringify({ unserializable: true });
    }
  }

  private parseSerialized(value: string): JsonValue {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      return { unserializable: true };
    }
  }

  private jsonValue(value: unknown): JsonValue {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value as JsonValue;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.jsonValue(item));
    }
    if (value && typeof value === 'object') {
      const result: JsonObject = {};
      for (const [key, item] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (item !== undefined) result[key] = this.jsonValue(item);
      }
      return result;
    }
    return String(value ?? '');
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
