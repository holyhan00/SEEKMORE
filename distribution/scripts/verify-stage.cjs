const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { spawn } = require('node:child_process');

const gunzip = promisify(zlib.gunzip);

const WINDOWS_PRISMA_RUNTIME_APP_RELATIVE_PATH_BUDGET = 170;


async function withProgress(
  label,
  task,
  intervalMs = 10_000,
) {
  const startedAt = Date.now();
  console.log(`[Stage Verify] ${label}...`);

  const timer = setInterval(
    () => {
      const elapsedSeconds = Math.max(
        1,
        Math.round(
          (Date.now() - startedAt) / 1000,
        ),
      );

      console.log(
        `[Stage Verify] ${label} still running (${elapsedSeconds}s)...`,
      );
    },
    intervalMs,
  );

  timer.unref?.();

  try {
    const result = await task();
    const elapsedSeconds = Math.max(
      0,
      Math.round(
        (Date.now() - startedAt) / 1000,
      ),
    );

    console.log(
      `[Stage Verify] ${label} complete (${elapsedSeconds}s).`,
    );

    return result;
  }
  finally {
    clearInterval(timer);
  }
}

const {
  assertPeX64,
  assertTargetEnabled,
  cacheRuntimeForTarget,
  ensureDirectory,
  ensureFile,
  inventory,
  loadRuntimeLock,
  repoRoot,
  stagePaths,
  spawnInvocation,
  targetKey,
} = require('./distribution-lib.cjs');

const {
  RUNTIME_MANIFEST_NAME,
  WINDOWS_BACKEND_EXTERNAL_ROOTS,
  directoryStats,
} = require('./windows/compact-backend.cjs');

const {
  readValidStageVerificationReceipt,
  writeStageVerificationReceipt,
} = require('./windows/verification-receipt.cjs');

