const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  buildSeekmoreBackendRuntimeEnvironment,
  resolveSeekmoreRuntimePaths,
} = require('../dist/main/runtime');

const testRoot = path.join(
  path.parse(process.cwd()).root,
  'seekmore-path-contract',
);
const resourcesRoot = path.join(testRoot, 'application', 'resources');
const dataHome = path.join(testRoot, 'user-data');
const temporaryRoot = path.join(testRoot, 'tmp');
const packagedBackend = {
  backendRoot: path.join(resourcesRoot, 'backend'),
  nodeExecutablePath: path.join(resourcesRoot, 'runtime', 'node', 'bin', 'node'),
  port: 43127,
  secrets: {
    jwtAccessSecret: 'access-secret',
    jwtRefreshSecret: 'refresh-secret',
    mcpSecretEncryptionKey: Buffer.alloc(32, 7).toString('base64'),
    postgresPassword: 'postgres-secret',
    redisPassword: 'redis-secret',
  },
  data: {
    databaseUrl: 'postgresql://seekmore:postgres-secret@127.0.0.1:45432/seekmore?schema=public',
    redisHost: '127.0.0.1',
    redisPort: 46379,
    redisPassword: 'redis-secret',
  },
};

test('development keeps the current backend storage environment untouched', () => {
  const paths = resolveSeekmoreRuntimePaths({
    runtimeEnvironment: 'development',
    platform: 'darwin',
    resourcesRoot,
    dataHome,
    temporaryRoot,
  });

  const env = buildSeekmoreBackendRuntimeEnvironment({
    runtimeEnvironment: 'development',
    paths,
    baseEnv: {
      EXISTING: 'keep-me',
    },
  });

  assert.equal(env.EXISTING, 'keep-me');
  assert.equal(env.USER_STORAGE_DIR, undefined);
  assert.equal(env.AGENT_STORAGE_DIR, undefined);
  assert.equal(env.SKILL_STORAGE_ROOT, undefined);
  assert.equal(env.OBJECT_STORAGE_ROOT, undefined);
  assert.equal(env.JWT_ACCESS_SECRET, undefined);
  assert.equal(env.SEEKMORE_DESKTOP_RUNTIME_DESCRIPTOR_PATH, undefined);
  assert.equal(
    paths.desktopRuntimeDescriptorPath,
    path.join(temporaryRoot, 'seekmore-desktop-web-runtime.json'),
  );
});

test('development preserves explicit caller-provided runtime overrides', () => {
  const paths = resolveSeekmoreRuntimePaths({
    runtimeEnvironment: 'development',
    platform: 'darwin',
    resourcesRoot,
    dataHome,
    temporaryRoot,
  });

  const env = buildSeekmoreBackendRuntimeEnvironment({
    runtimeEnvironment: 'development',
    paths,
    baseEnv: {
      USER_STORAGE_DIR: '/custom/users',
      AGENT_STORAGE_DIR: '/custom/agents',
      SKILL_STORAGE_ROOT: '/custom/skills',
      OBJECT_STORAGE_ROOT: '/custom/objects',
      PORT: '3999',
      HOST: '0.0.0.0',
      DATABASE_URL: 'postgresql://development-db',
      REDIS_HOST: 'development-redis',
      REDIS_PORT: '6380',
      REDIS_PASSWORD: 'development-password',
    },
  });

  assert.equal(env.USER_STORAGE_DIR, '/custom/users');
  assert.equal(env.AGENT_STORAGE_DIR, '/custom/agents');
  assert.equal(env.SKILL_STORAGE_ROOT, '/custom/skills');
  assert.equal(env.OBJECT_STORAGE_ROOT, '/custom/objects');
  assert.equal(env.PORT, '3999');
  assert.equal(env.HOST, '0.0.0.0');
  assert.equal(env.DATABASE_URL, 'postgresql://development-db');
  assert.equal(env.REDIS_HOST, 'development-redis');
  assert.equal(env.REDIS_PORT, '6380');
  assert.equal(env.REDIS_PASSWORD, 'development-password');
});

