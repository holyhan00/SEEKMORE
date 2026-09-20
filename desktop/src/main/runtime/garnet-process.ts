import {
  spawn,
  type ChildProcess,
} from 'node:child_process';
import { createWriteStream } from 'node:fs';
import {
  access,
  mkdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { sendCacheCommand } from './cache-resp';
import { terminateManagedProcessTree } from './managed-process-tree';

export type ManagedGarnetProcessOptions = {
  garnetServerExecutablePath: string;
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

export type ManagedGarnetProcessInfo = {
  pid: number;
  host: '127.0.0.1';
  port: number;
  password: string;
};

export class ManagedGarnetProcess {
  private child: ChildProcess | null = null;
  private info: ManagedGarnetProcessInfo | null = null;
  private stopping: Promise<void> | null = null;
  private ready = false;
  private configPath: string | null = null;

  constructor(
    private readonly options: ManagedGarnetProcessOptions,
  ) {}

  async start(): Promise<ManagedGarnetProcessInfo> {
    if (
      this.info
      && this.child
      && this.child.exitCode === null
    ) {
      return this.info;
    }

    validateOptions(this.options);
    await assertRuntimeFile(
      this.options.garnetServerExecutablePath,
    );
    await Promise.all([
      mkdir(this.options.dataRoot, {
        recursive: true,
        mode: 0o700,
      }),
      mkdir(this.options.runtimeRoot, {
        recursive: true,
        mode: 0o700,
      }),
      mkdir(path.dirname(this.options.logPath), {
        recursive: true,
        mode: 0o700,
      }),
    ]);

    const configPath = path.join(
      this.options.runtimeRoot,
      `.garnet-runtime-${process.pid}-${this.options.port}.conf`,
    );
    this.configPath = configPath;
    await unlink(configPath).catch(
      () => undefined,
    );
    await writeFile(
      configPath,
      `${JSON.stringify(
        buildGarnetConfig(this.options),
        null,
        2,
      )}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      },
    );

    const logStream = createWriteStream(
      this.options.logPath,
      {
        flags: 'a',
        mode: 0o600,
      },
    );
    logStream.write(
      `\n[${new Date().toISOString()}] SEEKMORE managed Garnet starting\n`,
    );

    const child = spawn(
      this.options.garnetServerExecutablePath,
      [
        '--config-import-path',
        configPath,
      ],
      {
        cwd: path.dirname(
          this.options.garnetServerExecutablePath,
        ),
        env: process.env,
        stdio: [
          'ignore',
          'pipe',
          'pipe',
        ],
        windowsHide: true,
      },
    );
    this.child = child;
    child.stdout?.pipe(
      logStream,
      { end: false },
    );
    child.stderr?.pipe(
      logStream,
      { end: false },
    );

    const closeLog = () => {
      if (!logStream.closed) {
        logStream.end(
          `[${new Date().toISOString()}] SEEKMORE managed Garnet stopped\n`,
        );
      }
    };

    child.once(
      'close',
      (code, signal) => {
        closeLog();
        const unexpected =
          this.ready
          && !this.stopping;

        if (this.child === child) {
          this.child = null;
          this.info = null;
          this.ready = false;
        }

        if (unexpected) {
          this.options.onUnexpectedExit?.({
            code,
            signal,
          });
        }
      },
    );
    child.once('error', closeLog);

    const pid = child.pid;
    if (!pid) {
      child.kill();
      await this.removeRuntimeConfig();
      throw new Error(
        '[ManagedGarnet] Garnet process did not receive a PID.',
      );
    }

    try {
      await this.waitUntilReady(child);
    } catch (error) {
      await this.stop().catch(
        () => undefined,
      );
      throw error;
    } finally {
      // Garnet imports its JSON configuration at startup. Remove the
      // temporary file immediately because it contains the cache password.
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
    if (this.stopping) {
      return this.stopping;
    }

    const child = this.child;
    this.info = null;
    this.ready = false;
    await this.removeRuntimeConfig();

    if (!child || child.exitCode !== null) {
      this.child = null;
      return;
    }

    this.stopping = this.stopRunningServer(
      child,
    ).finally(() => {
      this.stopping = null;
      if (this.child === child) {
        this.child = null;
      }
    });

    return this.stopping;
  }

  private async waitUntilReady(
    child: ChildProcess,
  ): Promise<void> {
    const timeoutMs =
      this.options.startupTimeoutMs
      ?? 30_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(
          `[ManagedGarnet] Garnet exited before becoming ready (code=${String(child.exitCode)}).`,
        );
      }

      try {
        const response =
          await sendCacheCommand(
            this.options,
            ['PING'],
            1_000,
          );

        if (response === 'PONG') {
          return;
        }
      } catch {
        // Startup race: retry until the bounded deadline.
      }

      await delay(150);
    }

    throw new Error(
      `[ManagedGarnet] Garnet readiness timed out after ${timeoutMs}ms.`,
    );
  }

  private async stopRunningServer(
    child: ChildProcess,
  ): Promise<void> {
    const timeoutMs =
      this.options.shutdownTimeoutMs
      ?? 15_000;

    // Garnet does not implement Redis SHUTDOWN. AOF is configured with
    // WaitForCommit so acknowledged writes are durable before the Desktop
    // host terminates the process tree it owns.
    await terminateManagedProcessTree(
      child,
      {
        gracefulTimeoutMs: timeoutMs,
        forceTimeoutMs: 5_000,
      },
    );
  }

  private async removeRuntimeConfig(): Promise<void> {
    const configPath = this.configPath;
    this.configPath = null;

    if (configPath) {
      await unlink(configPath).catch(
        () => undefined,
      );
    }
  }
}

export function buildGarnetConfig(
  options: Pick<
    ManagedGarnetProcessOptions,
    | 'host'
    | 'port'
    | 'password'
    | 'dataRoot'
  >,
): Record<string, unknown> {
  return {
    Address: options.host,
    Port: options.port,
    AuthenticationMode: 'Password',
    Password: options.password,
    EnableAOF: true,
    CommitFrequencyMs: 1000,
    WaitForCommit: true,
    Recover: true,
    CheckpointDir: options.dataRoot,
  };
}

function validateOptions(
  options: ManagedGarnetProcessOptions,
): void {
  if (options.host !== '127.0.0.1') {
    throw new Error(
      '[ManagedGarnet] Garnet host must be 127.0.0.1.',
    );
  }

  if (
    !Number.isInteger(options.port)
    || options.port < 1
    || options.port > 65_535
  ) {
    throw new Error(
      `[ManagedGarnet] Invalid Garnet port: ${String(options.port)}`,
    );
  }

  if (!options.password.trim()) {
    throw new Error(
      '[ManagedGarnet] Garnet password is required.',
    );
  }
}

async function assertRuntimeFile(
  filePath: string,
): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error(
      `[ManagedGarnet] Garnet server is missing: ${filePath}`,
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
