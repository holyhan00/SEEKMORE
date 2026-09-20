import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { terminateManagedProcessTree } from './managed-process-tree';

export type ManagedValkeyProcessOptions = {
  redisServerExecutablePath: string;
  dataRoot: string;
  runtimeRoot: string;
  host: '127.0.0.1';
  port: number;
  password: string;
  logPath: string;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  onUnexpectedExit?: (event: {
    code: number | null;
    signal: NodeJS.Signals | null;
  }) => void;
};

export type ManagedValkeyProcessInfo = {
  pid: number;
  host: '127.0.0.1';
  port: number;
  password: string;
};

export class ManagedValkeyProcess {
  private child: ChildProcess | null = null;
  private info: ManagedValkeyProcessInfo | null = null;
  private stopping: Promise<void> | null = null;
  private ready = false;
  private configPath: string | null = null;

  constructor(private readonly options: ManagedValkeyProcessOptions) {}

  async start(): Promise<ManagedValkeyProcessInfo> {
    if (this.info && this.child && this.child.exitCode === null) {
      return this.info;
    }

    validateOptions(this.options);
    await assertRuntimeFile(this.options.redisServerExecutablePath);
    await Promise.all([
      mkdir(this.options.dataRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.options.runtimeRoot, { recursive: true, mode: 0o700 }),
      mkdir(path.dirname(this.options.logPath), { recursive: true, mode: 0o700 }),
    ]);

    const configPath = path.join(
      this.options.runtimeRoot,
      `.redis-runtime-${process.pid}-${this.options.port}.conf`,
    );
    this.configPath = configPath;
    await unlink(configPath).catch(() => undefined);
    await writeFile(configPath, buildRedisConfig(this.options), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });

    const logStream = createWriteStream(this.options.logPath, {
      flags: 'a',
      mode: 0o600,
    });
    logStream.write(
      `\n[${new Date().toISOString()}] SEEKMORE managed Valkey starting\n`,
    );

    const child = spawn(
      this.options.redisServerExecutablePath,
      [configPath],
      {
        cwd: path.dirname(this.options.redisServerExecutablePath),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    this.child = child;
    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });

    const closeLog = () => {
      if (!logStream.closed) {
        logStream.end(
          `[${new Date().toISOString()}] SEEKMORE managed Valkey stopped\n`,
        );
      }
    };
    child.once('close', (code, signal) => {
      closeLog();
      const unexpected = this.ready && !this.stopping;
      if (this.child === child) {
        this.child = null;
        this.info = null;
        this.ready = false;
      }
      if (unexpected) this.options.onUnexpectedExit?.({ code, signal });
    });
    child.once('error', closeLog);

    const pid = child.pid;
    if (!pid) {
      child.kill();
      await this.removeRuntimeConfig();
      throw new Error('[ManagedValkey] Valkey process did not receive a PID.');
    }

    try {
      await this.waitUntilReady(child);
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    } finally {
      // Valkey reads its Redis-compatible configuration at process startup. The file contains
      // the password in clear text only for that bootstrap window.
      await this.removeRuntimeConfig();
    }

    this.ready = true;
    this.info = {
      pid,
      host: this.options.host,
      port: this.options.port,
      password: this.options.password,
    };
    return this.info;
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;

    const child = this.child;
    this.info = null;
    this.ready = false;
    await this.removeRuntimeConfig();

    if (!child || child.exitCode !== null) {
      this.child = null;
      return;
    }