test('packaged mode maps persistent storage, runtime state and secrets outside application resources', () => {
  const paths = resolveSeekmoreRuntimePaths({
    runtimeEnvironment: 'production-packaged',
    platform: 'darwin',
    resourcesRoot,
    dataHome,
    temporaryRoot,
  });

  const env = buildSeekmoreBackendRuntimeEnvironment({
    runtimeEnvironment: 'production-packaged',
    paths,
    baseEnv: {
      USER_STORAGE_DIR: '/unsafe/source/users',
      AGENT_STORAGE_DIR: '/unsafe/source/agents',
      CORS_ALLOWED_ORIGINS: 'https://example.invalid',
      NODE_OPTIONS: '--require=/unsafe/injected.js',
      NODE_PATH: '/unsafe/node-path',
      ELECTRON_RUN_AS_NODE: '1',
      DATABASE_URL: 'postgresql://unsafe-development-db',
      REDIS_HOST: '0.0.0.0',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: 'unsafe-redis-password',
    },
    packagedBackend,
  });

  assert.equal(paths.storageRoot, path.join(dataHome, 'storage'));
  assert.equal(env.USER_STORAGE_DIR, path.join(dataHome, 'storage', 'users'));
  assert.equal(env.AGENT_STORAGE_DIR, path.join(dataHome, 'storage', 'agents'));
  assert.equal(env.SKILL_STORAGE_ROOT, path.join(dataHome, 'storage', 'skills'));
  assert.equal(env.OBJECT_STORAGE_ROOT, path.join(dataHome, 'storage', 'objects'));
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.NODE_PATH, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.HOST, '127.0.0.1');
  assert.equal(env.PORT, '43127');
  assert.equal(env.SEEKMORE_BACKEND_ROOT, packagedBackend.backendRoot);
  assert.equal(env.MCP_PLAYWRIGHT_COMMAND, undefined);
  assert.equal(env.MCP_PLAYWRIGHT_ARGS, undefined);
  assert.equal(env.JWT_ACCESS_SECRET, 'access-secret');
  assert.equal(env.JWT_REFRESH_SECRET, 'refresh-secret');
  assert.equal(env.DATABASE_URL, packagedBackend.data.databaseUrl);
  assert.equal(env.REDIS_HOST, '127.0.0.1');
  assert.equal(env.REDIS_PORT, '46379');
  assert.equal(env.REDIS_PASSWORD, 'redis-secret');
  assert.equal(
    env.MCP_SECRET_ENCRYPTION_KEY,
    packagedBackend.secrets.mcpSecretEncryptionKey,
  );
  assert.equal(
    env.SEEKMORE_DESKTOP_RUNTIME_DESCRIPTOR_PATH,
    path.join(dataHome, 'runtime', 'seekmore-desktop-web-runtime.json'),
  );
  assert.equal(
    paths.runtimeSecretsPath,
    path.join(dataHome, 'secrets', 'runtime-secrets.json'),
  );
  assert.equal(
    paths.backendLogPath,
    path.join(dataHome, 'logs', 'backend.log'),
  );
  assert.equal(
    paths.postgresLogPath,
    path.join(dataHome, 'logs', 'postgres.log'),
  );
  assert.equal(
    paths.cacheLogPath,
    path.join(dataHome, 'logs', 'redis.log'),
  );
  assert.equal(
    paths.prismaMigrationRuntimeRoot,
    path.join(dataHome, 'runtime', 'prisma-migrate'),
  );
  assert.equal(
    paths.migrationLogPath,
    path.join(dataHome, 'logs', 'migration.log'),
  );
  assert.deepEqual(
    new Set(String(env.CORS_ALLOWED_ORIGINS).split(',')),
    new Set(['https://example.invalid', 'null']),
  );

  for (const value of [
    env.USER_STORAGE_DIR,
    env.AGENT_STORAGE_DIR,
    env.SKILL_STORAGE_ROOT,
    env.OBJECT_STORAGE_ROOT,
    env.SEEKMORE_DESKTOP_RUNTIME_DESCRIPTOR_PATH,
    paths.databaseRoot,
    paths.postgresDataRoot,
    paths.cacheDataRoot,
    paths.prismaMigrationRuntimeRoot,
    paths.secretsRoot,
    paths.runtimeSecretsPath,
    paths.logsRoot,
    paths.backendLogPath,
    paths.postgresLogPath,
    paths.cacheLogPath,
    paths.migrationLogPath,
  ]) {
    assert.ok(value);
    assert.ok(isInside(value, dataHome));
    assert.equal(isInside(value, resourcesRoot), false);
  }
});

test('packaged environment requires the managed backend contract', () => {
  const paths = resolveSeekmoreRuntimePaths({
    runtimeEnvironment: 'production-packaged',
    platform: 'darwin',
    resourcesRoot,
    dataHome,
    temporaryRoot,
  });

  assert.throws(
    () => buildSeekmoreBackendRuntimeEnvironment({
      runtimeEnvironment: 'production-packaged',
      paths,
      baseEnv: {},
    }),
    /Packaged backend environment is required/,
  );
});

test('packaged mode rejects a dataHome inside application resources', () => {
  assert.throws(
    () => resolveSeekmoreRuntimePaths({
      runtimeEnvironment: 'production-packaged',
      platform: 'darwin',
      resourcesRoot,
      dataHome: path.join(resourcesRoot, 'writable'),
      temporaryRoot,
    }),
    /must not be inside application resources/,
  );
});


test('Windows packaged paths keep mutable cache state in the Windows cache data root', () => {
  const paths = resolveSeekmoreRuntimePaths({
    runtimeEnvironment: 'production-packaged',
    platform: 'win32',
    resourcesRoot,
    dataHome,
    temporaryRoot,
  });

  assert.equal(paths.cacheDataRoot, path.join(dataHome, 'runtime', 'cache'));
  assert.equal(paths.cacheLogPath, path.join(dataHome, 'logs', 'cache.log'));
  assert.equal(isInside(paths.cacheDataRoot, resourcesRoot), false);
});

function isInside(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}
