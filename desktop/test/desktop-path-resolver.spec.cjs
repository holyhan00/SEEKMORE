const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  resolvePackagedBackendResources,
  resolvePackagedDataResources,
} = require('../dist/main/desktop-path-resolver');

test('packaged backend resources resolve to deterministic application resources on macOS/Linux', () => {
  const root = path.resolve('/bundle/resources');
  const value = resolvePackagedBackendResources(root, 'darwin');

  assert.equal(value.backendRoot, path.join(root, 'backend'));
  assert.equal(
    value.backendEntryPath,
    path.join(root, 'backend', 'dist', 'src', 'main.js'),
  );
  assert.equal(
    value.nodeExecutablePath,
    path.join(root, 'runtime', 'node', 'bin', 'node'),
  );
});

test('packaged backend resources use node.exe on Windows', () => {
  const root = path.resolve('C:/bundle/resources');
  const value = resolvePackagedBackendResources(root, 'win32');
  assert.equal(
    value.nodeExecutablePath,
    path.join(root, 'runtime', 'node', 'node.exe'),
  );
});


test('packaged PostgreSQL, cache and Prisma resources resolve under application resources', () => {
  const root = path.resolve('/bundle/resources');
  const value = resolvePackagedDataResources(root, 'darwin');

  assert.equal(
    value.postgres.postgresExecutablePath,
    path.join(root, 'runtime', 'postgres', 'bin', 'postgres'),
  );
  assert.equal(
    value.postgres.initdbExecutablePath,
    path.join(root, 'runtime', 'postgres', 'bin', 'initdb'),
  );
  assert.equal(value.cache.provider, 'valkey');
  assert.equal(
    value.cache.executablePath,
    path.join(root, 'runtime', 'redis', 'redis-server'),
  );
  assert.equal(
    value.prisma.migrationRuntimeTemplateRoot,
    path.join(root, 'runtime', 'prisma-migrate'),
  );
  assert.equal(
    value.prisma.schemaPath,
    path.join(root, 'backend', 'prisma', 'schema.prisma'),
  );
});

test('packaged data executables use .exe on Windows', () => {
  const root = path.resolve('C:/bundle/resources');
  const value = resolvePackagedDataResources(root, 'win32');

  assert.ok(value.postgres.postgresExecutablePath.endsWith('postgres.exe'));
  assert.ok(value.postgres.pgCtlExecutablePath.endsWith('pg_ctl.exe'));
  assert.equal(value.cache.provider, 'garnet');
  assert.ok(value.cache.executablePath.endsWith('GarnetServer.exe'));
  assert.ok(value.cache.executablePath.includes(path.join('runtime', 'cache')));
});
