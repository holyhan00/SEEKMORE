const fsp = require('node:fs/promises');
const path = require('node:path');

const {
  assertNativeTarget,
  assertReleaseToolchain,
  ensureDirectory,
  repoRoot,
  run,
} = require('../distribution-lib.cjs');

const {
  assertInstallerContract,
  currentTarget,
  releasePaths,
  sha256File,
} = require('../packaging-lib.cjs');

const {
  dmgFileName,
} = require('./platform-lib.cjs');

const {
  verifyMacosApp,
} = require('./verify-app.cjs');

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error(
      '[macOS Package] macOS DMG packaging must run on macOS.',
    );
  }

  const root = repoRoot(__dirname);
  const target = currentTarget();

  assertNativeTarget(target);
  await assertReleaseToolchain(root);

  const {
    installerLock,
    rootPackage,
    targetState,
  } = await assertInstallerContract(
    root,
    target,
  );

  const {
    appBundle,
  } = await verifyMacosApp(
    root,
    target,
  );

  const output = releasePaths(
    root,
    target,
  );

  await fsp.rm(
    output.installerOutputRoot,
    {
      recursive: true,
      force: true,
    },
  );

  await fsp.rm(
    path.join(output.workRoot, 'dmg'),
    {
      recursive: true,
      force: true,
    },
  );

  await fsp.mkdir(
    output.installerOutputRoot,
    {
      recursive: true,
    },
  );

  await fsp.mkdir(
    path.join(output.workRoot, 'dmg'),
    {
      recursive: true,
    },
  );

  const volumeRoot = path.join(
    path.join(output.workRoot, 'dmg'),
    'volume',
  );

  await fsp.mkdir(
    volumeRoot,
    {
      recursive: true,
    },
  );

  const stagedApp = path.join(
    volumeRoot,
    `${installerLock.productName}.app`,
  );

  await run(
    '/usr/bin/ditto',
    [
      appBundle,
      stagedApp,
    ],
  );

  await ensureDirectory(
    stagedApp,
    'DMG staged SEEKMORE.app',
  );

  await fsp.symlink(
    '/Applications',
    path.join(
      volumeRoot,
      'Applications',
    ),
  );

  const fileName = dmgFileName(
    installerLock.productName,
    rootPackage.version,
    targetState.arch,
  );

  const dmgPath = path.join(
    output.installerOutputRoot,
    fileName,
  );

  console.log(
    `[macOS Package] Creating DMG from verified app: ${appBundle}`,
  );

  await run(
    '/usr/bin/hdiutil',
    [
      'create',
      '-volname',
      installerLock.productName,
      '-srcfolder',
      volumeRoot,
      '-ov',
      '-format',
      'UDZO',
      '-imagekey',
      'zlib-level=9',
      dmgPath,
    ],
  );

  const stat = await fsp.stat(
    dmgPath,
  );

  const dmgSha256 = await sha256File(
    dmgPath,
  );

  const appManifestSha256 =
    await sha256File(
      output.appManifestPath,
    );

  const manifest = {
    schemaVersion: 1,
    product:
      installerLock.productName,
    version:
      rootPackage.version,
    target,
    arch:
      targetState.arch,
    appId:
      installerLock.appId,
    sourceApp: path.relative(
      root,
      appBundle,
    ),
    sourceAppManifestSha256:
      appManifestSha256,
    artifactType: 'dmg',
    installerType: 'dmg',
    artifact: path.relative(
      root,
      dmgPath,
    ),
    artifactSize:
      stat.size,
    artifactSha256: dmgSha256,
    volumeName:
      installerLock.productName,
    applicationsLink:
      '/Applications',
  };

  await fsp.writeFile(
    output.installerManifestPath,
    `${JSON.stringify(
      manifest,
      null,
      2,
    )}\n`,
    'utf8',
  );

  await fsp.rm(
    path.join(output.workRoot, 'dmg'),
    {
      recursive: true,
      force: true,
    },
  );

  console.log(
    `[macOS Package] DMG ready: ${dmgPath}`,
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