async function verifyStage(root, target) {
  const lock = loadRuntimeLock(root);

  assertTargetEnabled(lock, target);
  const cacheState =
    cacheRuntimeForTarget(
      lock,
      target,
    );

  const p = stagePaths(root, target);

  const nodeRuntimeRoot = path.join(
    p.runtimeRoot,
    'node',
  );

  const nodeBinRoot =
    target.startsWith('win32-')
      ? nodeRuntimeRoot
      : path.join(
          nodeRuntimeRoot,
          'bin',
        );

  const nodeExecutablePath =
    target.startsWith('win32-')
      ? path.join(
          nodeBinRoot,
          'node.exe',
        )
      : path.join(
          nodeBinRoot,
          'node',
        );

  const nodeManagedToolPath = (
    name,
  ) =>
    target.startsWith('win32-')
      ? path.join(
          nodeBinRoot,
          `${name}.cmd`,
        )
      : path.join(
          nodeBinRoot,
          name,
        );

  const executable = (name) =>
    target.startsWith('win32-')
      ? `${name}.exe`
      : name;

  const cacheExecutablePath = path.join(
    p.runtimeRoot,
    cacheState.layout,
    cacheState.executable,
  );

  const prismaMigrationRuntimeRoot = path.join(
    p.runtimeRoot,
    'prisma-migrate',
  );

  const requiredFiles = [
    path.join(
      p.appRoot,
      'package.json',
    ),

    path.join(
      p.appRoot,
      'dist',
      'main',
      'index.js',
    ),

    path.join(
      p.appRoot,
      'dist',
      'preload',
      'index.js',
    ),

    path.join(
      p.frontendRoot,
      'dist',
      'index.html',
    ),

    path.join(
      p.backendRoot,
      'dist',
      'src',
      'main.js',
    ),

    ...(target === 'win32-x64'
      ? [path.join(
          p.backendRoot,
          RUNTIME_MANIFEST_NAME,
        )]
      : []),

    path.join(
      p.backendRoot,
      'prisma',
      'schema.prisma',
    ),

    path.join(
      p.backendRoot,
      'node_modules',
      'prisma',
      'build',
      'index.js',
    ),

    path.join(
      prismaMigrationRuntimeRoot,
      'runtime-manifest.json',
    ),

    path.join(
      prismaMigrationRuntimeRoot,
      'package.json',
    ),

    path.join(
      prismaMigrationRuntimeRoot,
      'node_modules',
      'prisma',
      'build',
      'index.js',
    ),

    path.join(
      prismaMigrationRuntimeRoot,
      'node_modules',
      ...(target === 'win32-x64'
        ? ['@prisma', 'engines']
        : ['prisma', 'node_modules', '@prisma', 'engines']),
      'package.json',
    ),

    nodeExecutablePath,

    nodeManagedToolPath(
      'npm',
    ),

    nodeManagedToolPath(
      'npx',
    ),

    nodeManagedToolPath(
      'corepack',
    ),

    path.join(
      p.runtimeRoot,
      'postgres',
      'bin',
      executable('postgres'),
    ),

    path.join(
      p.runtimeRoot,
      'postgres',
      'bin',
      executable('initdb'),
    ),

    path.join(
      p.runtimeRoot,
      'postgres',
      'bin',
      executable('pg_isready'),
    ),

    path.join(
      p.runtimeRoot,
      'postgres',
      'bin',
      executable('pg_ctl'),
    ),

    path.join(
      p.runtimeRoot,
      'postgres',
      'bin',
      executable('psql'),
    ),

    path.join(
      p.runtimeRoot,
      'postgres',
      'bin',
      executable('createdb'),
    ),

    cacheExecutablePath,

    path.join(
      p.runtimeRoot,
      'postgres',
      'share',
      'extension',
      'vector.control',
    ),

    path.join(
      p.audioRoot,
      'reminder.wav',
    ),

    path.join(
      p.licensesRoot,
      'RUNTIME-NOTICES.json',
    ),

    path.join(
      p.licensesRoot,
      'RUNTIME-VENDOR-MANIFEST.json',
    ),

    path.join(
      p.licensesRoot,
      'backend-node-modules.json',
    ),

    path.join(
      p.licensesRoot,
      'desktop-node-modules.json',
    ),

    path.join(
      p.licensesRoot,
      'frontend-node-modules.json',
    ),

    path.join(
      p.licensesRoot,
      'runtime',
      'node.txt',
    ),

    path.join(
      p.licensesRoot,
      'runtime',
      'postgresql.txt',
    ),

    path.join(
      p.licensesRoot,
      'runtime',
      'pgvector.txt',
    ),

    path.join(
      p.licensesRoot,
      'runtime',
      cacheState.provider === 'Valkey'
        ? 'valkey.txt'
        : 'garnet.txt',
    ),

    path.join(
      p.packagingRoot,
      'app-icons',
      'mac',
      'SEEKMORE.png',
    ),

    path.join(
      p.packagingRoot,
      'app-icons',
      'win',
      'SEEKMORE.png',
    ),

    path.join(
      p.packagingRoot,
      'branding',
      'logo',
      'SEEKMORE.png',
    ),

    p.manifestPath,
  ];

  for (const file of requiredFiles) {
    await ensureFile(
      file,
      'stage contract file',
    );
  }

  for (const forbidden of [
    path.join(
      p.appRoot,
      'src',
    ),
    path.join(
      p.appRoot,
      'test',
    ),
    path.join(
      p.backendRoot,
      'src',
    ),
    path.join(
      p.backendRoot,
      'test',
    ),
  ]) {
    if (
      await exists(forbidden)
    ) {
      throw new Error(
        `[Stage Verify] Development source/test directory leaked into stage: ${forbidden}`,
      );
    }
  }

  await ensureDirectory(
    path.join(
      p.backendRoot,
      'prisma',
      'migrations',
    ),
    'Prisma migration history',
  );

  const migrations =
    await fsp.readdir(
      path.join(
        p.backendRoot,
        'prisma',
        'migrations',
      ),
      {
        withFileTypes: true,
      },
    );

  if (
    !migrations.some(
      (entry) =>
        entry.isDirectory(),
    )
  ) {
    throw new Error(
      '[Stage Verify] Staged backend has no Prisma migration directories.',
    );
  }

  await withProgress(
    'Verifying Prisma migration runtime template',
    () => assertPrismaMigrationRuntimeTemplate(
      prismaMigrationRuntimeRoot,
      p.backendRoot,
      target,
    ),
  );

  const appPackage =
    JSON.parse(
      await fsp.readFile(
        path.join(
          p.appRoot,
          'package.json',
        ),
        'utf8',
      ),
    );

  const rootPackage =
    JSON.parse(
      await fsp.readFile(
        path.join(
          root,
          'package.json',
        ),
        'utf8',
      ),
    );

  if (
    appPackage.version
    !== rootPackage.version
  ) {
    throw new Error(
      `[Stage Verify] Stage app version ${appPackage.version} does not match release version ${rootPackage.version}.`,
    );
  }

  if (
    appPackage.productName
    !== 'SEEKMORE'
  ) {
    throw new Error(
      '[Stage Verify] Stage app productName must be SEEKMORE.',
    );
  }

  const manifest =
    JSON.parse(
      await fsp.readFile(
        p.manifestPath,
        'utf8',
      ),
    );

  await withProgress(
    'Verifying complete stage inventory and SHA256 manifest',
    () => assertStageManifestIntegrity(
      p.stageRoot,
      manifest,
    ),
  );

  if (
    manifest.product !== 'SEEKMORE'
    || manifest.version
      !== rootPackage.version
  ) {
    throw new Error(
      '[Stage Verify] Stage manifest identity does not match the release package.',
    );
  }

  if (
    manifest.target !== target
  ) {
    throw new Error(
      `[Stage Verify] Stage manifest target ${manifest.target} does not match ${target}.`,
    );
  }

  const expectedRuntime = {
    node:
      lock.node.version,

    postgresql:
      lock.postgresql.version,

    pgvector:
      lock.pgvector.version,

    cacheProvider:
      cacheState.provider,

    cacheVersion:
      cacheState.version,

  };

  for (
    const [key, expected]
    of Object.entries(
      expectedRuntime,
    )
  ) {
    if (
      manifest.runtimeLock?.[key]
      !== expected
    ) {
      throw new Error(
        `[Stage Verify] Stage manifest runtime ${key} does not match runtime lock.`,
      );
    }
  }

  if (target === 'win32-x64') {
    await withProgress(
      'Verifying Windows Backend production compaction',
      () => assertWindowsBackendCompaction(
        root,
        p.backendRoot,
      ),
    );
  }

  // verify-stage is intentionally native-target. Cross-target assembly must run on
  // the target CI runner because Node/PostgreSQL/cache runtime and native npm packages are
  // architecture-specific.
  if (
    target === targetKey()
  ) {
    await assertVersion(
      nodeExecutablePath,
      ['--version'],
      `v${lock.node.version}`,
      'Node',
    );

    const managedNodePath = [
      nodeBinRoot,
      String(
        process.env.PATH
        ?? process.env.Path
        ?? '',
      ),
    ]
      .filter(Boolean)
      .join(path.delimiter);

    const managedNodeEnvironment = {
      ...process.env,
      PATH: managedNodePath,
      ...(process.platform === 'win32'
        ? {
            Path: managedNodePath,
          }
        : {}),
    };

    await assertRunnable(
      nodeManagedToolPath(
        'npm',
      ),
      ['--version'],
      'npm',
      {
        env: managedNodeEnvironment,
      },
    );

    await assertRunnable(
      nodeManagedToolPath(
        'npx',
      ),
      ['--version'],
      'npx',
      {
        env: managedNodeEnvironment,
      },
    );

    await assertRunnable(
      nodeManagedToolPath(
        'corepack',
      ),
      ['--version'],
      'Corepack',
      {
        env: managedNodeEnvironment,
      },
    );

    await assertVersion(
      path.join(
        p.runtimeRoot,
        'postgres',
        'bin',
        executable('postgres'),
      ),
      ['--version'],
      lock.postgresql.version,
      'PostgreSQL',
    );

    if (target.startsWith('darwin-')) {
      await assertMacPostgresMachORelocatable(
        p,
      );

      await assertMacPostgresVectorSmoke(
        p,
      );
    }

    if (cacheState.provider === 'Valkey') {
      await assertVersion(
        cacheExecutablePath,
        ['--version'],
        cacheState.version,
        cacheState.provider,
      );
    }

    if (target === 'win32-x64') {
      await withProgress(
        'Verifying Windows x64 native payloads',
        () => assertWindowsPeContract(
          p,
          nodeExecutablePath,
          cacheExecutablePath,
        ),
      );

      await withProgress(
        'Running bundled PostgreSQL + pgvector smoke test',
        () => assertWindowsPostgresVectorSmoke(
          p,
        ),
      );

      await withProgress(
        'Running bundled Garnet cache smoke test',
        () => assertWindowsCacheSmoke(
          cacheExecutablePath,
        ),
      );
    }

    await withProgress(
      'Verifying Backend production modules',
      () => assertBackendProductionModules(
        nodeExecutablePath,
        p.backendRoot,
      ),
    );
  }

  if (target === 'win32-x64') {
    await writeStageVerificationReceipt(
      root,
      target,
    );
    console.log('[Stage Verify] Wrote verified Stage receipt.');
  }

  return p;
}

async function ensureVerifiedStage(root, target) {
  if (target === 'win32-x64') {
    const receipt = await readValidStageVerificationReceipt(
      root,
      target,
    );
    if (receipt) {
      console.log('[Stage Verify] Reusing verified Stage receipt; skipping duplicate full Stage SHA256 verification.');
      return stagePaths(root, target);
    }
  }

  return verifyStage(root, target);
}

