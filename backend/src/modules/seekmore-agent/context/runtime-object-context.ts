import type { RuntimeObject } from '@prisma/client';
import type { AgentAttachedObject } from '../contracts/agent-turn.types';

export interface AgentObjectUse {
  role: 'user_input' | 'assistant_output';
  messageId?: string | null;
  inputId?: string | null;
  inputKind?: 'PRIMARY' | 'STEERING' | 'USER_RESPONSE' | null;
  position: number;
}

/** Pure projection of the existing RuntimeObject fact source for model context. */
export function projectAgentObject(
  object: RuntimeObject,
  use: AgentObjectUse,
): AgentAttachedObject {
  const metadata = record(object.metadata);
  const processing = record(metadata.processing);
  const media = record(metadata.media);
  const generation = record(metadata.generation);
  const provenance = record(metadata.provenance);
  const sourceTool = text(generation.sourceTool)
    ?? text(provenance.sourceTool)
    ?? text(metadata.toolName);
  const generationIntent = text(generation.revisedPrompt)
    ?? text(generation.prompt);
  const generationBatchId = text(generation.batchId);
  const generationIndex = nonNegativeInteger(generation.index);
  const capabilities = Array.isArray(metadata.capabilities)
    ? metadata.capabilities.map(String).map((value) => value.trim()).filter(Boolean)
    : [];

  return {
    objectId: object.id,
    displayName: object.displayName,
    originalName: object.originalName,
    objectKind: object.objectKind,
    originType: object.originType,
    extension: object.extension,
    mimeType: object.mimeType,
    sizeBytes: Number(object.sizeBytes),
    contentHash: object.contentHash,
    versionNo: object.versionNo,
    status: object.status,
    downloadUrl: `/api/objects/${encodeURIComponent(object.id)}/download`,
    position: use.position,
    processingStatus: String(processing.status ?? '') === 'ready' ? 'ready' : 'unsupported',
    capabilities,
    // Only processor/reader-derived content belongs here. Generation prompts are intent, not observation.
    contentSummary: text(metadata.contentSummary),
    processor: text(processing.processor),
    processorVersion: text(processing.processorVersion),
    sourceTool,
    generationIntent,
    generationBatchId,
    generationIndex: generationIndex ?? null,
    currentUse: {
      role: use.role,
      messageId: use.messageId ?? null,
      inputId: use.inputId ?? null,
      inputKind: use.inputKind ?? null,
      position: use.position,
    },
    media: object.objectKind === 'image'
      ? {
          ...(positiveInteger(media.width) ? { width: positiveInteger(media.width) } : {}),
          ...(positiveInteger(media.height) ? { height: positiveInteger(media.height) } : {}),
          ...(text(media.format) ? { format: text(media.format)! } : {}),
          ...(typeof media.hasAlpha === 'boolean' ? { hasAlpha: media.hasAlpha } : {}),
        }
      : null,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  const output = String(value ?? '').trim();
  return output || null;
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}
