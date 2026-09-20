const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const gzip = promisify(zlib.gzip);

const WINDOWS_PRISMA_RUNTIME_APP_RELATIVE_PATH_BUDGET = 170;

const {
  assertNativeTarget,
  assertReleaseToolchain,
  assertTargetEnabled,
  cacheRuntimeForTarget,
  capture,
  copyTree,
  ensureDirectory,
  ensureFile,
  inventory,
  loadRuntimeLock,
  pnpmCommand,
  repoRoot,
  run,
  stagePaths,
  targetKey,
} = require('./distribution-lib.cjs');

const {
  compactWindowsBackend,
} = require('./windows/compact-backend.cjs');

const {
  invalidateStageVerificationReceipts,
} = require('./windows/verification-receipt.cjs');

async function withStageProgress(
  label,
  work,
  intervalMs = 10_000,
) {
  const startedAt = Date.now();
  console.log(`[Stage] ${label}...`);

  const timer = setInterval(() => {
    const elapsedSeconds = Math.max(
      1,
      Math.round(
        (Date.now() - startedAt)
        / 1_000,
      ),
    );

    console.log(
      `[Stage] ${label} still running (${elapsedSeconds}s)...`,
    );
  }, intervalMs);

  timer.unref?.();

  try {
    const result = await work();
    const elapsedSeconds = Math.max(
      0,
      Math.round(
        (Date.now() - startedAt)
        / 1_000,
      ),
    );

    console.log(
      `[Stage] ${label} complete (${elapsedSeconds}s).`,
    );

    return result;
  } finally {
    clearInterval(timer);
  }
}

function pnpmStageArgs(
  target,
  args,
) {
  return target === 'win32-x64'
    ? [
        '--reporter=append-only',
        ...args,
      ]
    : args;
}

