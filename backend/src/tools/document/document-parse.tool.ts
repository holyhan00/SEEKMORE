import {
  HttpException,
  Injectable,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { RuntimeObjectService } from "../../modules/object-runtime/object/object.service";
import type {
  ParsedDocument,
  ParsedDocumentSection,
  ParsedDocumentTable,
} from "../../modules/document-parser/document.types";
import type { Dict, Tool, ToolContext } from "../toolstypes";
import { ToolError } from "../toolstypes";
import { truncateText } from "../workspace/workspace-path-sandbox";
import { objectToolPartition } from "../object/object-tool-context";

const DEFAULT_MAX_TEXT_CHARACTERS = 50_000;
const MAX_SECTIONS = 50;
const MAX_SECTION_CHARACTERS = 10_000;
const MAX_TOTAL_SECTION_CHARACTERS = 200_000;
const MAX_TABLES = 10;
const DEFAULT_MAX_ROWS_PER_TABLE = 100;
const MAX_HEADERS_PER_TABLE = 50;
const MAX_CELL_CHARACTERS = 500;
const MAX_TABLE_CELLS = 5_000;
const MAX_TOTAL_TABLE_CHARACTERS = 300_000;

interface DocumentParseToolInput {
  objectId: string;
  maxTextCharacters?: number;
  maxRowsPerTable?: number;
  includeSections?: boolean;
  includeTables?: boolean;
  includeStyleProfile?: boolean;
  includeLayoutAst?: boolean;
}

@Injectable()
export class DocumentParseTool implements Tool {
  name = "document.parse";
  version = "1.0.0";
  description = [
    "Read the backend-parsed content of a READY uploaded Object.",
    "Returns bounded text and structured sections or tables without reparsing the file in the Agent Loop.",
    "Use the exact objectId from the current message attachment metadata.",
  ].join(" ");
  tags = ["document", "parse", "object", "attachment", "read"];
  timeoutMs = 60_000;
  maxOutputBytes = 2 * 1024 * 1024;
  requiredSurfaces: NonNullable<Tool["requiredSurfaces"]> = ["conversation"];
  parallelism: NonNullable<Tool["parallelism"]> = "resource_serial";
  conflictKeyFields = ["objectId"];
  supportsAbort = false;
  latencyClass: NonNullable<Tool["latencyClass"]> = "long";

  inputSchema = {
    type: "object",
    required: ["objectId"],
    properties: {
      objectId: {
        type: "string",
        minLength: 1,
        maxLength: 180,
        description:
          "Object Catalog identifier from the current conversation attachment.",
      },
      maxTextCharacters: {
        type: "integer",
        minimum: 1_000,
        maximum: 200_000,
        description: "Maximum text characters returned to the agent.",
      },
      maxRowsPerTable: {
        type: "integer",
        minimum: 1,
        maximum: 200,
        description: "Maximum structured rows returned for each table.",
      },
      includeSections: { type: "boolean" },
      includeTables: { type: "boolean" },
      includeStyleProfile: { type: "boolean" },
      includeLayoutAst: { type: "boolean" },
    },
    additionalProperties: false,
  };

  outputSchema = {
    type: "object",
    required: ["objectId", "file", "parser", "document", "objectObservations", "limits"],
    properties: {
      objectId: { type: "string" },
      file: {
        type: "object",
        required: ["name", "extension", "mimeType", "sizeBytes"],
        properties: {
          name: { type: "string" },
          extension: { type: ["string", "null"] },
          mimeType: { type: "string" },
          sizeBytes: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
      parser: {
        type: "object",
        required: ["kind", "version"],
        properties: {
          kind: { type: "string" },
          version: { type: "string" },
        },
        additionalProperties: false,
      },
      document: {
        type: "object",
        required: ["title", "text", "sections", "tables", "meta"],
        properties: {
          title: { type: ["string", "null"] },
          text: { type: "string" },
          sections: { type: "array" },
          tables: { type: "array" },
          styleProfile: { type: "object" },
          layoutAst: { type: "object" },
          meta: { type: "object" },
        },
      },
      objectObservations: {
        type: "array",
        items: {
          type: "object",
          required: ["objectId", "contentHash", "versionNo"],
          properties: {
            objectId: { type: "string" },
            contentHash: { type: "string" },
            versionNo: { type: "integer", minimum: 0 },
          },
          additionalProperties: false,
        },
      },
      limits: {
        type: "object",
        required: [
          "textTruncated",
          "sectionsTruncated",
          "tablesTruncated",
          "rowsTruncated",
        ],
        properties: {
          textTruncated: { type: "boolean" },
          sectionsTruncated: { type: "boolean" },
          tablesTruncated: { type: "boolean" },
          rowsTruncated: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };

  constructor(
    private readonly objects: RuntimeObjectService,
  ) {}

  async execute(
    args: Dict,
    ctx: ToolContext,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const input = this.normalizeInput(args);
    if (!input.objectId) {
      throw new ToolError(
        "DOCUMENT_OBJECT_ID_REQUIRED",
        "document.parse requires objectId",
      );
    }
    this.throwIfAborted(signal ?? ctx.abortSignal);

    const partition = objectToolPartition(ctx);

    try {
      const object = await this.objects.inspect(partition, input.objectId);
      this.throwIfAborted(signal ?? ctx.abortSignal);

      const metadata = this.record(object.metadata);
      const processing = this.record(metadata.processing);
      const cached = this.record(metadata.parsedContent);
      if (String(processing.status ?? '') !== 'ready' || typeof cached.text !== 'string') {
        throw new ToolError(
          "OBJECT_NOT_READY",
          "The uploaded Object has not completed backend parsing",
          { objectId: input.objectId },
        );
      }

      const extension = String(object.extension ?? "").trim().toLowerCase() || null;
      const parsed: ParsedDocument = {
        text: String(cached.text ?? ''),
        title: this.optionalText(cached.title) ?? undefined,
        kind: String(cached.kind ?? processing.processor ?? 'text') as ParsedDocument['kind'],
        mimeType: this.optionalText(cached.mimeType) ?? object.mimeType,
        extension: this.optionalText(cached.extension) ?? extension,
        meta: this.record(cached.meta),
        sections: Array.isArray(cached.sections)
          ? cached.sections as ParsedDocumentSection[]
          : [],
        tables: Array.isArray(cached.tables)
          ? cached.tables as ParsedDocumentTable[]
          : [],
        styleProfile: this.recordOrUndefined(cached.styleProfile) as ParsedDocument['styleProfile'],
        layoutAst: this.recordOrUndefined(cached.layoutAst),
      };

      return this.projectResult({
        parsed,
        input,
        objectId: object.id,
        fileName: object.displayName || object.originalName,
        sizeBytes: Number(object.sizeBytes),
        extension,
        mimeType: object.mimeType || "application/octet-stream",
        contentHash: object.contentHash,
        versionNo: object.versionNo,
      });
    } catch (error) {
      throw this.normalizeError(error, input.objectId);
    }
  }

  private normalizeInput(args: Dict): DocumentParseToolInput {
    return {
      objectId: String(args.objectId ?? "").trim(),
      maxTextCharacters: this.clampInteger(
        args.maxTextCharacters,
        1_000,
        200_000,
        DEFAULT_MAX_TEXT_CHARACTERS,
      ),
      maxRowsPerTable: this.clampInteger(
        args.maxRowsPerTable,
        1,
        200,
        DEFAULT_MAX_ROWS_PER_TABLE,
      ),
      includeSections: args.includeSections !== false,
      includeTables: args.includeTables !== false,
      includeStyleProfile: args.includeStyleProfile === true,
      includeLayoutAst: args.includeLayoutAst === true,
    };
  }

  private projectResult(input: {
    parsed: ParsedDocument;
    input: DocumentParseToolInput;
    objectId: string;
    fileName: string;
    sizeBytes: number;
    extension: string | null;
    mimeType: string;
    contentHash: string;
    versionNo: number;
  }): Record<string, unknown> {
    const textResult = truncateText(
      input.parsed.text,
      input.input.maxTextCharacters ?? DEFAULT_MAX_TEXT_CHARACTERS,
    );
    const sectionResult = this.projectSections(
      input.input.includeSections ? input.parsed.sections : undefined,
    );
    const tableResult = this.projectTables(
      input.input.includeTables ? input.parsed.tables : undefined,
      input.input.maxRowsPerTable ?? DEFAULT_MAX_ROWS_PER_TABLE,
    );
    const meta = this.projectMeta(input.parsed.meta);

    return {
      objectId: input.objectId,
      file: {
        name: input.fileName,
        extension: input.extension,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
      parser: {
        kind: input.parsed.kind,
        version: String(input.parsed.meta?.parserVersion ?? "unknown"),
      },
      document: {
        title: input.parsed.title ?? null,
        text: textResult.text,
        sections: sectionResult.items,
        tables: tableResult.items,
        ...(input.input.includeStyleProfile && input.parsed.styleProfile
          ? { styleProfile: this.boundJson(input.parsed.styleProfile) }
          : {}),
        ...(input.input.includeLayoutAst && input.parsed.layoutAst
          ? { layoutAst: this.boundJson(input.parsed.layoutAst) }
          : {}),
        meta,
      },
      objectObservations: [{
        objectId: input.objectId,
        contentHash: input.contentHash,
        versionNo: input.versionNo,
      }],
      limits: {
        textTruncated: textResult.truncated,
        sectionsTruncated: sectionResult.truncated,
        tablesTruncated: tableResult.tablesTruncated,
        rowsTruncated: tableResult.rowsTruncated,
      },
    };
  }

  private projectSections(sections: ParsedDocumentSection[] | undefined): {
    items: Array<Record<string, unknown>>;
    truncated: boolean;
  } {
    const source = Array.isArray(sections) ? sections : [];
    const items: Array<Record<string, unknown>> = [];
    let remainingCharacters = MAX_TOTAL_SECTION_CHARACTERS;
    let truncated = source.length > MAX_SECTIONS;

    for (const section of source.slice(0, MAX_SECTIONS)) {
      if (remainingCharacters <= 0) {
        truncated = true;
        break;
      }
      const maxCharacters = Math.min(
        MAX_SECTION_CHARACTERS,
        remainingCharacters,
      );
      const content = this.limitText(section.content, maxCharacters);
      items.push({
        title: section.title ?? null,
        content: content.text,
        level: section.level ?? 1,
      });
      remainingCharacters -= content.text.length;
      truncated ||= content.truncated;
    }

    return { items, truncated };
  }

  private projectTables(
    tables: ParsedDocumentTable[] | undefined,
    maxRowsPerTable: number,
  ): {
    items: Array<Record<string, unknown>>;
    tablesTruncated: boolean;
    rowsTruncated: boolean;
  } {
    const source = Array.isArray(tables) ? tables : [];
    const items: Array<Record<string, unknown>> = [];
    let rowsTruncated = false;
    let remainingCells = MAX_TABLE_CELLS;
    let remainingCharacters = MAX_TOTAL_TABLE_CHARACTERS;

    for (const table of source.slice(0, MAX_TABLES)) {
      const headers = table.headers.slice(0, MAX_HEADERS_PER_TABLE);
      const rows: Array<Record<string, string>> = [];
      if (table.headers.length > headers.length) rowsTruncated = true;

      for (const row of table.rows.slice(0, maxRowsPerTable)) {
        if (remainingCells < headers.length || remainingCharacters <= 0) {
          rowsTruncated = true;
          break;
        }
        const projected: Record<string, string> = {};
        for (const header of headers) {
          const maxCharacters = Math.min(
            MAX_CELL_CHARACTERS,
            remainingCharacters,
          );
          const cell = this.limitText(
            String(row[header] ?? ""),
            Math.max(1, maxCharacters),
          );
          projected[header] = cell.text;
          remainingCells -= 1;
          remainingCharacters -= cell.text.length;
          rowsTruncated ||= cell.truncated;
        }
        rows.push(projected);
      }

      if (table.rows.length > rows.length) rowsTruncated = true;
      items.push({
        sheetName: table.sheetName ?? null,
        title: table.title ?? null,
        headers,
        rows,
        rowCount: this.numericMeta(table.meta, "rowCount", table.rows.length),
        returnedRowCount: rows.length,
      });

      if (remainingCells <= 0 || remainingCharacters <= 0) break;
    }

    return {
      items,
      tablesTruncated: source.length > items.length,
      rowsTruncated,
    };
  }

  private projectMeta(value: Record<string, unknown>): Record<string, unknown> {
    const excluded = new Set([
      "explicitHints",
      "templateProfile",
      "rendererHints",
      "layoutAst",
      "styleProfile",
      "entries",
      "rawRows",
    ]);
    const budget = { remainingNodes: 1_000, remainingStringCharacters: 50_000 };
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !excluded.has(key))
        .slice(0, 100)
        .map(([key, item]) => [key, this.boundJson(item, budget)]),
    );
  }

  private boundJson(
    value: unknown,
    budget = { remainingNodes: 5_000, remainingStringCharacters: 100_000 },
    depth = 0,
  ): unknown {
    if (depth >= 8) return "[depth-limited]";
    if (budget.remainingNodes <= 0) return "[item-limited]";
    budget.remainingNodes -= 1;

    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number"
    )
      return value;
    if (typeof value === "string") {
      if (budget.remainingStringCharacters <= 0) return "[text-limited]";
      const maxCharacters = Math.min(10_000, budget.remainingStringCharacters);
      const text = this.limitText(value, Math.max(1, maxCharacters)).text;
      budget.remainingStringCharacters -= text.length;
      return text;
    }
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      for (const item of value.slice(0, 200)) {
        if (budget.remainingNodes <= 0) break;
        output.push(this.boundJson(item, budget, depth + 1));
      }
      return output;
    }
    if (value && typeof value === "object") {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(
        value as Record<string, unknown>,
      ).slice(0, 200)) {
        if (budget.remainingNodes <= 0) break;
        output[key] = this.boundJson(item, budget, depth + 1);
      }
      return output;
    }
    return String(value ?? "");
  }

  private numericMeta(
    meta: Record<string, unknown> | undefined,
    key: string,
    fallback: number,
  ): number {
    const value = Number(meta?.[key]);
    return Number.isFinite(value) ? value : fallback;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
    const record = this.record(value);
    return Object.keys(record).length > 0 ? record : undefined;
  }

  private optionalText(value: unknown): string | null {
    const text = String(value ?? "").trim();
    return text || null;
  }

  private normalizeError(error: unknown, objectId: string): ToolError {
    if (error instanceof ToolError) return error;

    if (error instanceof UnsupportedMediaTypeException) {
      return new ToolError(
        "DOCUMENT_TYPE_UNSUPPORTED",
        this.safeMessage(error),
        { objectId },
      );
    }

    if (error instanceof HttpException) {
      const response = error.getResponse();
      const record =
        response && typeof response === "object" && !Array.isArray(response)
          ? (response as Record<string, unknown>)
          : {};
      return new ToolError(
        String(record.code ?? "DOCUMENT_PARSE_INVALID"),
        this.safeMessage(record.message ?? error.message),
        {
          objectId,
          ...(record.details !== undefined
            ? { parserDetails: this.boundJson(record.details) }
            : {}),
        },
      );
    }

    return new ToolError(
      "DOCUMENT_PARSE_FAILED",
      this.safeMessage(error) || "Document parsing failed",
      { objectId },
    );
  }

  private safeMessage(value: unknown): string {
    return (value instanceof Error ? value.message : String(value ?? "")).slice(
      0,
      2_000,
    );
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new ToolError("TOOL_CANCELLED", "Document parsing was cancelled");
    }
  }

  private limitText(
    value: string,
    maxCharacters: number,
  ): { text: string; truncated: boolean } {
    const safeMax = Math.max(0, Math.trunc(maxCharacters));
    if (value.length <= safeMax) return { text: value, truncated: false };
    return { text: value.slice(0, safeMax), truncated: true };
  }

  private clampInteger(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(number)));
  }
}
