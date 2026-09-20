import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { toolRuntimeConfig } from '../common/config/security.config';
import { ToolIdempotencyStore } from './idempotency/tool-idempotency.store';
import { ToolUserPreferenceService } from './preferences/tool-user-preference.service';
import { ToolSchemaValidatorService } from './schema/tool-schema-validator.service';
import type {
  Dict,
  DispatchOptions,
  Tool,
  ToolContext,
  ToolError as ToolErrorType,
  ToolObserver,
  ToolResult,
} from './toolstypes';
import { ToolError } from './toolstypes';

export interface RegistryHealth {
  name: string;
  version?: string;
  enabled: boolean;
  concurrency: number;
  active: number;
  queued: number;
  timeoutMs?: number;
  tags?: string[];
  sideEffectClass?: string;
  requiresApproval?: boolean;
}

export interface UserRegistryHealth extends RegistryHealth {
  systemEnabled: boolean;
}

type QueueWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type RegisteredTool = {
  tool: Tool;
  enabled: boolean;
  concurrency: number;
  active: number;
  queue: QueueWaiter[];
  defaultTimeoutMs?: number;
};

type VersionMap = Map<string, RegisteredTool>;

function nameVersion(name: string, version?: string): string {
  return version ? `${name}@${version}` : name;
}

@Injectable()
export class ToolsRegistry implements OnModuleDestroy {
  private readonly logger = new Logger(ToolsRegistry.name);
  private readonly tools = new Map<string, VersionMap>();
  private readonly config = toolRuntimeConfig();
  private observer?: ToolObserver;

  constructor(
    private readonly schemas: ToolSchemaValidatorService,
    private readonly idempotency: ToolIdempotencyStore,
    private readonly userPreferences: ToolUserPreferenceService,
  ) {}

  onModuleDestroy(): void {
    for (const versions of this.tools.values()) {
      for (const registered of versions.values()) {
        for (const waiter of registered.queue.splice(0)) {
          clearTimeout(waiter.timer);
          waiter.reject(new ToolError('TOOL_RUNTIME_SHUTDOWN', 'Tool runtime is shutting down'));
        }
      }
    }
  }

  setObserver(observer?: ToolObserver): void {
    this.observer = observer;
  }

  register(tool: Tool, runtime?: { enabled?: boolean; concurrency?: number; defaultTimeoutMs?: number }): void {
    if (!tool?.name || typeof tool.execute !== 'function') {
      throw new Error('Invalid Tool: name and execute() are required');
    }
    const version = tool.version ?? '1.0.0';
    const versions = this.tools.get(tool.name) ?? new Map<string, RegisteredTool>();
    if (versions.has(version)) throw new Error(`Tool is already registered: ${nameVersion(tool.name, version)}`);
    const registered: RegisteredTool = {
      tool: this.withCapabilityDefaults(tool),
      enabled: runtime?.enabled ?? true,
      concurrency: Math.max(1, runtime?.concurrency ?? 8),
      active: 0,
      queue: [],
      defaultTimeoutMs: runtime?.defaultTimeoutMs,
    };
    versions.set(version, registered);
    this.tools.set(tool.name, versions);
    this.logger.log(`Registered tool: ${nameVersion(tool.name, version)} (enabled=${registered.enabled}, concurrency=${registered.concurrency})`);
  }

  registerMany(entries: Array<{ tool: Tool; runtime?: { enabled?: boolean; concurrency?: number; defaultTimeoutMs?: number } }>): void {
    for (const entry of entries) this.register(entry.tool, entry.runtime);
  }

  list(filter?: { name?: string; version?: string; enabledOnly?: boolean; includeRuntimeOnly?: boolean }): Tool[] {
    const output: Tool[] = [];
    for (const [name, versions] of this.tools) {
      for (const [version, registered] of versions) {
        if (filter?.name && filter.name !== name) continue;
        if (filter?.version && filter.version !== version) continue;
        if (filter?.enabledOnly && !registered.enabled) continue;
        if (registered.tool.runtimeOnly && filter?.includeRuntimeOnly !== true) continue;
        output.push(registered.tool);
      }
    }
    return output;
  }

