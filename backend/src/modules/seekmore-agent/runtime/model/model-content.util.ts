import type {
  AgentImageContentPart,
  AgentRuntimeContentPart,
  AgentRuntimeMessageContent,
} from '../../contracts/agent-turn.types';

export function contentParts(value: AgentRuntimeMessageContent | unknown): AgentRuntimeContentPart[] | null {
  if (!Array.isArray(value)) return null;
  const parts = value.filter((item): item is AgentRuntimeContentPart => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const type = String((item as { type?: unknown }).type ?? '');
    return type === 'text' || type === 'image';
  });
  return parts.length === value.length ? parts : null;
}

export function contentText(value: AgentRuntimeMessageContent | unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  const parts = contentParts(value);
  if (parts) {
    return parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .filter(Boolean)
      .join('\n');
  }
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function imageParts(value: AgentRuntimeMessageContent | unknown): AgentImageContentPart[] {
  return (contentParts(value) ?? []).filter(
    (part): part is AgentImageContentPart => part.type === 'image',
  );
}

export function openAiChatContent(value: AgentRuntimeMessageContent | unknown): string | Array<Record<string, unknown>> {
  const parts = contentParts(value);
  if (!parts) return contentText(value);
  return parts.map((part) => part.type === 'text'
    ? { type: 'text', text: part.text }
    : {
        type: 'image_url',
        image_url: { url: `data:${part.mimeType};base64,${part.dataBase64}` },
      });
}

export function openAiResponseContent(value: AgentRuntimeMessageContent | unknown): string | Array<Record<string, unknown>> {
  const parts = contentParts(value);
  if (!parts) return contentText(value);
  return parts.map((part) => part.type === 'text'
    ? { type: 'input_text', text: part.text }
    : {
        type: 'input_image',
        image_url: `data:${part.mimeType};base64,${part.dataBase64}`,
      });
}

export function anthropicContent(value: AgentRuntimeMessageContent | unknown): Array<Record<string, unknown>> {
  const parts = contentParts(value);
  if (!parts) return [{ type: 'text', text: contentText(value) }];
  return parts.map((part) => part.type === 'text'
    ? { type: 'text', text: part.text }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: part.mimeType,
          data: part.dataBase64,
        },
      });
}

export function geminiParts(value: AgentRuntimeMessageContent | unknown): Array<Record<string, unknown>> {
  const parts = contentParts(value);
  if (!parts) return [{ text: contentText(value) }];
  return parts.map((part) => part.type === 'text'
    ? { text: part.text }
    : {
        inlineData: {
          mimeType: part.mimeType,
          data: part.dataBase64,
        },
      });
}