async function main() {
  const root = repoRoot(__dirname);
  const target =
    process.env.SEEKMORE_RELEASE_TARGET || targetKey();

  const lock = loadRuntimeLock(root);

  assertTargetEnabled(lock, target);
  assertNativeTarget(target);

  await assertReleaseToolchain(root);

  const paths = stagePaths(root, target);

  if (target === 'win32-x64') {
    await invalidateStageVerificationReceipts(
      root,
      target,
    );
  }

  const vendorRoot = path.join(
    root,
    'distribution',
    'vendor',
    target,
  );

  const vendorRuntime = path.join(
    vendorRoot,
    'resources',
    'runtime',
  );

  const vendorLicenses = path.join(
    vendorRoot,
    'licenses',
  );

  await ensureDirectory(
    vendorRuntime,
    `verified vendor runtime for ${target}`,
  );

  await assertVendorManifest(
    lock,
    target,
    vendorRoot,
  );

  await Promise.all([
    ensureDirectory(
      path.join(root, 'frontend', 'dist'),
      'frontend build output',
    ),
    ensureDirectory(
      path.join(root, 'backend', 'dist'),
      'backend build output',
    ),
    ensureDirectory(
      path.join(root, 'desktop', 'dist'),
      'desktop build output',
    ),
    ensureFile(
      path.join(
        root,
        'desktop',
        'resources',
        'audio',
        'reminder.wav',
      ),
      'reminder audio resource',
    ),
  ]);

  await fsp.rm(paths.stageRoot, {
    recursive: true,
    force: true,
  });

  await fsp.mkdir(paths.stageRoot, {
    recursive: true,
  });

  const pnpm = pnpmCommand();

  await run(
    pnpm,
    pnpmStageArgs(
      target,
      [
        '--filter=@seekmore/desktop',
        '--prod',
        'deploy',
        '--legacy',
        paths.appRoot,
      ],
    ),
    {
      cwd: root,
      env: process.env,
    },
  );

  await removeDesktopWorkspaceSelfLink(
    paths.appRoot,
  );

  await removeBackendWorkspaceLink(
    paths.appRoot,
  );

  await removeFrontendWorkspaceLink(
    paths.appRoot,
  );

  if (target === 'win32-x64') {
    await removeWindowsLegacyDeployWorkspaceLinks(
      root,
      paths.stageRoot,
      paths.appRoot,
    );
  }

  await run(
    pnpm,
    pnpmStageArgs(
      target,
      [
        ...(target === 'win32-x64'
          ? [
              '--config.node-linker=hoisted',
            ]
          : []),
        '--filter=backend',
        '--prod',
        'deploy',
        '--legacy',
        paths.backendRoot,
      ],
    ),
    {
      cwd: root,
      env: process.env,
    },
  );

  await removeDesktopWorkspaceSelfLink(
    paths.backendRoot,
  );

  await removeBackendWorkspaceLink(
    paths.backendRoot,
  );

  await removeFrontendWorkspaceLink(
    paths.backendRoot,
  );

  if (target === 'win32-x64') {
    await removeWindowsLegacyDeployWorkspaceLinks(
      root,
      paths.stageRoot,
      paths.backendRoot,
    );
  }

  await pruneDeployedPackage(
    paths.appRoot,
    new Set([
      'package.json',
      'dist',
      'node_modules',
    ]),
  );

  await pruneDeployedPackage(
    paths.backendRoot,
    new Set([
      'package.json',
      'dist',
      'node_modules',
      'prisma',
    ]),
  );

  await copyTree(
    path.join(root, 'frontend', 'dist'),
    path.join(paths.frontendRoot, 'dist'),
  );

  await copyTree(
    vendorRuntime,
    paths.runtimeRoot,
  );

  await generateStagedPrismaClient(
    target,
    paths,
  );

  await preparePrismaMigrationRuntimeTemplate(
    target,
    paths,
  );

  if (target === 'win32-x64') {
    // The compaction manifest must describe the final Backend runtime tree.
    // pruneReleaseMetadata(stageRoot) runs again later for the whole Stage,
    // so remove Backend repository metadata before taking compaction stats.
    // The later pass is intentionally retained and becomes idempotent for
    // resources/backend.
    await pruneReleaseMetadata(
      paths.backendRoot,
      'Windows Backend before compaction',
    );

    await withStageProgress(
      'Compacting Windows Backend production runtime',
      () => compactWindowsBackend(
        root,
        paths.backendRoot,
      ),
    );
  }

  await fsp.mkdir(paths.audioRoot, {
    recursive: true,
  });

  await fsp.copyFile(
    path.join(
      root,
      'desktop',
      'resources',
      'audio',
      'reminder.wav',
    ),
    path.join(
      paths.audioRoot,
      'reminder.wav',
    ),
  );

  await copyTree(
    path.join(
      root,
      'assets',
      'app-icons',
    ),
    path.join(
      paths.packagingRoot,
      'app-icons',
    ),
  );

  if (target === 'win32-x64') {
    await ensureWindowsIco(
      paths.packagingRoot,
    );
  }

  await copyTree(
    path.join(
      root,
      'assets',
      'branding',
    ),
    path.join(
      paths.packagingRoot,
      'branding',
    ),
  );

  await normalizeDesktopPackage(
    root,
    paths.appRoot,
  );

  await collectLicenses(
    lock,
    target,
    paths,
    vendorLicenses,
  );

  await pruneReleaseMetadata(
    paths.stageRoot,
  );

  await withStageProgress(
    'Refreshing Prisma migration runtime manifest',
    () => refreshPrismaMigrationRuntimeTemplateManifest(
      paths.runtimeRoot,
    ),
  );

  const stageInventory = await withStageProgress(
    'Building complete stage inventory and SHA256 manifest',
    () => inventory(
      paths.stageRoot,
    ),
  );

  const manifest = {
    schemaVersion: 1,
    product: 'SEEKMORE',
    version: JSON.parse(
      await fsp.readFile(
        path.join(root, 'package.json'),
        'utf8',
      ),
    ).version,
    target,
    runtimeLock: {
      node: lock.node.version,
      postgresql: lock.postgresql.version,
      pgvector: lock.pgvector.version,
      cacheProvider:
        cacheRuntimeForTarget(
          lock,
          target,
        ).provider,
      cacheVersion:
        cacheRuntimeForTarget(
          lock,
          target,
        ).version,
    },
    files: stageInventory,
  };

  await fsp.writeFile(
    paths.manifestPath,
    `${JSON.stringify(
      manifest,
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(
    `[Stage] Stage ready: ${paths.stageRoot}`,
  );
}

async function assertVendorManifest(
  lock,
  target,
  vendorRoot,
) {
  const manifestPath = path.join(
    vendorRoot,
    'vendor-manifest.json',
  );

  await ensureFile(
    manifestPath,
    'vendor manifest',
  );

  const manifest = JSON.parse(
    await fsp.readFile(
      manifestPath,
      'utf8',
    ),
  );

  const expected = {
    target,
    node: lock.node.version,
    postgresql:
      lock.postgresql.version,
    pgvector:
      lock.pgvector.version,
    cacheProvider:
      cacheRuntimeForTarget(
        lock,
        target,
      ).provider,
    cacheVersion:
      cacheRuntimeForTarget(
        lock,
        target,
      ).version,
  };

  for (
    const [key, value]
    of Object.entries(expected)
  ) {
    if (manifest[key] !== value) {
      throw new Error(
        `[Stage] Vendor manifest ${key}=${String(
          manifest[key],
        )} does not match runtime lock ${String(
          value,
        )}.`,
      );
    }
  }

  if (
    !String(
      manifest.pgvectorCommit || '',
    ).match(/^[a-f0-9]{40}$/)
  ) {
    throw new Error(
      '[Stage] Vendor manifest is missing the verified pgvector commit.',
    );
  }

  if (
    lock.pgvector.commit
    && manifest.pgvectorCommit !== lock.pgvector.commit
  ) {
    throw new Error(
      `[Stage] Vendor pgvector commit ${String(manifest.pgvectorCommit)} does not match runtime lock ${lock.pgvector.commit}.`,
    );
  }
}

async function removeDesktopWorkspaceSelfLink(
  appRoot,
) {
  const selfLink = path.join(
    appRoot,
    'node_modules',
    '@seekmore',
    'desktop',
  );

  const stat = await fsp
    .lstat(selfLink)
    .catch(() => null);

  if (!stat) {
    return;
  }

  if (!stat.isSymbolicLink()) {
    throw new Error(
      `[Stage] Expected Desktop workspace self-reference to be a symlink: ${selfLink}`,
    );
  }

  await fsp.rm(selfLink, {
    recursive: true,
    force: true,
  });

  console.log(
    '[Stage] Removed Desktop workspace self-link from staged production dependencies.',
  );
}

async function removeBackendWorkspaceLink(
  appRoot,
) {
  const workspaceLink = path.join(
    appRoot,
    'node_modules',
    'backend',
  );

  const stat = await fsp
    .lstat(workspaceLink)
    .catch(() => null);

  if (!stat) {
    return;
  }

  if (!stat.isSymbolicLink()) {
    throw new Error(
      `[Stage] Expected Backend workspace reference to be a symlink: ${workspaceLink}`,
    );
  }

  await fsp.rm(workspaceLink, {
    recursive: true,
    force: true,
  });

  console.log(
    '[Stage] Removed Backend workspace link from staged Desktop production dependencies.',
  );
}

async function removeFrontendWorkspaceLink(
  appRoot,
) {
  const workspaceLink = path.join(
    appRoot,
    'node_modules',
    'frontend',
  );

  const stat = await fsp
    .lstat(workspaceLink)
    .catch(() => null);

  if (!stat) {
    return;
  }

  if (!stat.isSymbolicLink()) {
    throw new Error(
      `[Stage] Expected Frontend workspace reference to be a symlink: ${workspaceLink}`,
    );
  }

  await fsp.rm(workspaceLink, {
    recursive: true,
    force: true,
  });

  console.log(
    '[Stage] Removed Frontend workspace link from staged Desktop production dependencies.',
  );
}

async function removeWindowsLegacyDeployWorkspaceLinks(
  root,
  stageRoot,
  packageRoot,
) {
  const virtualWorkspaceRoot = path.join(
    packageRoot,
    'node_modules',
    '.pnpm',
    'node_modules',
  );

  const workspaceLinks = [
    {
      linkSegments: [
        '@seekmore',
        'desktop',
      ],
      sourceSegments: [
        'desktop',
      ],
    },
    {
      linkSegments: [
        'backend',
      ],
      sourceSegments: [
        'backend',
      ],
    },
    {
      linkSegments: [
        'frontend',
      ],
      sourceSegments: [
        'frontend',
      ],
    },
  ];

  const normalizedStageRoot = path
    .resolve(stageRoot)
    .toLowerCase();

  for (const workspaceLink of workspaceLinks) {
    const linkPath = path.join(
      virtualWorkspaceRoot,
      ...workspaceLink.linkSegments,
    );

    const stat = await fsp
      .lstat(linkPath)
      .catch(() => null);

    if (!stat) {
      continue;
    }

    if (!stat.isSymbolicLink()) {
      continue;
    }

    const target = await fsp.readlink(
      linkPath,
    );

    const resolvedTarget = path
      .resolve(
        path.dirname(linkPath),
        target,
      )
      .toLowerCase();

    const expectedSource = path
      .resolve(
        root,
        ...workspaceLink.sourceSegments,
      )
      .toLowerCase();

    if (resolvedTarget !== expectedSource) {
      continue;
    }

    if (
      resolvedTarget === normalizedStageRoot
      || resolvedTarget.startsWith(
        `${normalizedStageRoot}${path.sep}`,
      )
    ) {
      continue;
    }

    await fsp.rm(linkPath, {
      recursive: true,
      force: true,
    });

    console.log(
      `[Stage] Removed Windows pnpm legacy-deploy workspace link: ${path.relative(stageRoot, linkPath)}`,
    );
  }
}

async function pruneDeployedPackage(
  packageRoot,
  allowedEntries,
) {
  const entries = await fsp.readdir(
    packageRoot,
    {
      withFileTypes: true,
    },
  );

  for (const entry of entries) {
    if (
      allowedEntries.has(entry.name)
    ) {
      continue;
    }

    await fsp.rm(
      path.join(
        packageRoot,
        entry.name,
      ),
      {
        recursive: true,
        force: true,
      },
    );
  }
}

async function generateStagedPrismaClient(
  target,
  paths,
) {
  const nodeExecutablePath =
    target.startsWith('win32-')
      ? path.join(
          paths.runtimeRoot,
          'node',
          'node.exe',
        )
      : path.join(
          paths.runtimeRoot,
          'node',
          'bin',
          'node',
        );

  const prismaCliEntryPath = path.join(
    paths.backendRoot,
    'node_modules',
    'prisma',
    'build',
    'index.js',
  );

  const schemaPath = path.join(
    paths.backendRoot,
    'prisma',
    'schema.prisma',
  );

  await Promise.all([
    ensureFile(
      nodeExecutablePath,
      'staged Node executable',
    ),
    ensureFile(
      prismaCliEntryPath,
      'staged Prisma CLI',
    ),
    ensureFile(
      schemaPath,
      'staged Prisma schema',
    ),
  ]);

  await run(
    nodeExecutablePath,
    [
      prismaCliEntryPath,
      'generate',
      '--schema',
      schemaPath,
    ],
    {
      cwd: paths.backendRoot,
      env: process.env,
    },
  );

  console.log(
    '[Stage] Generated staged Prisma Client.',
  );
}

async function preparePrismaMigrationRuntimeTemplate(
  target,
  paths,
) {
  const templateRoot = path.join(
    paths.runtimeRoot,
    'prisma-migrate',
  );

  await fsp.rm(
    templateRoot,
    {
      recursive: true,
      force: true,
    },
  );

  const nodeModulesRoot = path.join(
    templateRoot,
    'node_modules',
  );

  await fsp.mkdir(
    nodeModulesRoot,
    {
      recursive: true,
    },
  );

  const copiedPackages = [];

  if (target === 'win32-x64') {
    await copyPackageDependencyTreeHoisted({
      packageName: 'prisma',
      resolveFrom: paths.backendRoot,
      destinationNodeModules: nodeModulesRoot,
      copiedPackages,
    });
  } else {
    await copyPackageDependencyTree({
      packageName: 'prisma',
      resolveFrom: paths.backendRoot,
      destinationNodeModules: nodeModulesRoot,
      ancestry: new Set(),
      copiedPackages,
    });
  }

  const payloads =
    await encodePrismaNativeEnginePayloads(
      templateRoot,
      target,
    );

  if (target === 'win32-x64') {
    await assertWindowsPrismaMigrationRuntimePortability(
      templateRoot,
    );
  }

  const prismaPackagePath = path.join(
    nodeModulesRoot,
    'prisma',
    'package.json',
  );

  const prismaPackage = JSON.parse(
    await fsp.readFile(
      prismaPackagePath,
      'utf8',
    ),
  );

  const prismaVersion = String(
    prismaPackage.version || '',
  ).trim();

  if (!prismaVersion) {
    throw new Error(
      '[Stage] Prisma migration runtime package has no version.',
    );
  }

  await fsp.writeFile(
    path.join(
      templateRoot,
      'package.json',
    ),
    `${JSON.stringify(
      {
        name: '@seekmore/prisma-migration-runtime',
        private: true,
        version: prismaVersion,
        dependencies: {
          prisma: prismaVersion,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const templateInventory =
    await inventory(
      templateRoot,
    );

  const contentHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        templateInventory,
      ),
    )
    .digest('hex');

  await fsp.writeFile(
    path.join(
      templateRoot,
      'runtime-manifest.json',
    ),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        prismaVersion,
        target,
        contentHash,
        payloads,
        packages: copiedPackages
          .sort(
            (left, right) =>
              left.name.localeCompare(
                right.name,
              )
              || left.version.localeCompare(
                right.version,
              ),
          ),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  await Promise.all([
    ensureFile(
      path.join(
        nodeModulesRoot,
        'prisma',
        'build',
        'index.js',
      ),
      'Prisma migration runtime CLI',
    ),
    ensureFile(
      path.join(
        resolvePrismaMigrationEnginesRoot(
          templateRoot,
          target,
        ),
        'package.json',
      ),
      'Prisma migration runtime engines package',
    ),
  ]);

  console.log(
    `[Stage] Prepared isolated Prisma migration runtime ${prismaVersion} for ${target}.`,
  );
}

function resolvePrismaMigrationEnginesRoot(
  templateRoot,
  target,
) {
  if (target === 'win32-x64') {
    return path.join(
      templateRoot,
      'node_modules',
      '@prisma',
      'engines',
    );
  }

  return path.join(
    templateRoot,
    'node_modules',
    'prisma',
    'node_modules',
    '@prisma',
    'engines',
  );
}

async function assertWindowsPrismaMigrationRuntimePortability(
  templateRoot,
) {
  const legacyNestedEngines = path.join(
    templateRoot,
    'node_modules',
    'prisma',
    'node_modules',
    '@prisma',
    'engines',
  );

  const legacyStat = await fsp
    .lstat(legacyNestedEngines)
    .catch(() => null);

  if (legacyStat) {
    throw new Error(
      '[Stage] Windows Prisma migration runtime still contains the legacy nested @prisma/engines layout.',
    );
  }

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

  const entries = await inventory(
    templateRoot,
  );

  for (const entry of entries) {
    if (entry.type === 'symlink') {
      throw new Error(
        `[Stage] Windows Prisma migration runtime must not contain symlinks: ${entry.path}`,
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
        `[Stage] Windows Prisma migration runtime path exceeds the portability budget (${appRelativePath.length} > ${WINDOWS_PRISMA_RUNTIME_APP_RELATIVE_PATH_BUDGET}): ${appRelativePath}`,
      );
    }
  }
}

async function encodePrismaNativeEnginePayloads(
  templateRoot,
  target,
) {
  const enginesRoot =
    resolvePrismaMigrationEnginesRoot(
      templateRoot,
      target,
    );

  await ensureDirectory(
    enginesRoot,
    'Prisma migration runtime engines package',
  );

  const payloads = [];

  async function walk(
    directory,
  ) {
    const entries = await fsp.readdir(
      directory,
      {
        withFileTypes: true,
      },
    );

    for (const entry of entries) {
      const candidate = path.join(
        directory,
        entry.name,
      );

      if (entry.isDirectory()) {
        await walk(candidate);
        continue;
      }

      if (
        !entry.isFile()
        || !isPrismaNativeEngineFileName(
          entry.name,
        )
      ) {
        continue;
      }

      const relativePath = path
        .relative(
          templateRoot,
          candidate,
        )
        .split(path.sep)
        .join('/');

      const payloadPath =
        `payloads/${relativePath}.gz`;

      const payloadAbsolutePath = path.join(
        templateRoot,
        ...payloadPath.split('/'),
      );

      const sourceBytes = await fsp.readFile(
        candidate,
      );

      const metadata = await fsp.stat(
        candidate,
      );

      const compressed = await gzip(
        sourceBytes,
        {
          level: 9,
        },
      );

      await fsp.mkdir(
        path.dirname(
          payloadAbsolutePath,
        ),
        {
          recursive: true,
        },
      );

      await fsp.writeFile(
        payloadAbsolutePath,
        compressed,
      );

      await fsp.rm(
        candidate,
        {
          force: true,
        },
      );

      payloads.push({
        relativePath,
        payloadPath,
        sha256: crypto
          .createHash('sha256')
          .update(sourceBytes)
          .digest('hex'),
        mode: metadata.mode & 0o777,
      });
    }
  }

  await walk(
    enginesRoot,
  );

  if (payloads.length === 0) {
    throw new Error(
      '[Stage] Prisma migration runtime contains no native engine payloads.',
    );
  }

  return payloads.sort(
    (left, right) =>
      left.relativePath.localeCompare(
        right.relativePath,
      ),
  );
}

function isPrismaNativeEngineFileName(
  name,
) {
  return /^schema-engine-/.test(name)
    || /^query-engine-/.test(name)
    || /^libquery_engine-.*\.node$/.test(name)
    || /^query_engine-.*\.node$/.test(name);
}

async function copyPackageDependencyTreeHoisted({
  packageName,
  resolveFrom,
  destinationNodeModules,
  copiedPackages,
}) {
  const graph = new Map();
  const versionsByName = new Map();

  const rootNode = await collectPackageDependencyGraph({
    packageName,
    resolveFrom,
    graph,
    versionsByName,
  });

  await copyHoistedPackageNode({
    node: rootNode,
    rootNodeModules: destinationNodeModules,
    destinationNodeModules,
    versionsByName,
    copiedDestinations: new Map(),
    copiedPackages,
  });
}

async function collectPackageDependencyGraph({
  packageName,
  resolveFrom,
  graph,
  versionsByName,
}) {
  const sourceRoot =
    await resolveInstalledPackageRoot(
      packageName,
      resolveFrom,
    );

  const sourceIdentity =
    await fsp.realpath(
      sourceRoot,
    ).catch(
      () => path.resolve(sourceRoot),
    );

  const existing = graph.get(
    sourceIdentity,
  );

  if (existing) {
    return existing;
  }

  const packageJson = JSON.parse(
    await fsp.readFile(
      path.join(
        sourceRoot,
        'package.json',
      ),
      'utf8',
    ),
  );

  if (packageJson.name !== packageName) {
    throw new Error(
      `[Stage] Resolved package ${packageName} reported name ${String(packageJson.name)}.`,
    );
  }

  const version = String(
    packageJson.version || '',
  );

  const versions =
    versionsByName.get(packageName)
    || new Set();
  versions.add(version);
  versionsByName.set(
    packageName,
    versions,
  );

  const node = {
    name: packageName,
    version,
    sourceRoot,
    sourceIdentity,
    dependencies: [],
  };

  graph.set(
    sourceIdentity,
    node,
  );

  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.optionalDependencies || {}),
  };

  for (
    const dependencyName
    of Object.keys(dependencies).sort()
  ) {
    try {
      const dependency =
        await collectPackageDependencyGraph({
          packageName: dependencyName,
          resolveFrom: sourceRoot,
          graph,
          versionsByName,
        });

      node.dependencies.push(
        dependency,
      );
    } catch (error) {
      if (
        packageJson.optionalDependencies
        && Object.prototype.hasOwnProperty.call(
          packageJson.optionalDependencies,
          dependencyName,
        )
        && isPackageResolutionFailure(
          error,
        )
      ) {
        continue;
      }

      throw error;
    }
  }

  return node;
}

async function copyHoistedPackageNode({
  node,
  rootNodeModules,
  destinationNodeModules,
  versionsByName,
  copiedDestinations,
  copiedPackages,
}) {
  const destinationRoot = path.join(
    destinationNodeModules,
    ...node.name.split('/'),
  );

  const existingVersion =
    copiedDestinations.get(
      destinationRoot,
    );

  if (existingVersion) {
    if (existingVersion !== node.version) {
      throw new Error(
        `[Stage] Windows Prisma migration runtime dependency placement conflict for ${node.name}: ${existingVersion} vs ${node.version}.`,
      );
    }

    return;
  }

  copiedDestinations.set(
    destinationRoot,
    node.version,
  );

  await fsp.rm(
    destinationRoot,
    {
      recursive: true,
      force: true,
    },
  );

  await fsp.mkdir(
    path.dirname(destinationRoot),
    {
      recursive: true,
    },
  );

  await fsp.cp(
    node.sourceRoot,
    destinationRoot,
    {
      recursive: true,
      force: true,
      dereference: true,
      filter: (source) => {
        const relative = path.relative(
          node.sourceRoot,
          source,
        );

        return relative !== 'node_modules'
          && !relative.startsWith(
            `node_modules${path.sep}`,
          );
      },
    },
  );

  copiedPackages.push({
    name: node.name,
    version: node.version,
  });

  for (const dependency of node.dependencies) {
    const versions =
      versionsByName.get(
        dependency.name,
      );

    const dependencyNodeModules =
      versions?.size > 1
        ? path.join(
            destinationRoot,
            'node_modules',
          )
        : rootNodeModules;

    await copyHoistedPackageNode({
      node: dependency,
      rootNodeModules,
      destinationNodeModules:
        dependencyNodeModules,
      versionsByName,
      copiedDestinations,
      copiedPackages,
    });
  }
}

async function copyPackageDependencyTree({
  packageName,
  resolveFrom,
  destinationNodeModules,
  ancestry,
  copiedPackages,
}) {
  const sourceRoot =
    await resolveInstalledPackageRoot(
      packageName,
      resolveFrom,
    );

  const sourceIdentity =
    await fsp.realpath(
      sourceRoot,
    ).catch(
      () => path.resolve(sourceRoot),
    );

  if (ancestry.has(sourceIdentity)) {
    return;
  }

  const packageJsonPath = path.join(
    sourceRoot,
    'package.json',
  );

  const packageJson = JSON.parse(
    await fsp.readFile(
      packageJsonPath,
      'utf8',
    ),
  );

  if (packageJson.name !== packageName) {
    throw new Error(
      `[Stage] Resolved package ${packageName} reported name ${String(packageJson.name)}.`,
    );
  }

  const destinationRoot = path.join(
    destinationNodeModules,
    ...packageName.split('/'),
  );

  await fsp.rm(
    destinationRoot,
    {
      recursive: true,
      force: true,
    },
  );

  await fsp.mkdir(
    path.dirname(destinationRoot),
    {
      recursive: true,
    },
  );

  await fsp.cp(
    sourceRoot,
    destinationRoot,
    {
      recursive: true,
      force: true,
      dereference: true,
      filter: (source) => {
        const relative = path.relative(
          sourceRoot,
          source,
        );

        return relative !== 'node_modules'
          && !relative.startsWith(
            `node_modules${path.sep}`,
          );
      },
    },
  );

  copiedPackages.push({
    name: packageName,
    version: String(
      packageJson.version || '',
    ),
  });

  const nextAncestry = new Set(
    ancestry,
  );
  nextAncestry.add(
    sourceIdentity,
  );

  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.optionalDependencies || {}),
  };

  for (
    const dependencyName
    of Object.keys(dependencies).sort()
  ) {
    try {
      await copyPackageDependencyTree({
        packageName: dependencyName,
        resolveFrom: sourceRoot,
        destinationNodeModules: path.join(
          destinationRoot,
          'node_modules',
        ),
        ancestry: nextAncestry,
        copiedPackages,
      });
    } catch (error) {
      if (
        packageJson.optionalDependencies
        && Object.prototype.hasOwnProperty.call(
          packageJson.optionalDependencies,
          dependencyName,
        )
        && isPackageResolutionFailure(
          error,
        )
      ) {
        continue;
      }

      throw error;
    }
  }
}

