const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const {
  buildPostgresDatabaseUrl,
  buildRedisConfig,
  ManagedPostgresProcess,
  preparePrismaMigrationRuntime,
  PrismaMigrationRunner,
} = require('../dist/main/runtime');

test('PostgreSQL DATABASE_URL is loopback-scoped and safely encoded', () => {
  const value = buildPostgresDatabaseUrl({
    host: '127.0.0.1',
    port: 45432,
    username: 'seekmore',
    password: 'secret:/?#[]@',
    databaseName: 'seekmore',
  });

  assert.equal(
    value,
    'postgresql://seekmore:secret%3A%2F%3F%23%5B%5D%40@127.0.0.1:45432/seekmore?schema=public',
  );
});

test('Redis runtime config binds only to loopback and enables durable AOF', () => {
  const config = buildRedisConfig({
    host: '127.0.0.1',
    port: 46379,
    password: 'redis "secret"',
    dataRoot: path.join(os.tmpdir(), 'seekmore redis data'),
  });

  assert.match(config, /^bind 127\.0\.0\.1$/m);
  assert.match(config, /^protected-mode yes$/m);
  assert.match(config, /^appendonly yes$/m);
  assert.match(config, /^appendfsync everysec$/m);
  assert.match(config, /^save ""$/m);
  assert.match(config, /^requirepass "redis \\"secret\\""$/m);
  assert.equal(config.includes('0.0.0.0'), false);
});