  async listForUser(
    userId: string,
    filter?: { name?: string; version?: string; enabledOnly?: boolean },
  ): Promise<Tool[]> {
    const disabledToolNames =
      await this.userPreferences.disabledToolNames(userId);

    return this.list(filter).filter(
      (tool) => !disabledToolNames.has(tool.name),
    );
  }

  async isEnabledForUser(
    userId: string,
    toolName: string,
  ): Promise<boolean> {
    return this.userPreferences.isEnabled(
      userId,
      toolName,
    );
  }

  async setEnabledForUser(
    userId: string,
    toolName: string,
    enabled: boolean,
  ): Promise<boolean> {
    const normalizedToolName =
      String(toolName ?? '').trim();

    const versions = normalizedToolName
      ? this.tools.get(normalizedToolName)
      : null;
    if (!versions) return false;
    if ([...versions.values()].every((registered) => registered.tool.runtimeOnly === true)) {
      return false;
    }

    await this.userPreferences.setEnabled(
      userId,
      normalizedToolName,
      enabled,
    );

    this.logger.log(
      `User ${userId} set tool ${normalizedToolName} enabled=${enabled}`,
    );

    return true;
  }

  setEnabled(name: string, enabled: boolean, version?: string): void {
    const versions = this.tools.get(name);
    if (!versions) return;
    for (const [currentVersion, registered] of versions) {
      if (version && currentVersion !== version) continue;
      registered.enabled = enabled;
      this.logger.log(`Tool ${nameVersion(name, currentVersion)} set enabled=${enabled}`);
    }
  }

  health(filter: { includeRuntimeOnly?: boolean } = {}): RegistryHealth[] {
    const output: RegistryHealth[] = [];
    for (const [name, versions] of this.tools) {
      for (const [version, registered] of versions) {
        if (registered.tool.runtimeOnly && filter.includeRuntimeOnly !== true) continue;
        output.push({
          name,
          version,
          enabled: registered.enabled,
          concurrency: registered.concurrency,
          active: registered.active,
          queued: registered.queue.length,
          timeoutMs: registered.tool.timeoutMs ?? registered.defaultTimeoutMs ?? this.config.defaultTimeoutMs,
          tags: registered.tool.tags,
          sideEffectClass: registered.tool.sideEffectClass,
          requiresApproval: registered.tool.requiresApproval,
        });
      }
    }
    return output;
  }

  listToolNames(): string[] {
    return this.health().map((item) => nameVersion(item.name, item.version)).sort();
  }

  listTools(): RegistryHealth[] {
    return this.health().sort((left, right) => nameVersion(left.name, left.version).localeCompare(nameVersion(right.name, right.version)));
  }

  async listToolsForUser(
    userId: string,
  ): Promise<UserRegistryHealth[]> {
    const disabledToolNames =
      await this.userPreferences.disabledToolNames(userId);

    return this.listTools().map((tool) => ({
      ...tool,
      systemEnabled: tool.enabled,
      enabled:
        tool.enabled
        && !disabledToolNames.has(tool.name),
    }));
  }

  async execute(name: string, args: Dict, context: ToolContext, options: DispatchOptions = {}): Promise<ToolResult> {
    const version = this.pickVersion(name, String(context.metadata?.version ?? '').trim() || undefined);
    if (!version) throw new ToolError('TOOL_NOT_FOUND', `Tool not found: ${name}`);
    const registered = this.getRegistered(name, version);
    if (!registered) throw new ToolError('TOOL_NOT_FOUND', `Tool not found: ${nameVersion(name, version)}`);
    return this.executeRegistered(registered, args, context, options, true);
  }

     
                                                                 
                                                                             
                                                                               
                                                      
     