async function assertWindowsBackendCompaction(
  root,
  backendRoot,
) {
  const manifestPath = path.join(
    backendRoot,
    RUNTIME_MANIFEST_NAME,
  );
  const manifest = JSON.parse(
    await fsp.readFile(manifestPath, 'utf8'),
  );

  const rootPackage = JSON.parse(
    await fsp.readFile(
      path.join(root, 'package.json'),
      'utf8',
    ),
  );

  if (
    manifest.schemaVersion !== 1
    || manifest.platform !== 'win32'
    || manifest.arch !== 'x64'
    || manifest.bundler?.name !== 'esbuild'
    || manifest.bundler?.version !== rootPackage.devDependencies?.esbuild
    || manifest.bundler?.target !== 'node24'
    || manifest.bundler?.format !== 'cjs'
    || manifest.entry !== 'dist/src/main.js'
  ) {
    throw new Error(
      '[Stage Verify] Windows Backend production runtime manifest identity is invalid.',
    );
  }

  const actualExternalRoots = Array.isArray(manifest.externalRoots)
    ? [...manifest.externalRoots].sort()
    : [];
  const expectedExternalRoots = [...WINDOWS_BACKEND_EXTERNAL_ROOTS].sort();
  if (
    JSON.stringify(actualExternalRoots)
    !== JSON.stringify(expectedExternalRoots)
  ) {
    throw new Error(
      '[Stage Verify] Windows Backend external runtime roots do not match the release compaction contract.',
    );
  }

  const beforeFiles = Number(manifest.nodeModulesBefore?.fileCount);
  const afterFiles = Number(manifest.nodeModulesAfter?.fileCount);
  const beforeBytes = Number(manifest.nodeModulesBefore?.bytes);
  const afterBytes = Number(manifest.nodeModulesAfter?.bytes);
  const reducedFiles = Number(manifest.reduction?.fileCount);
  const reducedBytes = Number(manifest.reduction?.bytes);
  const reductionPercent = Number(manifest.reduction?.filePercent);
  const byteReductionPercent = Number(manifest.reduction?.bytePercent);
  const expectedReducedFiles = beforeFiles - afterFiles;
  const expectedReducedBytes = beforeBytes - afterBytes;
  const expectedFilePercent = beforeFiles > 0
    ? Number(((expectedReducedFiles / beforeFiles) * 100).toFixed(2))
    : 0;
  const expectedBytePercent = beforeBytes > 0
    ? Number(((expectedReducedBytes / beforeBytes) * 100).toFixed(2))
    : 0;

  if (
    !Number.isInteger(beforeFiles)
    || !Number.isInteger(afterFiles)
    || !Number.isInteger(beforeBytes)
    || !Number.isInteger(afterBytes)
    || beforeFiles <= 0
    || afterFiles <= 0
    || beforeBytes <= 0
    || afterBytes <= 0
    || afterFiles >= beforeFiles
    || afterBytes >= beforeBytes
    || !Number.isInteger(reducedFiles)
    || !Number.isInteger(reducedBytes)
    || reducedFiles !== expectedReducedFiles
    || reducedBytes !== expectedReducedBytes
    || !Number.isFinite(reductionPercent)
    || !Number.isFinite(byteReductionPercent)
    || reductionPercent !== expectedFilePercent
    || byteReductionPercent !== expectedBytePercent
  ) {
    throw new Error(
      `[Stage Verify] Windows Backend compaction metrics are invalid or inconsistent: files=${String(beforeFiles)}->${String(afterFiles)} (${String(reductionPercent)}%), bytes=${String(beforeBytes)}->${String(afterBytes)} (${String(byteReductionPercent)}%).`,
    );
  }

  const entryPath = path.join(
    backendRoot,
    ...String(manifest.entry).split('/'),
  );
  const entryHash = crypto
    .createHash('sha256')
    .update(await fsp.readFile(entryPath))
    .digest('hex');
  if (entryHash !== manifest.entrySha256) {
    throw new Error(
      '[Stage Verify] Compacted Windows Backend entry does not match backend-runtime-manifest.json.',
    );
  }

  const externalPackages = Array.isArray(manifest.externalPackages)
    ? manifest.externalPackages
    : [];
  for (const rootName of WINDOWS_BACKEND_EXTERNAL_ROOTS) {
    if (!externalPackages.some((entry) => entry?.name === rootName)) {
      throw new Error(
        `[Stage Verify] Compacted Windows Backend is missing external root ${rootName}.`,
      );
    }
  }

  for (const entry of externalPackages) {
    if (
      !entry
      || typeof entry.name !== 'string'
      || typeof entry.version !== 'string'
      || !entry.version.trim()
      || typeof entry.path !== 'string'
      || !isSafeRelativeRuntimePath(entry.path)
    ) {
      throw new Error(
        '[Stage Verify] Compacted Windows Backend external package manifest contains an invalid entry.',
      );
    }

    const packageJson = JSON.parse(
      await fsp.readFile(
        path.join(
          backendRoot,
          'node_modules',
          ...entry.path.split('/'),
          'package.json',
        ),
        'utf8',
      ),
    );

    if (
      packageJson.name !== entry.name
      || String(packageJson.version || '') !== entry.version
    ) {
      throw new Error(
        `[Stage Verify] Compacted Windows Backend external package identity mismatch for ${entry.path}.`,
      );
    }
  }

  await ensureFile(
    path.join(
      backendRoot,
      'node_modules',
      '.prisma',
      'client',
      'package.json',
    ),
    'generated Prisma client package',
  );

  const actualStats = await directoryStats(
    path.join(backendRoot, 'node_modules'),
  );
  if (
    actualStats.fileCount !== afterFiles
    || actualStats.bytes !== Number(manifest.nodeModulesAfter?.bytes)
  ) {
    throw new Error(
      '[Stage Verify] Compacted Windows Backend node_modules changed after runtime manifest creation.',
    );
  }
}