test('PostgreSQL refuses to initialize a non-empty data directory without PG_VERSION', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seekmore-postgres-contract-'));
  try {
    const bin = path.join(root, 'bin');
    const dataRoot = path.join(root, 'pgdata');
    await fs.mkdir(bin, { recursive: true });
    await fs.mkdir(dataRoot, { recursive: true });
    await fs.writeFile(path.join(dataRoot, 'unexpected.bin'), 'existing-user-data');

    const tool = async (name) => {
      const file = path.join(bin, name);
      await fs.writeFile(file, 'placeholder');
      return file;
    };

    const processManager = new ManagedPostgresProcess({
      postgresExecutablePath: await tool('postgres'),
      initdbExecutablePath: await tool('initdb'),
      pgIsReadyExecutablePath: await tool('pg_isready'),
      pgCtlExecutablePath: await tool('pg_ctl'),
      psqlExecutablePath: await tool('psql'),
      createdbExecutablePath: await tool('createdb'),
      dataRoot,
      host: '127.0.0.1',
      port: 45432,
      username: 'seekmore',
      databaseName: 'seekmore',
      password: 'postgres-secret',
      logPath: path.join(root, 'postgres.log'),
    });

    await assert.rejects(
      () => processManager.start(),
      /Refusing to initialize non-empty PostgreSQL data directory without PG_VERSION/,
    );
    assert.equal(
      await fs.readFile(path.join(dataRoot, 'unexpected.bin'), 'utf8'),
      'existing-user-data',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Migration runner refuses packaged bootstrap when no migration.sql exists', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seekmore-migration-contract-'));
  try {
    const prismaCli = path.join(root, 'prisma.js');
    const schema = path.join(root, 'schema.prisma');
    const migrations = path.join(root, 'migrations');
    await fs.writeFile(prismaCli, '');
    await fs.writeFile(schema, '');
    await fs.mkdir(migrations);

    const runner = new PrismaMigrationRunner({
      nodeExecutablePath: process.execPath,
      prismaCliEntryPath: prismaCli,
      workingDirectory: root,
      schemaPath: schema,
      migrationsRoot: migrations,
      databaseUrl: 'postgresql://seekmore@127.0.0.1:45432/seekmore',
      logPath: path.join(root, 'migration.log'),
    });

    await assert.rejects(
      () => runner.run(),
      /No Prisma migration\.sql was found/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});



test('Migration runner invokes writable Prisma migrate deploy with the managed DATABASE_URL', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seekmore-migration-runner-'));
  try {
    const prismaCli = path.join(root, 'prisma.js');
    const schema = path.join(root, 'schema.prisma');
    const migrations = path.join(root, 'migrations');
    const migration = path.join(migrations, '20260812000000_test');
    const capture = path.join(root, 'capture.json');
    await fs.mkdir(migration, { recursive: true });
    await fs.writeFile(path.join(migration, 'migration.sql'), 'SELECT 1;');
    await fs.writeFile(schema, 'generator client { provider = "prisma-client-js" }');
    await fs.writeFile(
      prismaCli,
      [
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.env.SEEKMORE_TEST_CAPTURE, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2), databaseUrl: process.env.DATABASE_URL }));",
      ].join('\n'),
    );

    const databaseUrl = 'postgresql://seekmore:secret@127.0.0.1:45432/seekmore?schema=public';
    const previousCapture = process.env.SEEKMORE_TEST_CAPTURE;
    process.env.SEEKMORE_TEST_CAPTURE = capture;
    try {
      await new PrismaMigrationRunner({
        nodeExecutablePath: process.execPath,
        prismaCliEntryPath: prismaCli,
        workingDirectory: root,
        schemaPath: schema,
        migrationsRoot: migrations,
        databaseUrl,
        logPath: path.join(root, 'migration.log'),
      }).run();
    } finally {
      if (previousCapture === undefined) delete process.env.SEEKMORE_TEST_CAPTURE;
      else process.env.SEEKMORE_TEST_CAPTURE = previousCapture;
    }

    const result = JSON.parse(await fs.readFile(capture, 'utf8'));
    assert.equal(
      result.cwd,
      await canonicalPath(
        root,
      ),
    );
    assert.deepEqual(result.argv, ['migrate', 'deploy', '--schema', schema]);
    assert.equal(result.databaseUrl, databaseUrl);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('repository ships a Prisma migration baseline with pgvector bootstrap', async () => {
  const migrationsRoot = path.resolve(
    __dirname,
    '..',
    '..',
    'backend',
    'prisma',
    'migrations',
  );
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const sqlFiles = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(migrationsRoot, entry.name, 'migration.sql');
    try {
      await fs.access(candidate);
      sqlFiles.push(candidate);
    } catch {
      // Ignore non-migration directories.
    }
  }

  assert.ok(sqlFiles.length >= 1);
  const combined = (await Promise.all(sqlFiles.sort().map((file) => fs.readFile(file, 'utf8')))).join('\n');
  assert.match(combined, /CREATE EXTENSION IF NOT EXISTS vector;/);
  assert.doesNotMatch(combined, /AgentMcpBinding/);
  assert.doesNotMatch(combined, /allowedAgentIds/);

  const backendPackage = JSON.parse(
    await fs.readFile(path.resolve(__dirname, '..', '..', 'backend', 'package.json'), 'utf8'),
  );
  assert.equal(typeof backendPackage.dependencies?.prisma, 'string');
  assert.equal(backendPackage.devDependencies?.prisma, undefined);
});

