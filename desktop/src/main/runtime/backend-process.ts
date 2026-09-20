import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { request } from 'node:http';
import { terminateManagedProcessTree } from './managed-process-tree';

export type ManagedBackendProcessOptions = {
  nodeExecutablePath: string;
  backendEntryPath: string;
  backendRoot: string;
  host: '127.0.0.1';
  port: number;
  environment: NodeJS.ProcessEnv;
  logPath: string;
  healthTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  onUnexpectedExit?: (event: {
    code: number | null;
    signal: NodeJS.Signals | null;
  }) => void;
};

export type ManagedBackendProcessInfo = {
  pid: number;
  origin: string;
};

export class ManagedBackendProcess {
  private child: ChildProcess | null = null;
  private info: ManagedBackendProcessInfo | null = null;
  private stopping: Promise<void> | null = null;

  constructor(private readonly options: ManagedBackendProcessOptions) {}

  async start(): Promise<ManagedBackendProcessInfo> {
    if (this.info && this.child && this.child.exitCode === null) {
      return this.info;
    }

    await assertRuntimeFile(this.options.nodeExecutablePath, 'Bundled Node executable');
    await assertRuntimeFile(this.options.backendEntryPath, 'Backend entry');
    await fs.mkdir(path.dirname(this.options.logPath), {
      recursive: true,
      mode: 0o700,
    });

    const logStream = createWriteStream(this.options.logPath, {
      flags: 'a',
      mode: 0o600,
    });
    logStream.write(
      `\n[${new Date().toISOString()}] SEEKMORE managed backend starting\n`,
    );

    const child = spawn(
      this.options.nodeExecutablePath,
      [this.options.backendEntryPath],
      {
        cwd: this.options.backendRoot,
        env: this.options.environment,
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
          `[${new Date().toISOString()}] SEEKMORE managed backend stopped\n`,
        );
      }
    };
    child.once('close', (code, signal) => {
      closeLog();
      const wasReady = Boolean(
        this.info
        && child.pid
        && this.info.pid === child.pid,
      );
      if (this.child === child) {
        this.child = null;
        this.info = null;
      }
      if (wasReady && !this.stopping) {
        this.options.onUnexpectedExit?.({ code, signal });
      }
    });
    child.once('error', closeLog);

    const pid = child.pid;
    if (!pid) {
      child.kill();
      throw new Error('[ManagedBackend] Backend process did not receive a PID.');
    }

    const origin = `http://${this.options.host}:${this.options.port}`;

    try {
      await waitForBackendHealth({
        origin,
        child,
        timeoutMs: this.options.healthTimeoutMs ?? 60_000,
      });
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }

    this.info = { pid, origin };
    return this.info;
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;

    const child = this.child;
    this.info = null;
    this.child = null;

    if (!child || child.exitCode !== null) return;

    this.stopping = stopChildProcess(
      child,
      this.options.shutdownTimeoutMs ?? 15_000,
    ).finally(() => {
      this.stopping = null;
    });

    return this.stopping;
  }
}

export async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();

  try {
    return await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('[ManagedBackend] Unable to allocate loopback port.'));
          return;
        }
        resolve(address.port);
      });
    });
  } finally {
    await new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
  }
}

async function waitForBackendHealth(input: {
  origin: string;
  child: ChildProcess;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;

  while (Date.now() < deadline) {
    if (input.child.exitCode !== null) {
      throw new Error(
        `[ManagedBackend] Backend exited before becoming healthy (code=${String(input.child.exitCode)}).`,
      );
    }

    if (await isHealthy(`${input.origin}/api/health`)) {
      return;
    }

    await delay(200);
  }

  throw new Error(
    `[ManagedBackend] Backend health check timed out after ${input.timeoutMs}ms.`,
  );
}

function isHealthy(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(url, {
      method: 'GET',
      timeout: 1_000,
    }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    req.once('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.once('error', () => resolve(false));
    req.end();
  });
}

async function stopChildProcess(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null) return;

  await terminateManagedProcessTree(child, {
    gracefulTimeoutMs: timeoutMs,
    forceTimeoutMs: 5_000,
  });
}

async function assertRuntimeFile(filePath: string, label: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`[ManagedBackend] ${label} is missing: ${filePath}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
