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
  assertWindowsAppLayout,
  findWinUnpacked,
} = require('./platform-lib.cjs');

const { ensureVerifiedStage } = require('../verify-stage.cjs');
const { invalidateAppVerificationReceipt } = require('./verification-receipt.cjs');

async function copyVerifiedStageResources(
  sourceRoot,
  destinationRoot,
) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  const sourceStat = await fsp
    .lstat(source)
    .catch(() => null);

  if (!sourceStat?.isDirectory()) {
    throw new Error(
      `[Windows Package] Verified stage resources directory is missing: ${source}`,
    );
  }

  await fsp.mkdir(
    destination,
    {
      recursive: true,
    },
  );

  async function copyTree(
    currentSource,
    currentDestination,
  ) {
    const stat = await fsp.lstat(
      currentSource,
    );

    if (stat.isSymbolicLink()) {
      throw new Error(
        `[Windows Package] Verified Windows Stage resources contain a filesystem link: ${currentSource}. Windows backend deployment must use pnpm node-linker=hoisted so packaged resources are portable without build-machine junctions.`,
      );
    }

    if (stat.isDirectory()) {
      await fsp.mkdir(
        currentDestination,
        {
          recursive: true,
        },
      );

      const entries = await fsp.readdir(
        currentSource,
        {
          withFileTypes: true,
        },
      );

      entries.sort(
        (a, b) =>
          a.name.localeCompare(
            b.name,
          ),
      );

      for (const entry of entries) {
        await copyTree(
          path.join(
            currentSource,
            entry.name,
          ),
          path.join(
            currentDestination,
            entry.name,
          ),
        );
      }

      return;
    }

    if (stat.isFile()) {
      await fsp.mkdir(
        path.dirname(
          currentDestination,
        ),
        {
          recursive: true,
        },
      );

      await fsp.copyFile(
        currentSource,
        currentDestination,
      );

      return;
    }

    throw new Error(
      `[Windows Package] Unsupported verified stage resource type: ${currentSource}`,
    );
  }

  await copyTree(
    source,
    destination,
  );

  console.log(
    '[Windows Package] Copied verified symlink-free Stage resources.',
  );
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error(
      '[Windows Package] Windows app packaging must run on Windows.',
    );
  }

  const root = repoRoot(__dirname);
  const target = currentTarget();

  if (target !== 'win32-x64') {
    throw new Error(
      `[Windows Package] First release supports win32-x64 only, got ${target}.`,
    );
  }

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

  await ensureVerifiedStage(
    root,
    target,
  );

  await invalidateAppVerificationReceipt(
    root,
    target,
  );

  await ensureFile(
    path.join(
      stage.packagingRoot,
      'app-icons',
      'win',
      'SEEKMORE.png',
    ),
    'Windows SEEKMORE application icon source',
  );

  const output = releasePaths(
    root,
    target,
  );

  await fsp.rm(
    output.appOutputRoot,
    {
      recursive: true,
      force: true,
      maxRetries: 12,
      retryDelay: 250,
    },
  );

  await fsp.mkdir(
    output.appOutputRoot,
    {
      recursive: true,
    },
  );

  console.log(
    `[Windows Package] Packaging ${installerLock.productName} ${rootPackage.version} for ${target} from verified stage.`,
  );

  await run(
    pnpmCommand(),
    [
      'exec',
      'electron-builder',
      '--win',
      'dir',
      '--x64',
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
        SEEKMORE_PACKAGE_KIND:
          'app',
        CSC_IDENTITY_AUTO_DISCOVERY:
          'false',
      },
    },
  );

  const appRoot =
    await findWinUnpacked(
      output.appOutputRoot,
      installerLock.productName,
    );

  const {
    resourcesRoot,
  } = await assertWindowsAppLayout(
    appRoot,
    installerLock.productName,
  );

  await copyVerifiedStageResources(
    stage.resourcesRoot,
    resourcesRoot,
  );

  const manifest = {
    schemaVersion: 1,
    product:
      installerLock.productName,
    version:
      rootPackage.version,
    target,
    arch: 'x64',
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
      await sha256File(
        stage.manifestPath,
      ),
    appRoot: path.relative(
      root,
      appRoot,
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
    `[Windows Package] App ready: ${appRoot}`,
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
  copyVerifiedStageResources,
};
