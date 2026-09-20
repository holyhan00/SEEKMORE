import type {
  AgentRuntimeToolCall,
  AgentRuntimeToolDefinition,
} from '../../contracts/agent-turn.types';

const MAX_REDUNDANT_ARGUMENT_ENVELOPE_DEPTH = 4;

export interface ToolCallArgumentNormalizationEvent {
  tool: string;
  reason: 'redundant_arguments_envelope';
  envelopeDepth: number;
  originalKeys: string[];
  normalizedKeys: string[];
}

export interface ToolCallArgumentNormalizationResult {
  toolCalls: AgentRuntimeToolCall[];
  events: ToolCallArgumentNormalizationEvent[];
}

export function normalizeToolCallArguments(
  toolCalls: AgentRuntimeToolCall[],
  definitions: AgentRuntimeToolDefinition[],
): ToolCallArgumentNormalizationResult {
  if (!toolCalls.length || !definitions.length) {
    return {
      toolCalls,
      events: [],
    };
  }

  const definitionsByName = new Map(
    definitions.map((definition) => [
      definition.name,
      definition,
    ]),
  );

  const events: ToolCallArgumentNormalizationEvent[] = [];
  let changed = false;

  const normalizedCalls = toolCalls.map((call) => {
    const definition = definitionsByName.get(call.name);
    if (!definition) return call;

    const normalized = normalizeSingleCall(
      call,
      definition,
    );

    if (!normalized) return call;

    changed = true;
    events.push(normalized.event);
    return normalized.call;
  });

  return {
    toolCalls: changed
      ? normalizedCalls
      : toolCalls,
    events,
  };
}

function normalizeSingleCall(
  call: AgentRuntimeToolCall,
  definition: AgentRuntimeToolDefinition,
): {
  call: AgentRuntimeToolCall;
  event: ToolCallArgumentNormalizationEvent;
} | null {
  const schema = asRecord(definition.inputSchema);
  if (!schema) return null;

  const properties = asRecord(schema.properties) ?? {};

  // A real business field named "arguments" is authoritative. Never unwrap it.
  if (hasOwn(properties, 'arguments')) {
    return null;
  }

  const outer = asRecord(call.arguments);
  if (!outer || !isArgumentsEnvelope(outer)) {
    return null;
  }

  let candidate: Record<string, unknown> = outer;
  let depth = 0;

  while (
    depth < MAX_REDUNDANT_ARGUMENT_ENVELOPE_DEPTH
    && isArgumentsEnvelope(candidate)
  ) {
    const nested = asRecord(candidate.arguments);
    if (!nested) break;

    candidate = nested;
    depth += 1;
  }

  if (
    depth === 0
    || !matchesTopLevelSchema(candidate, schema, properties)
  ) {
    return null;
  }

  const rawArguments = safeStringify(candidate);
  if (rawArguments === null) {
    return null;
  }

  return {
    call: {
      ...call,
      arguments: candidate,
      rawArguments,
    },
    event: {
      tool: call.name,
      reason: 'redundant_arguments_envelope',
      envelopeDepth: depth,
      originalKeys: Object.keys(outer),
      normalizedKeys: Object.keys(candidate),
    },
  };
}

function matchesTopLevelSchema(
  candidate: Record<string, unknown>,
  schema: Record<string, unknown>,
  properties: Record<string, unknown>,
): boolean {
  const candidateKeys = Object.keys(candidate);
  if (!candidateKeys.length) return false;

  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      )
    : [];

  if (
    required.length > 0
    && !required.every((key) => hasOwn(candidate, key))
  ) {
    return false;
  }

  const propertyKeys = Object.keys(properties);

  if (required.length === 0) {
    if (!propertyKeys.length) return false;
    if (!candidateKeys.some((key) => hasOwn(properties, key))) {
      return false;
    }
  }

  if (
    schema.additionalProperties === false
    && candidateKeys.some((key) => !hasOwn(properties, key))
  ) {
    return false;
  }

  return true;
}

function isArgumentsEnvelope(
  value: Record<string, unknown>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === 1
    && keys[0] === 'arguments'
    && asRecord(value.arguments) !== null;
}

function asRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
  ) {
    return null;
  }

  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype
    && prototype !== null
  ) {
    return null;
  }

  return value as Record<string, unknown>;
}

function hasOwn(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function safeStringify(
  value: Record<string, unknown>,
): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