async function assertPrismaMigrationRuntimeTemplate(
  templateRoot,
  backendRoot,
  target,
) {
  const manifestPath = path.join(
    templateRoot,
    'runtime-manifest.json',
  );

  const manifest = JSON.parse(
    await fsp.readFile(
      manifestPath,
      'utf8',
    ),
  );

  if (
    manifest.schemaVersion !== 1
    || !String(manifest.prismaVersion || '').trim()
    || manifest.target !== target
    || !/^[a-f0-9]{64}$/.test(
      String(manifest.contentHash || ''),
    )
    || !Array.isArray(manifest.payloads)
    || manifest.payloads.length === 0
  ) {
    throw new Error(
      '[Stage Verify] Prisma migration runtime manifest is invalid.',
    );
  }

  const backendPrismaPackage = JSON.parse(
    await fsp.readFile(
      path.join(
        backendRoot,
        'node_modules',
        'prisma',
        'package.json',
      ),
      'utf8',
    ),
  );

  const runtimePrismaPackage = JSON.parse(
    await fsp.readFile(
      path.join(
        templateRoot,
        'node_modules',
        'prisma',
        'package.json',
      ),
      'utf8',
    ),
  );

  const runtimePackage = JSON.parse(
    await fsp.readFile(
      path.join(
        templateRoot,
        'package.json',
      ),
      'utf8',
    ),
  );

  for (const value of [
    backendPrismaPackage.version,
    runtimePrismaPackage.version,
    runtimePackage.dependencies?.prisma,
  ]) {
    if (value !== manifest.prismaVersion) {
      throw new Error(
        '[Stage Verify] Prisma migration runtime version does not match staged Backend Prisma.',
      );
    }
  }

  for (const payload of manifest.payloads) {
    if (
      !isSafeRelativeRuntimePath(
        payload.relativePath,
      )
      || !isSafeRelativeRuntimePath(
        payload.payloadPath,
      )
      || !/^[a-f0-9]{64}$/.test(
        String(payload.sha256 || ''),
      )
      || !Number.isInteger(
        payload.mode,
      )
      || payload.mode < 0
      || payload.mode > 0o777
    ) {
      throw new Error(
        '[Stage Verify] Prisma migration runtime payload contract is invalid.',
      );
    }

    const payloadPath = path.join(
      templateRoot,
      ...payload.payloadPath.split('/'),
    );

    const materializedPath = path.join(
      templateRoot,
      ...payload.relativePath.split('/'),
    );

    await ensureFile(
      payloadPath,
      'Prisma migration runtime compressed native payload',
    );

    if (await exists(materializedPath)) {
      throw new Error(
        `[Stage Verify] Prisma migration runtime template must not contain live native engine ${payload.relativePath}.`,
      );
    }

    const raw = await gunzip(
      await fsp.readFile(
        payloadPath,
      ),
    );

    const rawHash = crypto
      .createHash('sha256')
      .update(raw)
      .digest('hex');

    if (rawHash !== payload.sha256) {
      throw new Error(
        `[Stage Verify] Prisma migration runtime payload checksum mismatch for ${payload.relativePath}.`,
      );
    }
  }

  if (target === 'win32-x64') {
    await assertWindowsPrismaMigrationRuntimePortability(
      templateRoot,
    );
  }

  const contentInventory = (
    await inventory(
      templateRoot,
    )
  ).filter(
    (entry) =>
      entry.path !== 'runtime-manifest.json',
  );

  const contentHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        contentInventory,
      ),
    )
    .digest('hex');

  if (contentHash !== manifest.contentHash) {
    throw new Error(
      '[Stage Verify] Prisma migration runtime template content hash does not match its manifest.',
    );
  }
}

async function assertWindowsPrismaMigrationRuntimePortability(
  templateRoot,
) {
  await ensureFile(
    path.join(
      templateRoot,
      'node_modules',
      '@prisma',
      'engines',
      'package.json',
    ),
    'Windows hoisted Prisma migration runtime engines package',
  );

  const legacyNestedEngines = path.join(
    templateRoot,
    'node_modules',
    'prisma',
    'node_modules',
    '@prisma',
    'engines',
  );

  if (await exists(legacyNestedEngines)) {
    throw new Error(
      '[Stage Verify] Windows Prisma migration runtime still contains the legacy nested @prisma/engines layout.',
    );
  }

  const entries = await inventory(
    templateRoot,
  );

  for (const entry of entries) {
    if (entry.type === 'symlink') {
      throw new Error(
        `[Stage Verify] Windows Prisma migration runtime must not contain symlinks: ${entry.path}`,
      );
    }

    const appRelativePath = path.win32.join(
      'resources',
      'runtime',
      'prisma-migrate',
      ...String(entry.path).split('/'),
    );

    if (
      appRelativePath.length
      > WINDOWS_PRISMA_RUNTIME_APP_RELATIVE_PATH_BUDGET
    ) {
      throw new Error(
        `[Stage Verify] Windows Prisma migration runtime path exceeds the portability budget (${appRelativePath.length} > ${WINDOWS_PRISMA_RUNTIME_APP_RELATIVE_PATH_BUDGET}): ${appRelativePath}`,
      );
    }
  }
}

async function assertStageManifestIntegrity(
  stageRoot,
  manifest,
) {
  if (
    !Array.isArray(
      manifest.files,
    )
  ) {
    throw new Error(
      '[Stage Verify] Stage manifest files inventory is missing.',
    );
  }

  const actual =
    (
      await inventory(
        stageRoot,
      )
    )
      .filter(
        (entry) =>
          entry.path
          !== 'stage-manifest.json',
      )
      .sort(
        (a, b) =>
          String(
            a.path,
          ).localeCompare(
            String(
              b.path,
            ),
          ),
      );

  const expected = [
    ...manifest.files,
  ].sort(
    (a, b) =>
      String(
        a.path,
      ).localeCompare(
        String(
          b.path,
        ),
      ),
  );

  if (
    actual.length
    !== expected.length
  ) {
    throw new Error(
      `[Stage Verify] Stage manifest inventory count mismatch: manifest=${expected.length}, actual=${actual.length}.`,
    );
  }

  for (
    let i = 0;
    i < actual.length;
    i += 1
  ) {
    const left =
      actual[i];

    const right =
      expected[i];

    if (
      left.path
        !== right.path
      || left.type
        !== right.type
      || left.target
        !== right.target
      || left.size
        !== right.size
      || left.sha256
        !== right.sha256
    ) {
      throw new Error(
        `[Stage Verify] Stage manifest integrity mismatch for ${
          left.path
          || right.path
        }: `
        + `expected type=${String(
          right.type,
        )} target=${String(
          right.target || '',
        )} `
        + `size=${String(
          right.size,
        )} sha256=${String(
          right.sha256,
        )}, `
        + `actual type=${String(
          left.type,
        )} target=${String(
          left.target || '',
        )} `
        + `size=${String(
          left.size,
        )} sha256=${String(
          left.sha256,
        )}.`,
      );
    }
  }
}

