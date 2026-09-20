import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, appendFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { terminateManagedProcessTree } from './managed-process-tree';

export type ManagedPostgresProcessOptions = {
  postgresExecutablePath: string;
  initdbExecutablePath: string;
  pgIsReadyExecutablePath: string;
  pgCtlExecutablePath: string;
  psqlExecutablePath: string;
  createdbExecutablePath: string;
  dataRoot: string;
  host: '127.0.0.1';
  port: number;
  username: string;
  databaseName: string;
  password: string;
  logPath: string;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  onUnexpectedExit?: (event: {
    code: number | null;
    signal: NodeJS.Signals | null;
  }) => void;
};

export type ManagedPostgresProcessInfo = {
  pid: number;
  host: '127.0.0.1';
  port: number;
  databaseUrl: string;
};

export class ManagedPostgresProcess {
  private child: ChildProcess | null = null;
  private info: ManagedPostgresProcessInfo | null = null;
  private stopping: Promise<void> | null = null;
  private ready = false;

  constructor(private readonly options: ManagedPostgresProcessOptions) {}

  async start(): Promise<ManagedPostgresProcessInfo> {
    if (this.info && this.child && this.child.exitCode === null) {
      return this.info;
    }

    validateOptions(this.options);
    await Promise.all([
      assertRuntimeFile(this.options.postgresExecutablePath, 'PostgreSQL server'),
      assertRuntimeFile(this.options.initdbExecutablePath, 'PostgreSQL initdb'),
      assertRuntimeFile(this.options.pgIsReadyExecutablePath, 'PostgreSQL pg_isready'),
      assertRuntimeFile(this.options.pgCtlExecutablePath, 'PostgreSQL pg_ctl'),
      assertRuntimeFile(this.options.psqlExecutablePath, 'PostgreSQL psql'),
      assertRuntimeFile(this.options.createdbExecutablePath, 'PostgreSQL createdb'),
    ]);

    await mkdir(path.dirname(this.options.logPath), {
      recursive: true,
      mode: 0o700,
    });
    await this.ensureClusterInitialized();
    await this.assertDataVersionCompatible();

    const logStream = createWriteStream(this.options.logPath, {
      flags: 'a',
      mode: 0o600,
    });
    logStream.write(
      `\n[${new Date().toISOString()}] SEEKMORE managed PostgreSQL starting\n`,
    );

    const child = spawn(
      this.options.postgresExecutablePath,
      [
        '-D', this.options.dataRoot,
        '-h', this.options.host,
        '-p', String(this.options.port),
      ],
      {
        cwd: path.dirname(this.options.postgresExecutablePath),
        env: postgresServerEnvironment(),
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
          `[${new Date().toISOString()}] SEEKMORE managed PostgreSQL stopped\n`,
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
      if (unexpected) {
        this.options.onUnexpectedExit?.({ code, signal });
      }
    });
    child.once('error', closeLog);

    const pid = child.pid;
    if (!pid) {
      child.kill();
      throw new Error('[ManagedPostgres] PostgreSQL process did not receive a PID.');
    }

    try {
      await this.waitUntilReady(child);
      await this.ensureApplicationDatabase();
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }

    const databaseUrl = buildPostgresDatabaseUrl({
      host: this.options.host,
      port: this.options.port,
      username: this.options.username,
      password: this.options.password,
      databaseName: this.options.databaseName,
    });

    this.ready = true;
    this.info = {
      pid,
      host: this.options.host,
      port: this.options.port,
      databaseUrl,
    };
    return this.info;
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;

    const child = this.child;
    this.info = null;
    this.ready = false;
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

  private async ensureClusterInitialized(): Promise<void> {
    const versionPath = path.join(this.options.dataRoot, 'PG_VERSION');
    if (await fileExists(versionPath)) {
      const version = (await readFile(versionPath, 'utf8')).trim();
      if (!version) {
        throw new Error(
          `[ManagedPostgres] PostgreSQL data directory has an invalid PG_VERSION: ${versionPath}`,
        );
      }
      return;
    }

    let entries: string[] = [];
    try {
      entries = await readdir(this.options.dataRoot);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }

    if (entries.length > 0) {
      throw new Error(
        `[ManagedPostgres] Refusing to initialize non-empty PostgreSQL data directory without PG_VERSION: ${this.options.dataRoot}`,
      );
    }

    await mkdir(this.options.dataRoot, {
      recursive: true,
      mode: 0o700,
    });

    const passwordFile = path.join(
      path.dirname(this.options.dataRoot),
      `.seekmore-initdb-${process.pid}.pw`,
    );
    await unlink(passwordFile).catch(() => undefined);
    await writeFile(passwordFile, `${this.options.password}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });

    try {
      await runCommand({
        executablePath: this.options.initdbExecutablePath,
        args: [
          '-D', this.options.dataRoot,
          '--encoding=UTF8',
          `--username=${this.options.username}`,
          `--pwfile=${passwordFile}`,
          '--auth-host=scram-sha-256',
          '--auth-local=scram-sha-256',
        ],
        environment: postgresClientEnvironment(this.options.password),
        logPath: this.options.logPath,
        label: 'initdb',
      });
    } finally {
      await unlink(passwordFile).catch(() => undefined);
    }
  }

  private async assertDataVersionCompatible(): Promise<void> {
    const dataVersion = (
      await readFile(path.join(this.options.dataRoot, 'PG_VERSION'), 'utf8')
    ).trim();
    const dataMajor = dataVersion.split('.')[0];

    const runtimeVersion = await runCommand({
      executablePath: this.options.postgresExecutablePath,
      args: ['--version'],
      environment: postgresServerEnvironment(),
      allowFailure: false,
    });
    const match = `${runtimeVersion.stdout} ${runtimeVersion.stderr}`.match(
      /PostgreSQL\)?\s+(\d+)(?:\.|\s|$)/i,
    );
    if (!match) {
      throw new Error(
        '[ManagedPostgres] Unable to determine bundled PostgreSQL major version.',
      );
    }

    if (dataMajor !== match[1]) {
      throw new Error(
        `[ManagedPostgres] PostgreSQL data major ${dataMajor} is incompatible with bundled PostgreSQL major ${match[1]}. A managed major-version migration is required before startup.`,
      );
    }
  }

  private async waitUntilReady(child: ChildProcess): Promise<void> {
    const timeoutMs = this.options.startupTimeoutMs ?? 60_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(
          `[ManagedPostgres] PostgreSQL exited before becoming ready (code=${String(child.exitCode)}).`,
        );
      }

      const result = await runCommand({
        executablePath: this.options.pgIsReadyExecutablePath,
        args: [
          '-h', this.options.host,
          '-p', String(this.options.port),
          '-U', this.options.username,
          '-d', 'postgres',
          '-t', '1',
        ],
        environment: postgresClientEnvironment(this.options.password),
        allowFailure: true,
      });
      if (result.code === 0) return;
      await delay(200);
    }

    throw new Error(
      `[ManagedPostgres] PostgreSQL readiness timed out after ${timeoutMs}ms.`,
    );
  }

  private async ensureApplicationDatabase(): Promise<void> {
    const query = `SELECT 1 FROM pg_database WHERE datname = ${sqlStringLiteral(this.options.databaseName)};`;
    const result = await runCommand({
      executablePath: this.options.psqlExecutablePath,
      args: [
        '-h', this.options.host,
        '-p', String(this.options.port),
        '-U', this.options.username,
        '-d', 'postgres',
        '-Atqc', query,
      ],
      environment: postgresClientEnvironment(this.options.password),
      logPath: this.options.logPath,
      label: 'database-check',
    });

    if (result.stdout.trim().split(/\s+/).includes('1')) return;

    await runCommand({
      executablePath: this.options.createdbExecutablePath,
      args: [
        '-h', this.options.host,
        '-p', String(this.options.port),
        '-U', this.options.username,
        '-O', this.options.username,
        this.options.databaseName,
      ],
      environment: postgresClientEnvironment(this.options.password),
      logPath: this.options.logPath,
      label: 'createdb',
    });
  }

  private async stopRunningServer(child: ChildProcess): Promise<void> {
    const timeoutMs = this.options.shutdownTimeoutMs ?? 30_000;
    const exited = waitForChildExit(child);

    const stopResult = await runCommand({
      executablePath: this.options.pgCtlExecutablePath,
      args: [
        '-D', this.options.dataRoot,
        'stop',
        '-m', 'fast',
        '-w',
        '-t', String(Math.max(1, Math.ceil(timeoutMs / 1_000))),
      ],
      environment: postgresClientEnvironment(this.options.password),
      logPath: this.options.logPath,
      label: 'pg_ctl-stop',
      allowFailure: true,
    });

    if (stopResult.code === 0) {
      await Promise.race([exited, delay(5_000)]);
      return;
    }

    await terminateManagedProcessTree(child, {
      gracefulTimeoutMs: timeoutMs,
      forceTimeoutMs: 5_000,
    });
  }
}

export function buildPostgresDatabaseUrl(input: {
  host: string;
  port: number;
  username: string;
  password: string;
  databaseName: string;
}): string {
  return `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.host}:${input.port}/${encodeURIComponent(input.databaseName)}?schema=public`;
}

function validateOptions(options: ManagedPostgresProcessOptions): void {
  if (options.host !== '127.0.0.1') {
    throw new Error('[ManagedPostgres] PostgreSQL host must be 127.0.0.1.');
  }
  assertPort(options.port);
  for (const [label, value] of [
    ['username', options.username],
    ['database name', options.databaseName],
    ['password', options.password],
    ['data root', options.dataRoot],
  ] as const) {
    if (!value.trim()) {
      throw new Error(`[ManagedPostgres] PostgreSQL ${label} is required.`);
    }
  }
}

function postgresClientEnvironment(password: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGPASSWORD: password,
  };
  delete env.PGHOST;
  delete env.PGPORT;
  delete env.PGDATABASE;
  delete env.PGUSER;
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  return env;
}

function postgresServerEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PGPASSWORD;
  delete env.PGHOST;
  delete env.PGPORT;
  delete env.PGDATABASE;
  delete env.PGUSER;
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  return env;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

async function runCommand(input: {
  executablePath: string;
  args: string[];
  environment: NodeJS.ProcessEnv;
  logPath?: string;
  label?: string;
  allowFailure?: boolean;
}): Promise<CommandResult> {
  const child = spawn(input.executablePath, input.args, {
    env: input.environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => resolve(exitCode ?? 1));
  });

  if (input.logPath && (stdout || stderr || code !== 0)) {
    await mkdir(path.dirname(input.logPath), { recursive: true, mode: 0o700 });
    const output = [
      `\n[${new Date().toISOString()}] PostgreSQL ${input.label ?? 'command'} exit=${code}\n`,
      stdout,
      stderr,
    ].join('');
    await appendFile(input.logPath, output, { encoding: 'utf8', mode: 0o600 });
  }

  if (code !== 0 && !input.allowFailure) {
    throw new Error(
      `[ManagedPostgres] ${input.label ?? path.basename(input.executablePath)} failed with exit code ${code}.${stderr.trim() ? ` ${stderr.trim()}` : ''}`,
    );
  }

  return { code, stdout, stderr };
}

async function assertRuntimeFile(filePath: string, label: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error(`[ManagedPostgres] ${label} is missing: ${filePath}`);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[ManagedPostgres] Invalid PostgreSQL port: ${String(port)}`);
  }
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('close', () => resolve()));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