    this.stopping = this.stopRunningServer(child).finally(() => {
      this.stopping = null;
      if (this.child === child) this.child = null;
    });
    return this.stopping;
  }

  private async waitUntilReady(child: ChildProcess): Promise<void> {
    const timeoutMs = this.options.startupTimeoutMs ?? 30_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(
          `[ManagedValkey] Valkey exited before becoming ready (code=${String(child.exitCode)}).`,
        );
      }

      if (await redisPing(this.options)) return;
      await delay(150);
    }

    throw new Error(
      `[ManagedValkey] Valkey readiness timed out after ${timeoutMs}ms.`,
    );
  }

  private async stopRunningServer(child: ChildProcess): Promise<void> {
    const timeoutMs = this.options.shutdownTimeoutMs ?? 15_000;
    const exited = waitForChildExit(child);

    await redisShutdown(this.options).catch(() => undefined);
    const graceful = await Promise.race([
      exited.then(() => true),
      delay(timeoutMs).then(() => false),
    ]);
    if (graceful || child.exitCode !== null) return;

    await terminateManagedProcessTree(
      child,
      {
        gracefulTimeoutMs: 5_000,
        forceTimeoutMs: 5_000,
      },
    );
  }

  private async removeRuntimeConfig(): Promise<void> {
    const configPath = this.configPath;
    this.configPath = null;
    if (configPath) await unlink(configPath).catch(() => undefined);
  }
}

export function buildRedisConfig(options: Pick<
  ManagedValkeyProcessOptions,
  'host' | 'port' | 'password' | 'dataRoot'
>): string {
  return [
    `bind ${options.host}`,
    'protected-mode yes',
    `port ${options.port}`,
    'daemonize no',
    'supervised no',
    `dir ${redisQuoted(options.dataRoot)}`,
    'appendonly yes',
    'appendfsync everysec',
    'save ""',
    `requirepass ${redisQuoted(options.password)}`,
    'logfile ""',
    '',
  ].join('\n');
}

async function redisPing(options: Pick<
  ManagedValkeyProcessOptions,
  'host' | 'port' | 'password'
>): Promise<boolean> {
  try {
    const response = await sendRedisCommands(options, [
      ['AUTH', options.password],
      ['PING'],
    ], 1_000);
    return response.includes('+OK\r\n') && response.includes('+PONG\r\n');
  } catch {
    return false;
  }
}

async function redisShutdown(options: Pick<
  ManagedValkeyProcessOptions,
  'host' | 'port' | 'password'
>): Promise<void> {
  await sendRedisCommands(options, [
    ['AUTH', options.password],
    ['SHUTDOWN', 'NOSAVE'],
  ], 3_000, true);
}

function sendRedisCommands(
  options: Pick<ManagedValkeyProcessOptions, 'host' | 'port'>,
  commands: string[][],
  timeoutMs: number,
  acceptClose = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: options.host,
      port: options.port,
    });
    let response = '';
    let settled = false;

    const settleResolve = () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(response);
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.write(commands.map(encodeRedisCommand).join(''));
    });
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (response.includes('-ERR')) {
        settleReject(new Error(`[ManagedValkey] Redis command failed: ${response.trim()}`));
        return;
      }
      if (
        response.includes('+PONG\r\n')
        || response.split('+OK\r\n').length - 1 >= commands.length
      ) {
        settleResolve();
      }
    });
    socket.once('timeout', () => settleReject(new Error('[ManagedValkey] Redis command timed out.')));
    socket.once('error', (error) => {
      if (acceptClose && response.includes('+OK\r\n')) {
        settleResolve();
        return;
      }
      settleReject(error);
    });
    socket.once('close', () => {
      if (acceptClose) settleResolve();
    });
  });
}

function encodeRedisCommand(parts: string[]): string {
  return `*${parts.length}\r\n${parts.map((part) => {
    const bytes = Buffer.byteLength(part);
    return `$${bytes}\r\n${part}\r\n`;
  }).join('')}`;
}

function redisQuoted(value: string): string {
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')}"`;
}

function validateOptions(options: ManagedValkeyProcessOptions): void {
  if (options.host !== '127.0.0.1') {
    throw new Error('[ManagedValkey] Valkey host must be 127.0.0.1.');
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`[ManagedValkey] Invalid Redis port: ${String(options.port)}`);
  }
  if (!options.password.trim()) {
    throw new Error('[ManagedValkey] Valkey password is required.');
  }
}

async function assertRuntimeFile(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error(`[ManagedValkey] Valkey server is missing: ${filePath}`);
  }
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('close', () => resolve()));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
