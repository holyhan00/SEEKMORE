import path from 'node:path';
import type {
  SeekmoreRuntimePathContext,
  SeekmoreRuntimePaths,
} from './runtime.types';

const DESKTOP_RUNTIME_DESCRIPTOR_FILENAME =
  'seekmore-desktop-web-runtime.json';
const RUNTIME_SECRETS_FILENAME = 'runtime-secrets.json';
const BACKEND_LOG_FILENAME = 'backend.log';
const POSTGRES_LOG_FILENAME = 'postgres.log';
const REDIS_LOG_FILENAME = 'redis.log';
const CACHE_LOG_FILENAME = 'cache.log';
const MIGRATION_LOG_FILENAME = 'migration.log';

export function resolveSeekmoreRuntimePaths(
  context: SeekmoreRuntimePathContext,
): SeekmoreRuntimePaths {
  const resourcesRoot = path.resolve(context.resourcesRoot);
  const dataHome = path.resolve(context.dataHome);
  const temporaryRoot = path.resolve(context.temporaryRoot);

  if (
    context.runtimeEnvironment === 'production-packaged'
    && isPathInside(dataHome, resourcesRoot)
  ) {
    throw new Error(
      `[RuntimePaths] Packaged dataHome must not be inside application resources: ${dataHome}`,
    );
  }

  const databaseRoot = path.join(dataHome, 'database');
  const storageRoot = path.join(dataHome, 'storage');
  const runtimeRoot = path.join(dataHome, 'runtime');
  const secretsRoot = path.join(dataHome, 'secrets');
  const logsRoot = path.join(dataHome, 'logs');

  return {
    resourcesRoot,
    dataHome,

    databaseRoot,
    postgresDataRoot: path.join(databaseRoot, 'postgres'),

    storageRoot,
    userStorageRoot: path.join(storageRoot, 'users'),
    agentStorageRoot: path.join(storageRoot, 'agents'),
    skillStorageRoot: path.join(storageRoot, 'skills'),
    objectStorageRoot: path.join(storageRoot, 'objects'),
    presentationStorageRoot: path.join(storageRoot, 'presentations'),

    runtimeRoot,
    cacheDataRoot: path.join(
      runtimeRoot,
      context.platform === 'win32' ? 'cache' : 'redis',
    ),
    prismaMigrationRuntimeRoot: path.join(runtimeRoot, 'prisma-migrate'),
    desktopRuntimeDescriptorPath:
      context.runtimeEnvironment === 'production-packaged'
        ? path.join(runtimeRoot, DESKTOP_RUNTIME_DESCRIPTOR_FILENAME)
        : path.join(temporaryRoot, DESKTOP_RUNTIME_DESCRIPTOR_FILENAME),

    secretsRoot,
    runtimeSecretsPath: path.join(secretsRoot, RUNTIME_SECRETS_FILENAME),

    logsRoot,
    backendLogPath: path.join(logsRoot, BACKEND_LOG_FILENAME),
    postgresLogPath: path.join(logsRoot, POSTGRES_LOG_FILENAME),
    cacheLogPath: path.join(
      logsRoot,
      context.platform === 'win32'
        ? CACHE_LOG_FILENAME
        : REDIS_LOG_FILENAME,
    ),
    migrationLogPath: path.join(logsRoot, MIGRATION_LOG_FILENAME),
  };
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}
