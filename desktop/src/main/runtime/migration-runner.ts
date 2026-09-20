import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export type PrismaMigrationRunnerOptions = {
  nodeExecutablePath: string;
  prismaCliEntryPath: string;
  workingDirectory: string;
  schemaPath: string;
  migrationsRoot: string;
  databaseUrl: string;
  logPath: string;
};

export class PrismaMigrationRunner {
  constructor(private readonly options: PrismaMigrationRunnerOptions) {}

  async run(): Promise<void> {
    await Promise.all([
      assertFile(this.options.nodeExecutablePath, 'Bundled Node executable'),
      assertFile(this.options.prismaCliEntryPath, 'Prisma CLI entry'),
      assertDirectory(this.options.workingDirectory, 'Prisma migration runtime root'),
      assertFile(this.options.schemaPath, 'Prisma schema'),
      assertDirectory(this.options.migrationsRoot, 'Prisma migrations root'),
    ]);
    await assertMigrationHistoryPresent(this.options.migrationsRoot);
    await mkdir(path.dirname(this.options.logPath), {
      recursive: true,
      mode: 0o700,
    });

    const logStream = createWriteStream(this.options.logPath, {
      flags: 'a',
      mode: 0o600,
    });
    logStream.write(
      `\n[${new Date().toISOString()}] SEEKMORE Prisma migrate deploy starting\n`,
    );

    const child = spawn(
      this.options.nodeExecutablePath,
      [
        this.options.prismaCliEntryPath,
        'migrate',
        'deploy',
        '--schema',
        this.options.schemaPath,
      ],
      {
        cwd: this.options.workingDirectory,
        env: prismaEnvironment(this.options.databaseUrl),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });

    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode) => resolve(exitCode ?? 1));
    }).finally(() => {
      if (!logStream.closed) {
        logStream.end(
          `[${new Date().toISOString()}] SEEKMORE Prisma migrate deploy stopped\n`,
        );
      }
    });

    if (code !== 0) {
      throw new Error(
        `[MigrationRunner] Prisma migrate deploy failed with exit code ${code}. See ${this.options.logPath}`,
      );
    }
  }
}

async function assertMigrationHistoryPresent(migrationsRoot: string): Promise<void> {
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  const migrationDirectories = entries.filter((entry) => entry.isDirectory());

  for (const entry of migrationDirectories) {
    const migrationSql = path.join(migrationsRoot, entry.name, 'migration.sql');
    try {
      await access(migrationSql);
      return;
    } catch {
      // Continue checking other migration directories.
    }
  }

  throw new Error(
    `[MigrationRunner] No Prisma migration.sql was found under ${migrationsRoot}. Refusing to bootstrap a packaged database from schema drift.`,
  );
}

async function assertFile(filePath: string, label: string): Promise<void> {
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) throw new Error('not-a-file');
  } catch {
    throw new Error(`[MigrationRunner] ${label} is missing: ${filePath}`);
  }
}

async function assertDirectory(directoryPath: string, label: string): Promise<void> {
  try {
    const metadata = await stat(directoryPath);
    if (!metadata.isDirectory()) throw new Error('not-a-directory');
  } catch {
    throw new Error(`[MigrationRunner] ${label} is missing: ${directoryPath}`);
  }
}

function prismaEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
    CHECKPOINT_DISABLE: '1',
  };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