async function resolveInstalledPackageRoot(
  packageName,
  resolveFrom,
) {
  try {
    const packageJsonPath = require.resolve(
      `${packageName}/package.json`,
      {
        paths: [resolveFrom],
      },
    );

    return path.dirname(
      packageJsonPath,
    );
  } catch (error) {
    try {
      const entry = require.resolve(
        packageName,
        {
          paths: [resolveFrom],
        },
      );

      let current = path.dirname(
        entry,
      );

      for (;;) {
        const packageJsonPath = path.join(
          current,
          'package.json',
        );

        const packageJson = await fsp
          .readFile(
            packageJsonPath,
            'utf8',
          )
          .then(JSON.parse)
          .catch(() => null);

        if (
          packageJson?.name
          === packageName
        ) {
          return current;
        }

        const parent = path.dirname(
          current,
        );

        if (parent === current) {
          break;
        }

        current = parent;
      }
    } catch {
      // Fall through to the release error below.
    }

    const wrapped = new Error(
      `[Stage] Unable to resolve Prisma migration runtime dependency ${packageName} from ${resolveFrom}.`,
    );
    wrapped.code = 'STAGE_PRISMA_RUNTIME_PACKAGE_NOT_FOUND';
    wrapped.cause = error;
    throw wrapped;
  }
}

