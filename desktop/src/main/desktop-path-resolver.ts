import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { App } from 'electron';

export type SeekmoreDesktopRuntimeEnvironment =
  | 'development'
  | 'production-unpackaged'
  | 'production-packaged';

export type RendererEntry =
  | {
      kind: 'url';
      url: string;
      allowedOrigin: string;
    }
  | {
      kind: 'file';
      indexHtmlPath: string;
      frontendDistDir: string;
      allowedFileUrl: string;
    };

export type SeekmorePackagedBackendResources = {
  backendRoot: string;
  backendEntryPath: string;
  nodeExecutablePath: string;
};

export type SeekmorePackagedPostgresResources = {
  postgresExecutablePath: string;
  initdbExecutablePath: string;
  pgIsReadyExecutablePath: string;
  pgCtlExecutablePath: string;
  psqlExecutablePath: string;
  createdbExecutablePath: string;
};

export type SeekmorePackagedCacheResources =
  | {
      provider: 'valkey';
      executablePath: string;
    }
  | {
      provider: 'garnet';
      executablePath: string;
    };

export type SeekmorePackagedPrismaResources = {
  migrationRuntimeTemplateRoot: string;
  schemaPath: string;
  migrationsRoot: string;
};

export type SeekmorePackagedDataResources = {
  postgres: SeekmorePackagedPostgresResources;
  cache: SeekmorePackagedCacheResources;
  prisma: SeekmorePackagedPrismaResources;
};

export type SeekmoreDesktopPaths = {
  runtimeEnvironment: SeekmoreDesktopRuntimeEnvironment;
  desktopRoot: string;
  projectRoot: string;
  preloadScriptPath: string;
  rendererEntry: RendererEntry;
  packagedBackendResources: SeekmorePackagedBackendResources | null;
  packagedDataResources: SeekmorePackagedDataResources | null;
};

const DEFAULT_RENDERER_DEV_URL = 'http://127.0.0.1:5173';

export async function resolveSeekmoreDesktopPaths(
  app: App,
  argv: readonly string[],
): Promise<SeekmoreDesktopPaths> {
  const runtimeEnvironment = resolveRuntimeEnvironment(app, argv);
  const desktopRoot = resolveDesktopRoot();
  const projectRoot = path.resolve(desktopRoot, '..');
  const preloadScriptPath = path.join(desktopRoot, 'dist', 'preload', 'index.js');
  await assertFileExists(preloadScriptPath, 'Preload entry');
  const rendererEntry =
    runtimeEnvironment === 'development'
      ? resolveDevelopmentRendererEntry()
      : await resolveProductionRendererEntry(runtimeEnvironment, projectRoot);

  return {
    runtimeEnvironment,
    desktopRoot,
    projectRoot,
    preloadScriptPath,
    rendererEntry,
    packagedBackendResources:
      runtimeEnvironment === 'production-packaged'
        ? resolvePackagedBackendResources(process.resourcesPath, process.platform)
        : null,
    packagedDataResources:
      runtimeEnvironment === 'production-packaged'
        ? resolvePackagedDataResources(process.resourcesPath, process.platform)
        : null,
  };
}

export function isRendererNavigationAllowed(
  targetUrl: string,
  entry: RendererEntry,
): boolean {
  if (entry.kind === 'url') {
    try {
      return new URL(targetUrl).origin === entry.allowedOrigin;
    } catch {
      return false;
    }
  }

  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'file:') return false;
    const targetPath = fileURLToPath(parsed);
    return isPathInside(targetPath, entry.frontendDistDir);
  } catch {
    return false;
  }
}


export function resolvePackagedBackendResources(
  resourcesRoot: string,
  platform: NodeJS.Platform,
): SeekmorePackagedBackendResources {
  const backendRoot = path.join(resourcesRoot, 'backend');
  const nodeExecutablePath = platform === 'win32'
    ? path.join(resourcesRoot, 'runtime', 'node', 'node.exe')
    : path.join(resourcesRoot, 'runtime', 'node', 'bin', 'node');

  return {
    backendRoot,
    backendEntryPath: path.join(backendRoot, 'dist', 'src', 'main.js'),
    nodeExecutablePath,
  };
}

