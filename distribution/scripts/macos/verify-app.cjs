const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  spawn,
} = require('node:child_process');

const {
  ensureFile,
  repoRoot,
  stagePaths,
} = require('../distribution-lib.cjs');

const {
  assertInstallerContract,
  currentTarget,
  releasePaths,
  sha256File,
} = require('../packaging-lib.cjs');

const {
  assertExecutable,
  assertMachOArchitecture,
  findUniqueAppBundle,
  readPlistValue,
} = require('./platform-lib.cjs');

const {
  verifyStage,
} = require('../verify-stage.cjs');

async function verifyMacosApp(
  root,
  target,
  options = {},
) {
  const {
    installerLock,
    rootPackage,
    targetState,
  } = await assertInstallerContract(
    root,
    target,
  );

  const stage = stagePaths(
    root,
    target,
  );

  await verifyStage(
    root,
    target,
  );

  const output = releasePaths(
    root,
    target,
  );

  const appBundle =
    options.appBundle
      ? path.resolve(
          options.appBundle,
        )
      : await findUniqueAppBundle(
          output.appOutputRoot,
          installerLock.productName,
        );

  const contents = path.join(
    appBundle,
    'Contents',
  );

  const resources = path.join(
    contents,
    'Resources',
  );

  const plistPath = path.join(
    contents,
    'Info.plist',
  );

  const appExecutable = path.join(
    contents,
    'MacOS',
    installerLock.productName,
  );

  await Promise.all([
    ensureFile(
      plistPath,
      'SEEKMORE Info.plist',
    ),

    ensureFile(
      path.join(
        resources,
        'app.asar',
      ),
      'SEEKMORE app.asar',
    ),
  ]);

  await assertExecutable(
    appExecutable,
    'SEEKMORE application executable',
  );

  await assertMachOArchitecture(
    appExecutable,
    targetState.arch,
    'SEEKMORE application executable',
  );

  await assertPlist(
    plistPath,
    installerLock,
    rootPackage.version,
  );

  await assertPackagedResources(
    stage.manifestPath,
    resources,
  );

  await assertPackagedRuntime(
    resources,
    targetState.arch,
  );

  const forbiddenPlaywrightMcp =
    path.join(
      resources,
      'runtime',
      'mcp',
      'playwright',
    );

  const forbiddenStat = await fsp
    .lstat(forbiddenPlaywrightMcp)
    .catch(() => null);

  if (forbiddenStat) {
    throw new Error(
      `[macOS Package] Removed built-in Playwright MCP leaked into app resources: ${forbiddenPlaywrightMcp}`,
    );
  }

  const appManifest = JSON.parse(
    await fsp.readFile(
      output.appManifestPath,
      'utf8',
    ),
  );

  const currentStageHash =
    await sha256File(
      stage.manifestPath,
    );

  if (
    appManifest.sourceStageManifestSha256
    !== currentStageHash
  ) {
    throw new Error(
      '[macOS Verify] App was not packaged from the currently verified stage manifest.',
    );
  }

  await assertMacCodeSignature(
    appBundle,
    installerLock.appId,
  );

  console.log(
    `[macOS Verify] App contract verified: ${appBundle}`,
  );

  return {
    appBundle,
    installerLock,
    rootPackage,
    targetState,
  };
}

async function main() {
  const root = repoRoot(__dirname);
  const target = currentTarget();

  await verifyMacosApp(
    root,
    target,
  );
}

async function assertPlist(
  plistPath,
  installerLock,
  version,
) {
  const actualAppId =
    await readPlistValue(
      plistPath,
      'CFBundleIdentifier',
    );

  if (
    actualAppId
    !== installerLock.appId
  ) {
    throw new Error(
      `[macOS Package] CFBundleIdentifier ${actualAppId} does not match ${installerLock.appId}.`,
    );
  }

  const actualVersion =
    await readPlistValue(
      plistPath,
      'CFBundleShortVersionString',
    );

  if (actualVersion !== version) {
    throw new Error(
      `[macOS Package] CFBundleShortVersionString ${actualVersion} does not match release ${version}.`,
    );
  }

  const minimumSystemVersion =
    await readPlistValue(
      plistPath,
      'LSMinimumSystemVersion',
    );

  if (
    minimumSystemVersion
    !== installerLock.macOS
      .minimumSystemVersion
  ) {
    throw new Error(
      `[macOS Package] LSMinimumSystemVersion ${minimumSystemVersion} does not match ${installerLock.macOS.minimumSystemVersion}.`,
    );
  }
}