async function assertBackendProductionModules(
  nodeExecutablePath,
  backendRoot,
) {
  const script = [
    "require('sharp');",
    "require('@prisma/client');",
    "require('prisma/package.json');",
    "require('class-transformer');",
    "require('class-validator');",
    "const { ValidationPipe } = require('@nestjs/common');",
    "new ValidationPipe({ transform: true });",
    "const { IoAdapter } = require('@nestjs/platform-socket.io');",
    "if (typeof IoAdapter !== 'function') throw new Error('Nest Socket.IO adapter is unavailable');",
    "require('socket.io');",
    "require('socket.io-parser');",
    "require('engine.io-parser');",
    "require('@socket.io/component-emitter');",
    "process.stdout.write('ok');",
  ].join(' ');

  const output =
    await capture(
      nodeExecutablePath,
      [
        '-e',
        script,
      ],
      {
        cwd: backendRoot,
      },
    );

  if (
    !output.includes('ok')
  ) {
    throw new Error(
      '[Stage Verify] Staged Backend production dependency smoke test failed.',
    );
  }
}

function isSafeRelativeRuntimePath(
  value,
) {
  if (
    typeof value !== 'string'
    || !value.trim()
    || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
  ) {
    return false;
  }

  const segments = value
    .replace(/\\/g, '/')
    .split('/');

  return segments.every(
    (segment) =>
      segment.length > 0
      && segment !== '.'
      && segment !== '..',
  );
}

async function exists(
  candidate,
) {
  return Boolean(
    await fsp
      .stat(candidate)
      .catch(() => null),
  );
}

async function assertRunnable(
  command,
  args,
  label,
  options = {},
) {
  const output =
    await capture(
      command,
      args,
      options,
    );

  if (
    !String(output).trim()
  ) {
    throw new Error(
      `[Stage Verify] ${label} did not produce version output.`,
    );
  }
}

async function assertVersion(
  command,
  args,
  expected,
  label,
) {
  const output =
    await capture(
      command,
      args,
    );

  if (
    !output.includes(
      expected,
    )
  ) {
    throw new Error(
      `[Stage Verify] ${label} version output does not contain ${expected}: ${output.trim()}`,
    );
  }
}

async function capture(
  command,
  args,
  options = {},
) {
  const {
    resolveOnExit = false,
    timeoutMs = 0,
    ...spawnOptions
  } = options;

  return new Promise(
    (resolve, reject) => {
      const invocation =
        spawnInvocation(
          command,
          args,
        );

      const child =
        spawn(
          invocation.command,
          invocation.args,
          {
            stdio: [
              'ignore',
              'pipe',
              'pipe',
            ],
            shell: false,
            windowsHide: true,
            ...spawnOptions,
          },
        );

      let output = '';
      let settled = false;
      let timer = null;

      const finish = (code) => {
        if (settled) return;
        settled = true;

        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        if (code === 0) {
          resolve(output);
          return;
        }

        const diagnostics = output.trim();

        reject(
          new Error(
            `[Stage Verify] Command failed (${code}): ${command} ${args.join(
              ' ',
            )}`
            + (diagnostics
              ? `\n[Stage Verify] Command output:\n${diagnostics}`
              : ''),
          ),
        );
      };

      child.stdout.on(
        'data',
        (chunk) => {
          output += String(chunk);
        },
      );

      child.stderr.on(
        'data',
        (chunk) => {
          output += String(chunk);
        },
      );

      child.once(
        'error',
        (error) => {
          if (settled) return;
          settled = true;

          if (timer) {
            clearTimeout(timer);
            timer = null;
          }

          reject(error);
        },
      );

      child.once(
        resolveOnExit ? 'exit' : 'close',
        finish,
      );

      if (timeoutMs > 0) {
        timer = setTimeout(
          () => {
            if (settled) return;
            settled = true;

            try {
              child.kill();
            }
            catch {
              // Best-effort cleanup only.
            }

            const diagnostics = output.trim();

            reject(
              new Error(
                `[Stage Verify] Command timed out after ${timeoutMs}ms: ${command} ${args.join(
                  ' ',
                )}`
                + (diagnostics
                  ? `\n[Stage Verify] Command output:\n${diagnostics}`
                  : ''),
              ),
            );
          },
          timeoutMs,
        );
        timer.unref?.();
      }
    },
  );
}

function parseOtoolDependencies(output) {
  return String(output)
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const match = line.match(
        /^\s*(.+?)\s+\(compatibility version\s+/,
      );

      return match?.[1]?.trim() || '';
    })
    .filter(Boolean);
}

function parseOtoolInstallId(output) {
  return String(output)
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .find(Boolean) || '';
}

function parseOtoolRpaths(output) {
  const lines = String(output)
    .split(/\r?\n/);

  const values = [];
  let inRpath = false;

  for (const line of lines) {
    if (/^\s*cmd\s+LC_RPATH\s*$/.test(line)) {
      inRpath = true;
      continue;
    }

    if (!inRpath) continue;

    const match = line.match(
      /^\s*path\s+(.+?)\s+\(offset\s+\d+\)\s*$/,
    );

    if (match) {
      values.push(match[1].trim());
      inRpath = false;
    }
  }

  return values;
}

function isPortableMacDynamicPath(value) {
  if (!value) return true;

  if (
    value === '@loader_path'
    || value.startsWith('@loader_path/')
    || value === '@executable_path'
    || value.startsWith('@executable_path/')
    || value === '@rpath'
    || value.startsWith('@rpath/')
  ) {
    return true;
  }

  if (
    value.startsWith('/usr/lib/')
    || value.startsWith('/System/Library/')
  ) {
    return true;
  }

  return !path.isAbsolute(value);
}