export function resolvePackagedDataResources(
  resourcesRoot: string,
  platform: NodeJS.Platform,
): SeekmorePackagedDataResources {
  const backendRoot = path.join(resourcesRoot, 'backend');
  const postgresBin = path.join(resourcesRoot, 'runtime', 'postgres', 'bin');
  const executable = (name: string): string =>
    path.join(postgresBin, platform === 'win32' ? `${name}.exe` : name);

  return {
    postgres: {
      postgresExecutablePath: executable('postgres'),
      initdbExecutablePath: executable('initdb'),
      pgIsReadyExecutablePath: executable('pg_isready'),
      pgCtlExecutablePath: executable('pg_ctl'),
      psqlExecutablePath: executable('psql'),
      createdbExecutablePath: executable('createdb'),
    },
    cache: platform === 'win32'
      ? {
          provider: 'garnet',
          executablePath: path.join(
            resourcesRoot,
            'runtime',
            'cache',
            'GarnetServer.exe',
          ),
        }
      : {
          provider: 'valkey',
          executablePath: path.join(
            resourcesRoot,
            'runtime',
            'redis',
            'redis-server',
          ),
        },
    prisma: {
      migrationRuntimeTemplateRoot: path.join(
        resourcesRoot,
        'runtime',
        'prisma-migrate',
      ),
      schemaPath: path.join(backendRoot, 'prisma', 'schema.prisma'),
      migrationsRoot: path.join(backendRoot, 'prisma', 'migrations'),
    },
  };
}

function resolveRuntimeEnvironment(
  app: App,
  argv: readonly string[],
): SeekmoreDesktopRuntimeEnvironment {
  if (app.isPackaged) return 'production-packaged';
  if (argv.includes('--dev')) return 'development';
  return 'production-unpackaged';
}

function resolveDesktopRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

function resolveDevelopmentRendererEntry(): RendererEntry {
  const url = withDesktopRuntimeMarker(normalizeRendererDevUrl(
    process.env.SEEKMORE_RENDERER_DEV_URL ?? DEFAULT_RENDERER_DEV_URL,
  ));

  return {
    kind: 'url',
    url,
    allowedOrigin: new URL(url).origin,
  };
}

async function resolveProductionRendererEntry(
  runtimeEnvironment: Exclude<
    SeekmoreDesktopRuntimeEnvironment,
    'development'
  >,
  projectRoot: string,
): Promise<RendererEntry> {
  const frontendDistDir =
    runtimeEnvironment === 'production-packaged'
      ? path.join(process.resourcesPath, 'frontend', 'dist')
      : path.join(projectRoot, 'frontend', 'dist');
  const indexHtmlPath = path.join(frontendDistDir, 'index.html');

  try {
    await fs.access(indexHtmlPath);
  } catch {
    throw new Error(
      `[DesktopPaths] Renderer entry is missing: ${indexHtmlPath}. Run frontend build before starting production desktop shell.`,
    );
  }

  return {
    kind: 'file',
    indexHtmlPath,
    frontendDistDir,
    allowedFileUrl: pathToFileURL(indexHtmlPath).toString(),
  };
}

function normalizeRendererDevUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `[DesktopPaths] SEEKMORE_RENDERER_DEV_URL must be http or https, got ${parsed.protocol}`,
    );
  }
  return parsed.toString().replace(/\/$/, '');
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}


function withDesktopRuntimeMarker(value: string): string {
  const parsed = new URL(value);
  parsed.searchParams.set('seekmoreRuntime', 'desktop');
  return parsed.toString().replace(/\/$/, '');
}

async function assertFileExists(filePath: string, label: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`[DesktopPaths] ${label} is missing: ${filePath}. Run the desktop build before starting Electron.`);
  }
}