async function assertPackagedResources(
  stageManifestPath,
  resourcesRoot,
) {
  const stageManifest = JSON.parse(
    await fsp.readFile(
      stageManifestPath,
      'utf8',
    ),
  );

  const stageRoot =
    path.dirname(
      stageManifestPath,
    );

  const resources =
    stageManifest.files.filter(
      (entry) =>
        String(entry.path)
          .startsWith('resources/'),
    );

  if (resources.length === 0) {
    throw new Error(
      '[macOS Package] stage manifest contains no immutable resources.',
    );
  }

  for (const entry of resources) {
    const relative = String(
      entry.path,
    ).slice('resources/'.length);

    const source = path.join(
      stageRoot,
      ...String(entry.path).split('/'),
    );

    const destination = path.join(
      resourcesRoot,
      ...relative.split('/'),
    );

    const stat = await fsp
      .lstat(destination)
      .catch(() => null);

    if (!stat) {
      throw new Error(
        `[macOS Package] Stage resource is missing from .app: ${relative}`,
      );
    }

    if (entry.type === 'file') {
      if (!stat.isFile()) {
        throw new Error(
          `[macOS Package] Stage file changed type in .app: ${relative}`,
        );
      }

      const sourceIsMachO =
        await isMachOFile(
          source,
        );

      const destinationIsMachO =
        await isMachOFile(
          destination,
        );

      if (
        sourceIsMachO
        || destinationIsMachO
      ) {
        if (
          !sourceIsMachO
          || !destinationIsMachO
        ) {
          throw new Error(
            `[macOS Package] Stage native-code identity changed in .app: ${relative}`,
          );
        }

        await assertSameMachOArchitectures(
          source,
          destination,
          relative,
        );

        const actualSha256 =
          await sha256File(
            destination,
          );

        if (
          actualSha256
          !== entry.sha256
        ) {
          await assertValidCodeSignature(
            destination,
            relative,
          );
        }

        continue;
      }

      if (stat.size !== entry.size) {
        throw new Error(
          `[macOS Package] Stage resource size changed in .app: ${relative}`,
        );
      }

      const actualSha256 =
        await sha256File(
          destination,
        );

      if (
        actualSha256
        !== entry.sha256
      ) {
        throw new Error(
          `[macOS Package] Stage resource hash changed in .app: ${relative}`,
        );
      }

      continue;
    }

    if (entry.type === 'symlink') {
      if (!stat.isSymbolicLink()) {
        throw new Error(
          `[macOS Package] Stage symlink changed type in .app: ${relative}`,
        );
      }

      const target =
        await fsp.readlink(
          destination,
        );

      if (target !== entry.target) {
        throw new Error(
          `[macOS Package] Stage symlink target changed in .app: ${relative}`,
        );
      }

      continue;
    }

    throw new Error(
      `[macOS Package] Unsupported stage inventory type for ${relative}: ${String(entry.type)}`,
    );
  }
}

async function isMachOFile(
  file,
) {
  const handle =
    await fsp.open(
      file,
      'r',
    );

  try {
    const header =
      Buffer.alloc(4);

    const {
      bytesRead,
    } = await handle.read(
      header,
      0,
      4,
      0,
    );

    if (bytesRead < 4) {
      return false;
    }

    const magicBE =
      header.readUInt32BE(0);

    const magicLE =
      header.readUInt32LE(0);

    const machOMagic = new Set([
      0xfeedface,
      0xfeedfacf,
      0xcefaedfe,
      0xcffaedfe,
      0xcafebabe,
      0xbebafeca,
      0xcafebabf,
      0xbfbafeca,
    ]);

    return (
      machOMagic.has(magicBE)
      || machOMagic.has(magicLE)
    );
  } finally {
    await handle.close();
  }
}