  async executeResolved(
    tool: Tool,
    args: Dict,
    context: ToolContext,
    options: DispatchOptions = {},
  ): Promise<ToolResult> {
    const normalized = this.withCapabilityDefaults(tool);
    const registered: RegisteredTool = {
      tool: normalized,
      enabled: true,
      concurrency: Math.max(1, options.maxConcurrent ?? 1),
      active: 0,
      queue: [],
      defaultTimeoutMs: normalized.timeoutMs,
    };
    return this.executeRegistered(registered, args, context, options, false);
  }

  private async executeRegistered(
    registered: RegisteredTool,
    args: Dict,
    context: ToolContext,
    options: DispatchOptions,
    enforceUserPreference: boolean,
  ): Promise<ToolResult> {
    const startedAt = Date.now();
    if (!registered.enabled) {
      throw new ToolError('TOOL_DISABLED', `Tool disabled: ${registered.tool.name}`);
    }
    const tool = registered.tool;
    const version = tool.version ?? '1.0.0';
    if (tool.runtimeOnly) {
      if (context.metadata?.runtimeToolAuthorized !== true) {
        throw new ToolError(
          'RUNTIME_TOOL_NOT_AUTHORIZED',
          `Runtime-only tool is not authorized for this turn: ${nameVersion(tool.name, version)}`,
        );
      }
    } else if (enforceUserPreference && !(await this.isEnabledForUser(context.userId, tool.name))) {
      throw new ToolError(
        'TOOL_DISABLED_BY_USER',
        `Tool disabled by user: ${nameVersion(tool.name, version)}`,
      );
    }

    this.schemas.validate(tool.inputSchema, args, 'input');
    if (tool.validateArgs) await tool.validateArgs(args);
    if (tool.canExecute && !(await tool.canExecute(context, args))) {
      return this.failure(tool, context, startedAt, new ToolError('PERMISSION_DENIED', `Permission denied for ${nameVersion(tool.name, version)}`));
    }
    if (tool.requiresApproval && context.metadata?.approvalGranted !== true) {
      return this.failure(tool, context, startedAt, new ToolError('APPROVAL_REQUIRED', `Explicit runtime approval is required for ${nameVersion(tool.name, version)}`));
    }
    if (tool.idempotency === 'required' && !context.idempotencyKey) {
      return this.failure(tool, context, startedAt, new ToolError('IDEMPOTENCY_KEY_REQUIRED', `idempotencyKey is required for ${nameVersion(tool.name, version)}`));
    }

    this.safeEmitStart(tool, args, context);
    const timeoutMs = this.resolveTimeout(registered, options);
    const idempotencyTtlMs = options.idempotencyTtlMs ?? Math.max(timeoutMs * 2, 60_000);
    let idempotencyStorageKey: string | null = null;

    try {
      if (context.idempotencyKey && tool.idempotency !== 'none') {
        const acquired = await this.idempotency.acquire(tool, args, context, idempotencyTtlMs);
        if (acquired.status === 'cached') return acquired.result;
        if (acquired.status === 'in_progress') {
          throw new ToolError('IDEMPOTENCY_IN_PROGRESS', 'An invocation with the same idempotency key is already running');
        }
        idempotencyStorageKey = acquired.storageKey;
      }

      throwIfToolAborted(context.abortSignal);
      await this.acquire(registered, this.resolveMaxConcurrent(registered, options), context.abortSignal);
      try {
        const controller = new AbortController();
        const signal = composeAbortSignals([context.abortSignal, controller.signal]);
        const output = await runWithTimeout(
          tool.execute(args, { ...context, abortSignal: signal }, signal),
          timeoutMs,
          controller,
          nameVersion(tool.name, version),
          context.abortSignal,
        );
        throwIfToolAborted(context.abortSignal);
        this.schemas.validate(tool.outputSchema, output, 'output');
        this.assertOutputLimit(tool, output);
        const result: ToolResult = {
          ok: true,
          status: 'ok',
          data: output,
          meta: this.meta(tool, context, startedAt),
        };
        if (idempotencyStorageKey) await this.idempotency.complete(idempotencyStorageKey, result, idempotencyTtlMs);
        this.safeEmitSuccess(tool, result.meta.duration_ms, context);
        return result;
      } finally {
        this.release(registered);
      }
    } catch (error) {
      if (idempotencyStorageKey) await this.idempotency.release(idempotencyStorageKey).catch(() => undefined);
      return this.failure(tool, context, startedAt, toToolError(error));
    }
  }