test('Prisma migration runtime is copied outside application resources before execution', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seekmore-prisma-runtime-'));
  try {
    const resourcesRoot = path.join(root, 'application', 'resources');
    const templateRoot = path.join(resourcesRoot, 'runtime', 'prisma-migrate');
    const runtimeRoot = path.join(root, 'user-data', 'runtime', 'prisma-migrate');
    const prismaCli = path.join(templateRoot, 'node_modules', 'prisma', 'build', 'index.js');
    const schema = path.join(resourcesRoot, 'backend', 'prisma', 'schema.prisma');
    const migrations = path.join(resourcesRoot, 'backend', 'prisma', 'migrations');
    const migration = path.join(migrations, '20260813000000_test');
    const capture = path.join(root, 'capture.json');
    const nativeRelativePath = [
      'node_modules',
      'prisma',
      'node_modules',
      '@prisma',
      'engines',
      'schema-engine-test',
    ].join('/');
    const payloadRelativePath = `payloads/${nativeRelativePath}.gz`;
    const nativeBytes = Buffer.from('seekmore-prisma-native-engine');
    const nativeSha256 = crypto
      .createHash('sha256')
      .update(nativeBytes)
      .digest('hex');
    const payloadPath = path.join(
      templateRoot,
      ...payloadRelativePath.split('/'),
    );

    await fs.mkdir(path.dirname(prismaCli), { recursive: true });
    await fs.mkdir(path.dirname(payloadPath), { recursive: true });
    await fs.mkdir(migration, { recursive: true });
    await fs.writeFile(path.join(migration, 'migration.sql'), 'SELECT 1;');
    await fs.writeFile(schema, 'generator client { provider = "prisma-client-js" }');
    await fs.writeFile(
      path.join(templateRoot, 'package.json'),
      JSON.stringify({ private: true, dependencies: { prisma: '6.19.3' } }),
    );
    await fs.writeFile(
      payloadPath,
      zlib.gzipSync(nativeBytes),
    );
    await fs.writeFile(
      path.join(templateRoot, 'runtime-manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        prismaVersion: '6.19.3',
        target: `${process.platform}-${process.arch}`,
        contentHash: 'a'.repeat(64),
        payloads: [
          {
            relativePath: nativeRelativePath,
            payloadPath: payloadRelativePath,
            sha256: nativeSha256,
            mode: 0o755,
          },
        ],
      }),
    );
    await fs.writeFile(
      prismaCli,
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "fs.writeFileSync(path.join(process.cwd(), 'runtime-write.txt'), 'mutable');",
        "fs.writeFileSync(process.env.SEEKMORE_TEST_CAPTURE, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2), databaseUrl: process.env.DATABASE_URL }));",
      ].join('\n'),
    );

    const prepared = await preparePrismaMigrationRuntime({
      templateRoot,
      runtimeRoot,
    });

    assert.ok(isInside(prepared.runtimeRoot, runtimeRoot));
    assert.equal(isInside(prepared.runtimeRoot, resourcesRoot), false);
    assert.equal(
      prepared.prismaCliEntryPath,
      path.join(prepared.runtimeRoot, 'node_modules', 'prisma', 'build', 'index.js'),
    );
    assert.equal(
      await fs.readFile(
        path.join(
          prepared.runtimeRoot,
          ...nativeRelativePath.split('/'),
        ),
        'utf8',
      ),
      nativeBytes.toString('utf8'),
    );
    await assert.rejects(
      () => fs.access(
        path.join(
          templateRoot,
          ...nativeRelativePath.split('/'),
        ),
      ),
      /ENOENT/,
    );

    const previousCapture = process.env.SEEKMORE_TEST_CAPTURE;
    process.env.SEEKMORE_TEST_CAPTURE = capture;
    try {
      await new PrismaMigrationRunner({
        nodeExecutablePath: process.execPath,
        prismaCliEntryPath: prepared.prismaCliEntryPath,
        workingDirectory: prepared.runtimeRoot,
        schemaPath: schema,
        migrationsRoot: migrations,
        databaseUrl: 'postgresql://seekmore:secret@127.0.0.1:45432/seekmore?schema=public',
        logPath: path.join(root, 'migration.log'),
      }).run();
    } finally {
      if (previousCapture === undefined) delete process.env.SEEKMORE_TEST_CAPTURE;
      else process.env.SEEKMORE_TEST_CAPTURE = previousCapture;
    }

    const result = JSON.parse(await fs.readFile(capture, 'utf8'));
    assert.equal(
      result.cwd,
      await canonicalPath(
        prepared.runtimeRoot,
      ),
    );
    assert.deepEqual(result.argv, ['migrate', 'deploy', '--schema', schema]);
    assert.equal(await fs.readFile(path.join(prepared.runtimeRoot, 'runtime-write.txt'), 'utf8'), 'mutable');
    await assert.rejects(
      () => fs.access(path.join(templateRoot, 'runtime-write.txt')),
      /ENOENT/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function canonicalPath(filePath) {
  return await fs.realpath(
    filePath,
  ).catch(
    () => path.resolve(filePath),
  );
}

function isInside(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}