async function assertSameMachOArchitectures(
  source,
  destination,
  relative,
) {
  const sourceArchitectures =
    normalizeArchitectures(
      await captureCommand(
        '/usr/bin/lipo',
        [
          '-archs',
          source,
        ],
        `stage Mach-O architecture inspection for ${relative}`,
      ),
    );

  const destinationArchitectures =
    normalizeArchitectures(
      await captureCommand(
        '/usr/bin/lipo',
        [
          '-archs',
          destination,
        ],
        `packaged Mach-O architecture inspection for ${relative}`,
      ),
    );

  if (
    sourceArchitectures
    !== destinationArchitectures
  ) {
    throw new Error(
      `[macOS Package] Stage native-code architectures changed in .app for ${relative}: stage=${sourceArchitectures}, app=${destinationArchitectures}.`,
    );
  }
}

function normalizeArchitectures(
  value,
) {
  return String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

async function assertValidCodeSignature(
  file,
  relative,
) {
  await captureCommand(
    '/usr/bin/codesign',
    [
      '--verify',
      '--strict',
      '--verbose=2',
      file,
    ],
    `signed native resource verification for ${relative}`,
  );
}


async function assertPackagedRuntime(
  resources,
  expectedArch,
) {
  const node = path.join(
    resources,
    'runtime',
    'node',
    'bin',
    'node',
  );

  const npm = path.join(
    resources,
    'runtime',
    'node',
    'bin',
    'npm',
  );

  const npx = path.join(
    resources,
    'runtime',
    'node',
    'bin',
    'npx',
  );

  const corepack = path.join(
    resources,
    'runtime',
    'node',
    'bin',
    'corepack',
  );

  const postgres = path.join(
    resources,
    'runtime',
    'postgres',
    'bin',
    'postgres',
  );

  const redis = path.join(
    resources,
    'runtime',
    'redis',
    'redis-server',
  );

  for (const [file, label] of [
    [node, 'bundled Node'],
    [postgres, 'bundled PostgreSQL'],
    [redis, 'bundled Valkey'],
  ]) {
    await assertExecutable(
      file,
      label,
    );

    await assertMachOArchitecture(
      file,
      expectedArch,
      label,
    );
  }

  for (const [file, label] of [
    [npm, 'bundled npm'],
    [npx, 'bundled npx'],
    [corepack, 'bundled Corepack'],
  ]) {
    await assertExecutable(
      file,
      label,
    );
  }

  const prismaMigrationRuntimeRoot = path.join(
    resources,
    'runtime',
    'prisma-migrate',
  );

  await Promise.all([
    ensureFile(
      path.join(
        resources,
        'backend',
        'dist',
        'src',
        'main.js',
      ),
      'packaged Backend entry',
    ),

    ensureFile(
      path.join(
        resources,
        'frontend',
        'dist',
        'index.html',
      ),
      'packaged Frontend entry',
    ),

    ensureFile(
      path.join(
        resources,
        'backend',
        'prisma',
        'schema.prisma',
      ),
      'packaged Prisma schema',
    ),

    ensureFile(
      path.join(
        prismaMigrationRuntimeRoot,
        'runtime-manifest.json',
      ),
      'packaged Prisma migration runtime manifest',
    ),

    ensureFile(
      path.join(
        prismaMigrationRuntimeRoot,
        'package.json',
      ),
      'packaged Prisma migration runtime package manifest',
    ),

    ensureFile(
      path.join(
        prismaMigrationRuntimeRoot,
        'node_modules',
        'prisma',
        'build',
        'index.js',
      ),
      'packaged Prisma migration runtime CLI',
    ),

    ensureFile(
      path.join(
        prismaMigrationRuntimeRoot,
        'node_modules',
        'prisma',
        'node_modules',
        '@prisma',
        'engines',
        'package.json',
      ),
      'packaged Prisma migration runtime engines package',
    ),

    ensureFile(
      path.join(
        resources,
        'runtime',
        'postgres',
        'share',
        'extension',
        'vector.control',
      ),
      'packaged pgvector control file',
    ),

    ensureFile(
      path.join(
        resources,
        'resources',
        'audio',
        'reminder.wav',
      ),
      'packaged reminder audio',
    ),
  ]);

  const prismaRuntimeManifest = JSON.parse(
    await fsp.readFile(
      path.join(
        prismaMigrationRuntimeRoot,
        'runtime-manifest.json',
      ),
      'utf8',
    ),
  );

  const backendPrismaPackage = JSON.parse(
    await fsp.readFile(
      path.join(
        resources,
        'backend',
        'node_modules',
        'prisma',
        'package.json',
      ),
      'utf8',
    ),
  );

  if (
    prismaRuntimeManifest.schemaVersion !== 1
    || prismaRuntimeManifest.target !== `darwin-${expectedArch}`
    || prismaRuntimeManifest.prismaVersion !== backendPrismaPackage.version
    || !/^[a-f0-9]{64}$/.test(
      String(prismaRuntimeManifest.contentHash || ''),
    )
    || !Array.isArray(prismaRuntimeManifest.payloads)
    || prismaRuntimeManifest.payloads.length === 0
  ) {
    throw new Error(
      '[macOS Package] Packaged Prisma migration runtime manifest does not match the packaged Backend/runtime contract.',
    );
  }

  for (const payload of prismaRuntimeManifest.payloads) {
    const payloadPath = resolveRuntimeRelativePath(
      prismaMigrationRuntimeRoot,
      payload.payloadPath,
    );
    const materializedPath = resolveRuntimeRelativePath(
      prismaMigrationRuntimeRoot,
      payload.relativePath,
    );

    await ensureFile(
      payloadPath,
      'packaged Prisma migration runtime compressed native payload',
    );

    const materializedStat = await fsp
      .lstat(materializedPath)
      .catch(() => null);

    if (materializedStat) {
      throw new Error(
        `[macOS Package] Packaged Prisma migration template contains a live native engine instead of an immutable payload: ${payload.relativePath}`,
      );
    }
  }
}

function resolveRuntimeRelativePath(
  root,
  value,
) {
  if (
    typeof value !== 'string'
    || !value.trim()
    || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
  ) {
    throw new Error(
      `[macOS Package] Unsafe Prisma migration runtime relative path: ${String(value)}`,
    );
  }

  const normalized = value.replace(/\\/g, '/');
  const segments = normalized.split('/');

  if (
    !segments.every(
      (segment) =>
        segment.length > 0
        && segment !== '.'
        && segment !== '..',
    )
  ) {
    throw new Error(
      `[macOS Package] Unsafe Prisma migration runtime relative path: ${value}`,
    );
  }

  return path.join(
    root,
    ...segments,
  );
}

async function assertMacCodeSignature(
  appBundle,
  expectedAppId,
) {
  await captureCommand(
    '/usr/bin/codesign',
    [
      '--verify',
      '--deep',
      '--strict',
      '--verbose=4',
      appBundle,
    ],
    'macOS code-sign verification',
  );

  const details =
    await captureCommand(
      '/usr/bin/codesign',
      [
        '-dv',
        '--verbose=4',
        appBundle,
      ],
      'macOS code-sign details',
    );

  const identifier =
    details.match(
      /^Identifier=(.+)$/m,
    )?.[1]?.trim();

  if (identifier !== expectedAppId) {
    throw new Error(
      `[macOS Package] Signed bundle identifier ${String(identifier)} does not match ${expectedAppId}.`,
    );
  }

  if (
    !/^Signature=adhoc$/m.test(
      details,
    )
  ) {
    throw new Error(
      '[macOS Package] SEEKMORE.app is not ad-hoc signed for the local-runtime package contract.',
    );
  }
}

async function captureCommand(
  command,
  args,
  label,
) {
  return new Promise(
    (resolve, reject) => {
      const child = spawn(
        command,
        args,
        {
          stdio: [
            'ignore',
            'pipe',
            'pipe',
          ],
          shell: false,
          windowsHide: true,
        },
      );

      let output = '';

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
        reject,
      );

      child.once(
        'close',
        (code) => {
          if (code === 0) {
            resolve(output);
            return;
          }

          reject(
            new Error(
              `[macOS Package] ${label} failed (${code}): ${command} ${args.join(' ')}\n${output.trim()}`,
            ),
          );
        },
      );
    },
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.stack
          || error.message
        : error,
    );

    process.exitCode = 1;
  });
}

module.exports = {
  verifyMacosApp,
};