  private pickVersion(name: string, wanted?: string): string | undefined {
    const versions = this.tools.get(name);
    if (!versions?.size) return undefined;
    if (wanted) return versions.has(wanted) ? wanted : undefined;
    return [...versions.keys()].sort(compareVersions).at(-1);
  }

  private getRegistered(name: string, version: string): RegisteredTool | undefined {
    return this.tools.get(name)?.get(version);
  }

  private resolveMaxConcurrent(registered: RegisteredTool, options: DispatchOptions): number {
    return Math.min(Math.max(1, options.maxConcurrent ?? registered.concurrency), registered.concurrency);
  }

  private resolveTimeout(registered: RegisteredTool, options: DispatchOptions): number {
    return Math.max(100, options.timeoutMs ?? registered.tool.timeoutMs ?? registered.defaultTimeoutMs ?? this.config.defaultTimeoutMs);
  }

  private async acquire(registered: RegisteredTool, maximum: number, signal?: AbortSignal): Promise<void> {
    throwIfToolAborted(signal);
    if (registered.active < maximum) {
      registered.active += 1;
      return;
    }
    if (registered.queue.length >= this.config.queueLimit) {
      throw new ToolError('TOOL_QUEUE_FULL', 'Tool execution queue is full');
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: QueueWaiter = {
        resolve: () => {
          clearTimeout(waiter.timer);
          signal?.removeEventListener('abort', onAbort);
          registered.active += 1;
          resolve();
        },
        reject,
        timer: setTimeout(() => {
          const index = registered.queue.indexOf(waiter);
          if (index >= 0) registered.queue.splice(index, 1);
          reject(new ToolError('TOOL_QUEUE_TIMEOUT', 'Timed out while waiting for tool concurrency capacity'));
        }, this.config.queueTimeoutMs),
      };
      const onAbort = () => {
        const index = registered.queue.indexOf(waiter);
        if (index >= 0) registered.queue.splice(index, 1);
        clearTimeout(waiter.timer);
        reject(new ToolError('TOOL_CANCELLED', 'Tool execution was cancelled while waiting for capacity'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      waiter.timer.unref?.();
      registered.queue.push(waiter);
    });
  }

  private release(registered: RegisteredTool): void {
    registered.active = Math.max(0, registered.active - 1);
    registered.queue.shift()?.resolve();
  }

  private withCapabilityDefaults(tool: Tool): Tool {
    const tags = new Set(tool.tags ?? []);
    const sideEffectClass = tool.sideEffectClass
      ?? (tags.has('delete') ? 'irreversible_write'
        : tags.has('execution') ? 'process_execution'
          : tags.has('write') || tags.has('patch') ? 'workspace_write'
            : tags.has('read') || tags.has('search') ? 'read_only'
              : 'none');

                                                                                 
                                                                            
                                                                               
                                                                             
                                                  
      
                                                                            
                                  
    Object.assign(tool, {
      sideEffectClass,
      idempotency:
        tool.idempotency
        ?? (
          sideEffectClass === 'none'
          || sideEffectClass === 'read_only'
            ? 'optional'
            : 'required'
        ),
      requiresApproval:
        tool.requiresApproval
        ?? (
          sideEffectClass === 'workspace_write'
          || sideEffectClass === 'irreversible_write'
          || sideEffectClass === 'process_execution'
          || sideEffectClass === 'external_effect'
        ),
      maxOutputBytes:
        tool.maxOutputBytes
        ?? 2 * 1024 * 1024,
    });

    if (typeof tool.execute !== 'function') {
      throw new Error(
        `Invalid Tool after capability normalization: ${tool.name} has no execute()`,
      );
    }

    return tool;
  }

  private assertOutputLimit(tool: Tool, output: unknown): void {
    const maximum = tool.maxOutputBytes ?? 2 * 1024 * 1024;
    const size = Buffer.byteLength(safeStableStringify(output), 'utf8');
    if (size > maximum) throw new ToolError('TOOL_OUTPUT_TOO_LARGE', `Tool output exceeds ${maximum} bytes`, { size, maximum });
  }

  private failure(tool: Tool, context: ToolContext, startedAt: number, error: ToolError): ToolResult {
    this.safeEmitError(tool, Date.now() - startedAt, error, context);
    return {
      ok: false,
      status: error.code === 'TOOL_CANCELLED' ? 'cancelled' : 'error',
      error: { code: error.code, message: error.message, details: error.details },
      meta: this.meta(tool, context, startedAt),
    };
  }

  private meta(tool: Tool, context: ToolContext, startedAt: number): ToolResult['meta'] {
    return {
      tool: tool.name,
      version: tool.version,
      duration_ms: Date.now() - startedAt,
      traceId: context.traceId,
      requestId: context.requestId,
      idempotencyKey: context.idempotencyKey,
    };
  }

  private safeEmitStart(tool: Tool, args: Dict, context: ToolContext): void {
    try {
      this.observer?.onStart?.({
        tool: tool.name,
        version: tool.version,
        argsPreview: truncate(safeStableStringify(redact(args, new Set(tool.sensitiveInputKeys ?? []))), 512),
        ctx: {
          userId: context.userId,
          conversationId: context.conversationId,
          traceId: context.traceId,
          requestId: context.requestId,
          idempotencyKey: context.idempotencyKey,
        },
        ts: Date.now(),
      });
    } catch {
                                                        
    }
  }

  private safeEmitSuccess(tool: Tool, duration: number, context: ToolContext): void {
    try {
      this.observer?.onSuccess?.({
        tool: tool.name,
        version: tool.version,
        duration_ms: duration,
        ctx: { userId: context.userId, conversationId: context.conversationId, traceId: context.traceId, requestId: context.requestId },
        ts: Date.now(),
      });
    } catch {}
  }

  private safeEmitError(tool: Tool, duration: number, error: ToolErrorType, context: ToolContext): void {
    try {
      this.observer?.onError?.({
        tool: tool.name,
        version: tool.version,
        duration_ms: duration,
        error: { code: error.code ?? 'UNKNOWN', message: error.message ?? 'Tool execution failed' },
        ctx: { userId: context.userId, conversationId: context.conversationId, traceId: context.traceId, requestId: context.requestId },
        ts: Date.now(),
      });
    } catch {}
  }
}

function composeAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, controller: AbortController, tool: string, externalSignal?: AbortSignal): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let abortCleanup: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ToolError('TOOL_TIMEOUT', `Tool timed out after ${timeoutMs}ms: ${tool}`));
        }, timeoutMs);
        timer.unref?.();
      }),
      new Promise<never>((_, reject) => {
        const abort = () => {
          controller.abort(externalSignal?.reason);
          reject(new ToolError('TOOL_CANCELLED', `Tool execution cancelled: ${tool}`));
        };
        abortCleanup = () => externalSignal?.removeEventListener('abort', abort);
        if (externalSignal?.aborted) abort();
        else externalSignal?.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    abortCleanup?.();
  }
}

function throwIfToolAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ToolError('TOOL_CANCELLED', 'Tool execution was cancelled');
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split(/[.-]/).map((part) => Number(part)).map((part) => Number.isFinite(part) ? part : 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.localeCompare(right);
}

function safeStableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(safeStableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${safeStableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function redact(value: unknown, explicit: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item, explicit));
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[-_\s]/g, '').toLowerCase();
    output[key] = explicit.has(key) || /token|secret|password|authorization|cookie|apikey|privatekey/.test(normalized)
      ? '[REDACTED]'
      : redact(child, explicit);
  }
  return output;
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}…`;
}

function toToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof Error && error.name === 'AbortError') return new ToolError('CANCELED', 'Operation canceled');
  return new ToolError('TOOL_EXEC_ERROR', error instanceof Error ? error.message : String(error));
}
