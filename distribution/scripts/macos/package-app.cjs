const fsp = require('node:fs/promises');
const path = require('node:path');

const {
  assertNativeTarget,
  assertReleaseToolchain,
  ensureFile,
  pnpmCommand,
  repoRoot,
  run,
  stagePaths,
} = require('../distribution-lib.cjs');

const {
  assertInstallerContract,
  currentTarget,
  releasePaths,
  sha256File,
} = require('../packaging-lib.cjs');

const {
  findUniqueAppBundle,
} = require('./platform-lib.cjs');

const {
  verifyStage,
} = require('../verify-stage.cjs');

async function main() {
  const root = repoRoot(__dirname);
  const target = currentTarget();

  assertNativeTarget(target);
  await assertReleaseToolchain(root);

  const {
    installerLock,
    rootPackage,
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

  const iconPath = path.join(
    stage.packagingRoot,
    'app-icons',
    'mac',
    'SEEKMORE.png',
  );

  await ensureFile(
    iconPath,
    'macOS SEEKMORE application icon',
  );

  const output = releasePaths(
    root,
    target,
  );

  await resetOutputDirectory(
    output.appOutputRoot,
  );

  console.log(
    `[macOS Package] Packaging ${installerLock.productName} ${rootPackage.version} for ${target} from verified stage.`,
  );

  const archFlag =
    target === 'darwin-arm64'
      ? '--arm64'
      : '--x64';

  await run(
    pnpmCommand(),
    [
      'exec',
      'electron-builder',
      '--mac',
      'dir',
      archFlag,
      '--publish',
      'never',
      '--config',
      'distribution/electron-builder.cjs',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        SEEKMORE_RELEASE_TARGET:
          target,
        CSC_IDENTITY_AUTO_DISCOVERY:
          'false',
      },
    },
  );

  const appBundle =
    await findUniqueAppBundle(
      output.appOutputRoot,
      installerLock.productName,
    );

  const stageManifestSha256 =
    await sha256File(
      stage.manifestPath,
    );

  const manifest = {
    schemaVersion: 1,
    product:
      installerLock.productName,
    version:
      rootPackage.version,
    target,
    appId:
      installerLock.appId,
    electron:
      installerLock.electron,
    electronBuilder:
      installerLock.electronBuilder,
    sourceStage: path.relative(
      root,
      stage.stageRoot,
    ),
    sourceStageManifestSha256:
      stageManifestSha256,
    appBundle: path.relative(
      root,
      appBundle,
    ),
  };

  await fsp.mkdir(
    path.dirname(
      output.appManifestPath,
    ),
    {
      recursive: true,
    },
  );

  await fsp.writeFile(
    output.appManifestPath,
    `${JSON.stringify(
      manifest,
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(
    `[macOS Package] App ready: ${appBundle}`,
  );
}


async function resetOutputDirectory(
  outputRoot,
) {
  await fsp.rm(
    outputRoot,
    {
      recursive: true,
      force: true,
      maxRetries: 12,
      retryDelay: 250,
    },
  );

  const remaining = await fsp
    .lstat(outputRoot)
    .catch(() => null);

  if (remaining) {
    throw new Error(
      `[macOS Package] Failed to clean previous app output directory: ${outputRoot}`,
    );
  }

  await fsp.mkdir(
    outputRoot,
    {
      recursive: true,
    },
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