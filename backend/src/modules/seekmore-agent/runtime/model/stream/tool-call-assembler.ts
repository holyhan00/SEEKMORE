import type { AgentRuntimeToolCall } from '../../../contracts/agent-turn.types';
import { id } from '../../util/runtime.util';

interface PendingCall {
  id: string;
  name: string;
  arguments: string;
}

export class ToolCallStreamAssembler {
  private readonly calls = new Map<number, PendingCall>();

  append(input: {
    index?: number;
    id?: string | null;
    name?: string | null;
    argumentsDelta?: string | null;
  }): void {
    const index = Number.isFinite(input.index) ? Number(input.index) : 0;
    const current = this.calls.get(index) ?? {
      id: input.id || id('toolcall'),
      name: '',
      arguments: '',
    };
    if (input.id) current.id = input.id;
    if (input.name) current.name = mergeFragment(current.name, input.name);
                                                                           
                                                                                            
    if (input.argumentsDelta) current.arguments += input.argumentsDelta;
    this.calls.set(index, current);
  }

  set(input: { index?: number; id?: string | null; name: string; arguments: unknown }): void {
    const index = Number.isFinite(input.index) ? Number(input.index) : this.calls.size;
    this.calls.set(index, {
      id: input.id || id('toolcall'),
      name: input.name,
      arguments: typeof input.arguments === 'string' ? input.arguments : JSON.stringify(input.arguments ?? {}),
    });
  }

  build(parse: (raw: string) => Record<string, unknown>): AgentRuntimeToolCall[] {
    return [...this.calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => ({
        id: call.id || id('toolcall'),
        name: call.name,
        arguments: parse(call.arguments),
        rawArguments: call.arguments,
      }))
      .filter((call) => Boolean(call.name));
  }
}


function mergeFragment(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;
  const maximum = Math.min(current.length, incoming.length);
  for (let length = maximum; length > 0; length -= 1) {
    if (current.slice(-length) === incoming.slice(0, length)) {
      return current + incoming.slice(length);
    }
  }
  return current + incoming;
}