function isPackageResolutionFailure(
  error,
) {
  return Boolean(
    error
    && typeof error === 'object'
    && error.code === 'STAGE_PRISMA_RUNTIME_PACKAGE_NOT_FOUND',
  );
}

async function refreshPrismaMigrationRuntimeTemplateManifest(
  runtimeRoot,
) {
  const templateRoot = path.join(
    runtimeRoot,
    'prisma-migrate',
  );

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

  const contentInventory = (
    await inventory(
      templateRoot,
    )
  ).filter(
    (entry) =>
      entry.path !== 'runtime-manifest.json',
  );

  manifest.contentHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        contentInventory,
      ),
    )
    .digest('hex');

  await fsp.writeFile(
    manifestPath,
    `${JSON.stringify(
      manifest,
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function ensureWindowsIco(
  packagingRoot,
) {
  const iconRoot = path.join(
    packagingRoot,
    'app-icons',
    'win',
  );
  const icoPath = path.join(
    iconRoot,
    'SEEKMORE.ico',
  );

  if (fs.existsSync(icoPath)) {
    return;
  }

  const pngPath = path.join(
    iconRoot,
    'SEEKMORE.png',
  );
  await ensureFile(
    pngPath,
    'Windows SEEKMORE PNG icon source',
  );

  const png = await fsp.readFile(
    pngPath,
  );

  if (
    png.length < 24
    || png.subarray(0, 8).toString('hex')
      !== '89504e470d0a1a0a'
    || png.subarray(12, 16).toString('ascii')
      !== 'IHDR'
  ) {
    throw new Error(
      `[Stage] Windows icon source is not a valid PNG: ${pngPath}`,
    );
  }

  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);

  if (width < 1 || height < 1) {
    throw new Error(
      `[Stage] Windows icon PNG has invalid dimensions ${width}x${height}: ${pngPath}`,
    );
  }

  if (width > 256 || height > 256) {
    console.log(
      `[Stage] Windows icon source is ${width}x${height}; keeping PNG for electron-builder icon conversion instead of writing an invalid ICO wrapper.`,
    );
    return;
  }

  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(width === 256 ? 0 : width, 6);
  header.writeUInt8(height === 256 ? 0 : height, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);

  await fsp.writeFile(
    icoPath,
    Buffer.concat([header, png]),
  );
}

async function normalizeDesktopPackage(
  root,
  appRoot,
) {
  const rootPackage = JSON.parse(
    await fsp.readFile(
      path.join(
        root,
        'package.json',
      ),
      'utf8',
    ),
  );

  const appPackagePath =
    path.join(
      appRoot,
      'package.json',
    );

  const appPackage = JSON.parse(
    await fsp.readFile(
      appPackagePath,
      'utf8',
    ),
  );

  appPackage.version =
    rootPackage.version;

  appPackage.productName =
    'SEEKMORE';

  await fsp.writeFile(
    appPackagePath,
    `${JSON.stringify(
      appPackage,
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function collectLicenses(
  lock,
  target,
  paths,
  vendorLicenses,
) {
  await fsp.mkdir(
    paths.licensesRoot,
    {
      recursive: true,
    },
  );

  await fsp.writeFile(
    path.join(
      paths.licensesRoot,
      'RUNTIME-NOTICES.json',
    ),
    `${JSON.stringify(
      {
        node: {
          version:
            lock.node.version,
          license:
            lock.node.license,
        },
        postgresql: {
          version:
            lock.postgresql.version,
          license:
            lock.postgresql.license,
        },
        pgvector: {
          version:
            lock.pgvector.version,
          license:
            lock.pgvector.license,
        },
        cacheRuntime: {
          provider:
            cacheRuntimeForTarget(
              lock,
              target,
            ).provider,
          version:
            cacheRuntimeForTarget(
              lock,
              target,
            ).version,
          license:
            cacheRuntimeForTarget(
              lock,
              target,
            ).license,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  if (
    fs.existsSync(
      vendorLicenses,
    )
  ) {
    await copyTree(
      vendorLicenses,
      path.join(
        paths.licensesRoot,
        'runtime',
      ),
    );

    const vendorManifest =
      path.join(
        path.dirname(
          vendorLicenses,
        ),
        'vendor-manifest.json',
      );

    if (
      fs.existsSync(
        vendorManifest,
      )
    ) {
      await fsp.copyFile(
        vendorManifest,
        path.join(
          paths.licensesRoot,
          'RUNTIME-VENDOR-MANIFEST.json',
        ),
      );
    }
  }

  await collectWorkspaceLicenseMetadata(
    paths.stageRoot,
    'backend',
    path.join(
      paths.licensesRoot,
      'backend-node-modules.json',
    ),
  );

  await collectWorkspaceLicenseMetadata(
    paths.stageRoot,
    '@seekmore/desktop',
    path.join(
      paths.licensesRoot,
      'desktop-node-modules.json',
    ),
  );

  await collectWorkspaceLicenseMetadata(
    paths.stageRoot,
    'frontend',
    path.join(
      paths.licensesRoot,
      'frontend-node-modules.json',
    ),
  );
}

async function collectWorkspaceLicenseMetadata(
  _stageRoot,
  selector,
  outputPath,
) {
  const root = repoRoot(__dirname);

  const { stdout } =
    await capture(
      pnpmCommand(),
      [
        'licenses',
        'list',
        '--prod',
        '--json',
        '--filter',
        selector,
      ],
      {
        cwd: root,
        env: process.env,
      },
    );

  let payload;

  try {
    payload =
      JSON.parse(
        stdout || '{}',
      );
  } catch {
    throw new Error(
      `[Stage] pnpm license inventory for ${selector} was not valid JSON.`,
    );
  }

  await fsp.writeFile(
    outputPath,
    `${JSON.stringify(
      payload,
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function pruneReleaseMetadata(
  root,
  scope = 'stage',
) {
  const removableFiles = new Set([
    '.gitkeep',
    '.gitignore',
    '.gitattributes',
    '.npmignore',
    '.DS_Store',
    '.editorconfig',
  ]);

  const removableDirectories = new Set([
    '.git',
    '.hg',
    '.svn',
    '.idea',
    '.vs',
    '.nyc_output',
    '__pycache__',
  ]);

  let removedFiles = 0;
  let removedDirectories = 0;

  async function walk(directory) {
    const entries = await fsp.readdir(
      directory,
      {
        withFileTypes: true,
      },
    );

    for (const entry of entries) {
      const candidate = path.join(
        directory,
        entry.name,
      );

      if (
        entry.isDirectory()
        && removableDirectories.has(
          entry.name,
        )
      ) {
        await fsp.rm(
          candidate,
          {
            recursive: true,
            force: true,
          },
        );

        removedDirectories += 1;
        continue;
      }

      if (
        !entry.isDirectory()
        && removableFiles.has(
          entry.name,
        )
      ) {
        await fsp.rm(
          candidate,
          {
            force: true,
          },
        );

        removedFiles += 1;
        continue;
      }

      if (entry.isDirectory()) {
        await walk(candidate);
      }
    }
  }

  await walk(root);

  console.log(
    `[Stage] Removed non-runtime repository metadata from ${scope}: files=${removedFiles}, directories=${removedDirectories}.`,
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.stack
        || error.message
      : error,
  );

  process.exitCode = 1;
});