async function assertMacPostgresMachORelocatable(p) {
  const postgresRoot = path.join(
    p.runtimeRoot,
    'postgres',
  );

  const entries = await inventory(
    postgresRoot,
  );

  const failures = [];

  for (const entry of entries) {
    if (entry.type !== 'file') continue;

    const absolute = path.join(
      postgresRoot,
      ...entry.path.split('/'),
    );

    const fileOutput = await capture(
      'file',
      [absolute],
    );

    if (!fileOutput.includes('Mach-O')) {
      continue;
    }

    const dependencies =
      parseOtoolDependencies(
        await capture(
          'otool',
          ['-L', absolute],
        ),
      );

    for (const dependency of dependencies) {
      if (!isPortableMacDynamicPath(dependency)) {
        failures.push(
          `${entry.path}: dependency ${dependency}`,
        );
      }
    }

    const rpaths = parseOtoolRpaths(
      await capture(
        'otool',
        ['-l', absolute],
      ),
    );

    for (const rpathValue of rpaths) {
      if (!isPortableMacDynamicPath(rpathValue)) {
        failures.push(
          `${entry.path}: rpath ${rpathValue}`,
        );
      }
    }

    if (/\.dylib$/i.test(entry.path)) {
      const installId =
        parseOtoolInstallId(
          await capture(
            'otool',
            ['-D', absolute],
          ).catch(() => ''),
        );

      if (
        installId
        && !isPortableMacDynamicPath(
          installId,
        )
      ) {
        failures.push(
          `${entry.path}: install id ${installId}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `[Stage Verify] macOS PostgreSQL runtime contains non-relocatable Mach-O paths:\n${failures
        .map((value) => `  - ${value}`)
        .join('\n')}`,
    );
  }
}

async function assertMacPostgresVectorSmoke(p) {
  const os = require('node:os');
  const net = require('node:net');

  const tempRoot = await fsp.mkdtemp(
    path.join(
      os.tmpdir(),
      'seekmore-macos-postgres-relocated-smoke-',
    ),
  );

  const sourcePostgresRoot = path.join(
    p.runtimeRoot,
    'postgres',
  );

  const postgresRoot = path.join(
    tempRoot,
    'postgres',
  );

  const dataRoot = path.join(
    tempRoot,
    'data',
  );

  const logPath = path.join(
    tempRoot,
    'postgres.log',
  );

  const bin = path.join(
    postgresRoot,
    'bin',
  );

  const initdb = path.join(
    bin,
    'initdb',
  );

  const pgCtl = path.join(
    bin,
    'pg_ctl',
  );

  const createdb = path.join(
    bin,
    'createdb',
  );

  const psql = path.join(
    bin,
    'psql',
  );

  const port = await reservePort(net);
  let started = false;

  const smokeEnvironment = {
    ...process.env,
    PATH: '/usr/bin:/bin',
  };

  delete smokeEnvironment.DYLD_LIBRARY_PATH;
  delete smokeEnvironment.DYLD_FALLBACK_LIBRARY_PATH;
  delete smokeEnvironment.DYLD_FRAMEWORK_PATH;
  delete smokeEnvironment.DYLD_FALLBACK_FRAMEWORK_PATH;

  try {
    await fsp.cp(
      sourcePostgresRoot,
      postgresRoot,
      {
        recursive: true,
        preserveTimestamps: true,
      },
    );

    await capture(
      initdb,
      [
        '-D', dataRoot,
        '-U', 'seekmore',
        '--auth-local=trust',
        '--auth-host=trust',
        '--encoding=UTF8',
        '--no-locale',
      ],
      {
        cwd: tempRoot,
        env: smokeEnvironment,
      },
    );

    await capture(
      pgCtl,
      [
        '-D', dataRoot,
        '-l', logPath,
        '-o', `-h 127.0.0.1 -p ${port}`,
        '-w',
        'start',
      ],
      {
        cwd: tempRoot,
        env: smokeEnvironment,
      },
    );

    started = true;

    await capture(
      createdb,
      [
        '-h', '127.0.0.1',
        '-p', String(port),
        '-U', 'seekmore',
        'seekmore_release_smoke',
      ],
      {
        cwd: tempRoot,
        env: smokeEnvironment,
      },
    );

    const result = await capture(
      psql,
      [
        '-h', '127.0.0.1',
        '-p', String(port),
        '-U', 'seekmore',
        '-d', 'seekmore_release_smoke',
        '-v', 'ON_ERROR_STOP=1',
        '-A', '-t',
        '-c', "CREATE EXTENSION vector; SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector;",
      ],
      {
        cwd: tempRoot,
        env: smokeEnvironment,
      },
    );

    if (
      !result
        .split(/\r?\n/)
        .some(
          (line) => line.trim() === '1',
        )
    ) {
      throw new Error(
        `[Stage Verify] macOS relocated pgvector SQL smoke test returned unexpected output: ${result.trim()}`,
      );
    }
  } finally {
    if (started) {
      await capture(
        pgCtl,
        [
          '-D', dataRoot,
          '-m', 'fast',
          '-w', 'stop',
        ],
        {
          cwd: tempRoot,
        },
      ).catch(() => undefined);
    }

    await fsp.rm(
      tempRoot,
      {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      },
    ).catch(() => undefined);
  }
}

async function assertWindowsPeContract(
  p,
  nodeExecutablePath,
  cacheExecutablePath,
) {
  const binaries = [
    [nodeExecutablePath, 'bundled Node'],
    [path.join(p.runtimeRoot, 'postgres', 'bin', 'postgres.exe'), 'PostgreSQL postgres'],
    [path.join(p.runtimeRoot, 'postgres', 'bin', 'initdb.exe'), 'PostgreSQL initdb'],
    [path.join(p.runtimeRoot, 'postgres', 'bin', 'pg_ctl.exe'), 'PostgreSQL pg_ctl'],
    [path.join(p.runtimeRoot, 'postgres', 'bin', 'psql.exe'), 'PostgreSQL psql'],
    [path.join(p.runtimeRoot, 'postgres', 'bin', 'createdb.exe'), 'PostgreSQL createdb'],
    [path.join(p.runtimeRoot, 'postgres', 'lib', 'vector.dll'), 'pgvector vector.dll'],
    [cacheExecutablePath, 'cache runtime'],
  ];

  for (const [file, label] of binaries) {
    await ensureFile(file, label);
    assertPeX64(file, label);
  }

  const prismaRuntimeRoot = path.join(
    p.runtimeRoot,
    'prisma-migrate',
  );

  const files = await inventory(prismaRuntimeRoot);
  for (const entry of files) {
    if (
      entry.type === 'file'
      && /(?:\.exe|\.dll|\.node)$/i.test(entry.path)
    ) {
      const absolute = path.join(
        prismaRuntimeRoot,
        ...entry.path.split('/'),
      );
      const header = await fsp.readFile(absolute).catch(() => null);
      if (header?.length >= 2 && header[0] === 0x4d && header[1] === 0x5a) {
        assertPeX64(absolute, `Prisma native payload ${entry.path}`);
      }
    }
  }
}

async function readWindowsPostgresMasterPid(
  dataRoot,
) {
  const pidPath = path.join(
    dataRoot,
    'postmaster.pid',
  );

  const contents = await fsp
    .readFile(
      pidPath,
      'utf8',
    )
    .catch(() => '');

  const firstLine = String(contents)
    .split(/\r?\n/, 1)[0]
    ?.trim();

  if (!firstLine || !/^\d+$/.test(firstLine)) {
    return null;
  }

  const pid = Number(firstLine);

  return Number.isInteger(pid) && pid > 0
    ? pid
    : null;
}

function isProcessAlive(
  pid,
) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') {
      return false;
    }

    // Treat access-denied/unknown results as still alive. The verifier
    // must never claim cleanup completed while the process state is unclear.
    return true;
  }
}

async function waitForProcessExit(
  pid,
  timeoutMs,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }

    await delay(100);
  }

  return !isProcessAlive(pid);
}

async function forceKillWindowsProcessTree(
  pid,
) {
  await capture(
    'taskkill.exe',
    [
      '/PID',
      String(pid),
      '/T',
      '/F',
    ],
    {
      timeoutMs: 15_000,
    },
  );
}

async function assertWindowsPostgresVectorSmoke(p) {
  const os = require('node:os');
  const net = require('node:net');
  const tempRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'seekmore-postgres-vector-smoke-'),
  );
  const dataRoot = path.join(tempRoot, 'data');
  const logPath = path.join(tempRoot, 'postgres.log');
  const bin = path.join(p.runtimeRoot, 'postgres', 'bin');
  const initdb = path.join(bin, 'initdb.exe');
  const pgCtl = path.join(bin, 'pg_ctl.exe');
  const createdb = path.join(bin, 'createdb.exe');
  const psql = path.join(bin, 'psql.exe');
  const port = await reservePort(net);
  let serverStarted = false;
  let postmasterPid = null;
  let primaryError = null;

  try {
    console.log('[Stage Verify] PostgreSQL smoke: initializing temporary cluster...');

    await capture(
      initdb,
      [
        '-D', dataRoot,
        '-U', 'seekmore',
        '--auth-local=trust',
        '--auth-host=trust',
        '--encoding=UTF8',
        '--no-locale',
      ],
      {
        timeoutMs: 90_000,
      },
    );

    console.log('[Stage Verify] PostgreSQL smoke: temporary cluster initialized.');
    console.log(`[Stage Verify] PostgreSQL smoke: starting server on 127.0.0.1:${port}...`);

    // On Windows pg_ctl starts a long-lived postgres.exe child. Depending on
    // handle inheritance, that server can keep pg_ctl's stdout/stderr pipes
    // open after pg_ctl itself has exited. Waiting for ChildProcess 'close'
    // would then block forever even though PostgreSQL is already ready.
    // Resolve this specific daemon-launch command on pg_ctl's own 'exit'
    // event, while retaining normal 'close' semantics for ordinary commands.
    await capture(
      pgCtl,
      [
        '-D', dataRoot,
        '-l', logPath,
        '-o', `-h 127.0.0.1 -p ${port}`,
        '-w',
        '-t', '60',
        'start',
      ],
      {
        resolveOnExit: true,
        timeoutMs: 75_000,
      },
    );

    serverStarted = true;
    postmasterPid = await readWindowsPostgresMasterPid(
      dataRoot,
    );

    if (!postmasterPid) {
      throw new Error(
        '[Stage Verify] PostgreSQL smoke started but postmaster.pid did not contain a valid master PID.',
      );
    }

    console.log(`[Stage Verify] PostgreSQL smoke: server ready (PID ${postmasterPid}).`);
    console.log('[Stage Verify] PostgreSQL smoke: creating smoke database...');

    await capture(
      createdb,
      [
        '-h', '127.0.0.1',
        '-p', String(port),
        '-U', 'seekmore',
        'seekmore_release_smoke',
      ],
      {
        timeoutMs: 30_000,
      },
    );

    console.log('[Stage Verify] PostgreSQL smoke: loading pgvector and executing SQL check...');

    const result = await capture(
      psql,
      [
        '-h', '127.0.0.1',
        '-p', String(port),
        '-U', 'seekmore',
        '-d', 'seekmore_release_smoke',
        '-v', 'ON_ERROR_STOP=1',
        '-A', '-t',
        '-c', "CREATE EXTENSION vector; SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector;",
      ],
      {
        timeoutMs: 30_000,
      },
    );

    if (!result.split(/\r?\n/).some((line) => line.trim() === '1')) {
      throw new Error(
        `[Stage Verify] pgvector SQL smoke test returned unexpected output: ${result.trim()}`,
      );
    }

    console.log('[Stage Verify] PostgreSQL smoke: pgvector SQL check passed.');
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors = [];

    const cleanupPid = postmasterPid
      ?? await readWindowsPostgresMasterPid(
        dataRoot,
      );
    const shouldStopServer =
      serverStarted
      || cleanupPid !== null;

    if (shouldStopServer) {
      console.log('[Stage Verify] PostgreSQL smoke: stopping temporary server...');

      try {
        // pg_ctl stop does not launch a long-lived child. Use normal 'close'
        // semantics here so stdout/stderr are fully drained before cleanup.
        await capture(
          pgCtl,
          ['-D', dataRoot, '-m', 'fast', '-w', '-t', '60', 'stop'],
          {
            timeoutMs: 75_000,
          },
        );
      } catch (error) {
        cleanupErrors.push(error);
      }

      if (cleanupPid) {
        const exited = await waitForProcessExit(
          cleanupPid,
          15_000,
        );

        if (!exited) {
          console.warn(
            `[Stage Verify] PostgreSQL smoke: PID ${cleanupPid} remained alive after pg_ctl stop; forcing cleanup of this temporary process tree.`,
          );

          try {
            await forceKillWindowsProcessTree(cleanupPid);
          } catch (error) {
            cleanupErrors.push(error);
          }

          const forcedExit = await waitForProcessExit(
            cleanupPid,
            10_000,
          );

          if (!forcedExit) {
            cleanupErrors.push(
              new Error(
                `[Stage Verify] PostgreSQL smoke process tree remained alive after forced cleanup (PID ${cleanupPid}).`,
              ),
            );
          } else {
            cleanupErrors.push(
              new Error(
                `[Stage Verify] PostgreSQL smoke required forced process-tree cleanup after pg_ctl stop (PID ${cleanupPid}).`,
              ),
            );
          }
        }
      }
    }

    const postgresLog = await fsp
      .readFile(logPath, 'utf8')
      .catch(() => '');

    try {
      await fsp.rm(tempRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    } catch (error) {
      cleanupErrors.push(
        new Error(
          `[Stage Verify] PostgreSQL smoke temporary directory cleanup failed: ${error.message}`,
        ),
      );
    }

    if (cleanupErrors.length > 0) {
      const diagnostics = cleanupErrors
        .map((error) => error.message)
        .join('\n');
      const suffix = postgresLog.trim()
        ? `\n[Stage Verify] PostgreSQL smoke log:\n${postgresLog.trim()}`
        : '';
      const cleanupError = new Error(
        `[Stage Verify] PostgreSQL smoke cleanup failed:\n${diagnostics}${suffix}`,
      );

      if (primaryError) {
        console.warn(cleanupError.message);
      } else {
        throw cleanupError;
      }
    } else if (serverStarted) {
      console.log('[Stage Verify] PostgreSQL smoke: temporary server fully stopped and released.');
    }
  }
}

async function assertWindowsCacheSmoke(cacheExecutablePath) {
  const os = require('node:os');
  const net = require('node:net');
  const tempRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'seekmore-garnet-smoke-'),
  );
  const dataRoot = path.join(tempRoot, 'data');
  const configPath = path.join(tempRoot, 'garnet.conf');
  const password = `seekmore-release-${process.pid}-${Date.now()}`;
  const port = await reservePort(net);
  let child = null;

  const config = {
    Address: '127.0.0.1',
    Port: port,
    AuthenticationMode: 'Password',
    Password: password,
    EnableAOF: true,
    CommitFrequencyMs: 1000,
    WaitForCommit: true,
    Recover: true,
    CheckpointDir: dataRoot,
  };

  await fsp.mkdir(dataRoot, { recursive: true });
  await fsp.writeFile(
    configPath,
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );

  const start = async () => {
    const next = spawn(
      cacheExecutablePath,
      ['--config-import-path', configPath],
      {
        cwd: path.dirname(cacheExecutablePath),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    let diagnostics = '';
    next.stdout?.on('data', (chunk) => { diagnostics += String(chunk); });
    next.stderr?.on('data', (chunk) => { diagnostics += String(chunk); });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (next.exitCode !== null) {
        throw new Error(
          `[Stage Verify] Garnet exited before readiness: ${diagnostics.trim()}`,
        );
      }

      try {
        const pong = await sendResp(
          net,
          port,
          password,
          ['PING'],
        );
        if (pong === 'PONG') return next;
      } catch {
        // Startup race.
      }

      await delay(150);
    }

    next.kill();
    throw new Error('[Stage Verify] Garnet readiness timed out.');
  };

  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once('close', resolve));
    child.kill();
    await Promise.race([exited, delay(5_000)]);
  };

  try {
    child = await start();

    await expectResp(net, port, password, ['SET', 'seekmore:key', 'value'], 'OK');
    await expectResp(net, port, password, ['GET', 'seekmore:key'], 'value');
    await expectResp(net, port, password, ['EXISTS', 'seekmore:key'], 1);
    await expectResp(net, port, password, ['EXPIRE', 'seekmore:key', '60'], 1);

    await expectResp(net, port, password, ['SET', 'seekmore:nx', 'one', 'PX', '10000', 'NX'], 'OK');
    await expectResp(net, port, password, ['SET', 'seekmore:nx', 'two', 'PX', '10000', 'NX'], null);

    await expectResp(net, port, password, ['SADD', 'seekmore:set', 'a', 'b'], 2);
    await expectResp(net, port, password, ['SISMEMBER', 'seekmore:set', 'a'], 1);
    const members = await sendResp(net, port, password, ['SMEMBERS', 'seekmore:set']);
    if (!Array.isArray(members) || members.slice().sort().join(',') !== 'a,b') {
      throw new Error(`[Stage Verify] Garnet SMEMBERS mismatch: ${JSON.stringify(members)}`);
    }
    await expectResp(net, port, password, ['SREM', 'seekmore:set', 'a'], 1);
    await expectResp(net, port, password, ['DEL', 'seekmore:key'], 1);

    await expectResp(net, port, password, ['SET', 'seekmore:persist', 'survives'], 'OK');
    await delay(1250);
    await stop();
    child = null;

    child = await start();
    await expectResp(net, port, password, ['GET', 'seekmore:persist'], 'survives');
  } finally {
    await stop().catch(() => undefined);
    await fsp.rm(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    }).catch(() => undefined);
  }
}

async function expectResp(net, port, password, command, expected) {
  const actual = await sendResp(net, port, password, command);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `[Stage Verify] RESP command ${command[0]} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`,
    );
  }
}

function sendResp(net, port, password, command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let buffer = Buffer.alloc(0);
    let authenticated = false;

    const fail = (error) => {
      socket.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    socket.setTimeout(2_000);
    socket.once('connect', () => {
      socket.write(encodeResp(['AUTH', password]));
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        while (buffer.length > 0) {
          const parsed = parseResp(buffer, 0);
          if (!parsed) return;
          buffer = buffer.subarray(parsed.offset);

          if (!authenticated) {
            if (parsed.value !== 'OK') {
              fail(new Error(`[Stage Verify] Garnet AUTH failed: ${JSON.stringify(parsed.value)}`));
              return;
            }
            authenticated = true;
            socket.write(encodeResp(command));
            continue;
          }

          socket.end();
          resolve(parsed.value);
          return;
        }
      } catch (error) {
        fail(error);
      }
    });
    socket.once('timeout', () => fail(new Error('[Stage Verify] RESP command timed out.')));
    socket.once('error', fail);
  });
}

function encodeResp(parts) {
  return Buffer.from(
    `*${parts.length}\r\n${parts.map((value) => {
      const text = String(value);
      return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
    }).join('')}`,
    'utf8',
  );
}

function parseResp(buffer, offset) {
  if (offset >= buffer.length) return null;
  const marker = String.fromCharCode(buffer[offset]);
  const lineEnd = buffer.indexOf('\r\n', offset + 1, 'utf8');
  if (lineEnd < 0) return null;
  const line = buffer.toString('utf8', offset + 1, lineEnd);
  let next = lineEnd + 2;

  if (marker === '+') return { value: line, offset: next };
  if (marker === '-') throw new Error(`[Stage Verify] RESP error: ${line}`);
  if (marker === ':') return { value: Number(line), offset: next };
  if (marker === '$') {
    const length = Number(line);
    if (length === -1) return { value: null, offset: next };
    if (buffer.length < next + length + 2) return null;
    return {
      value: buffer.toString('utf8', next, next + length),
      offset: next + length + 2,
    };
  }
  if (marker === '*') {
    const count = Number(line);
    if (count === -1) return { value: null, offset: next };
    const values = [];
    for (let index = 0; index < count; index += 1) {
      const parsed = parseResp(buffer, next);
      if (!parsed) return null;
      values.push(parsed.value);
      next = parsed.offset;
    }
    return { value: values, offset: next };
  }

  throw new Error(`[Stage Verify] Unsupported RESP marker: ${marker}`);
}

function reservePort(net) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('[Stage Verify] Failed to reserve loopback port.'));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const root =
    repoRoot(__dirname);

  const target =
    process.env
      .SEEKMORE_RELEASE_TARGET
    || targetKey();

  const p =
    await verifyStage(
      root,
      target,
    );

  console.log(
    `[Stage Verify] Stage contract verified: ${p.stageRoot}`,
  );
}

if (
  require.main === module
) {
  main().catch(
    (error) => {
      console.error(
        error instanceof Error
          ? error.stack
            || error.message
          : error,
      );

      process.exitCode = 1;
    },
  );
}

module.exports = {
  assertStageManifestIntegrity,
  assertWindowsBackendCompaction,
  ensureVerifiedStage,
  assertWindowsPrismaMigrationRuntimePortability,
  isPortableMacDynamicPath,
  parseOtoolDependencies,
  parseOtoolInstallId,
  parseOtoolRpaths,
  verifyStage,
};
