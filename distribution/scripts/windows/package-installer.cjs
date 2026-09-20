const fsp = require('node:fs/promises');
const path = require('node:path');

const {
  assertNativeTarget,
  assertReleaseToolchain,
  ensureFile,
  pnpmCommand,
  repoRoot,
  run,
} = require('../distribution-lib.cjs');

const {
  assertInstallerContract,
  currentTarget,
  releasePaths,
  sha256File,
  windowsInstallerFileName,
} = require('../packaging-lib.cjs');

const { ensureVerifiedWindowsApp } = require('./verify-app.cjs');

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('[Windows Package] NSIS packaging must run on Windows.');
  }

  const root = repoRoot(__dirname);
  const target = currentTarget();
  assertNativeTarget(target);
  await assertReleaseToolchain(root);

  const { installerLock, rootPackage, targetState } = await assertInstallerContract(root, target);
  const { appRoot } = await ensureVerifiedWindowsApp(root, target);
  const output = releasePaths(root, target);

  await fsp.rm(output.installerOutputRoot, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  await fsp.mkdir(output.installerOutputRoot, { recursive: true });

  console.log(`[Windows Package] Creating NSIS installer from verified app: ${appRoot}`);

  await run(
    pnpmCommand(),
    [
      'exec',
      'electron-builder',
      '--win',
      'nsis',
      '--x64',
      '--prepackaged',
      appRoot,
      '--publish',
      'never',
      '--config',
      'distribution/electron-builder.cjs',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        SEEKMORE_RELEASE_TARGET: target,
        SEEKMORE_PACKAGE_KIND: 'installer',
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      },
    },
  );

  const expectedName = windowsInstallerFileName(
    installerLock.productName,
    rootPackage.version,
    targetState.arch,
  );
  const installerPath = path.join(output.installerOutputRoot, expectedName);
  await ensureFile(installerPath, 'Windows NSIS installer');

  const stat = await fsp.stat(installerPath);
  const manifest = {
    schemaVersion: 1,
    product: installerLock.productName,
    version: rootPackage.version,
    target,
    arch: targetState.arch,
    appId: installerLock.appId,
    sourceApp: path.relative(root, appRoot),
    sourceAppManifestSha256: await sha256File(output.appManifestPath),
    artifactType: 'exe',
    installerType: 'nsis',
    signed: false,
    artifact: path.relative(root, installerPath),
    artifactSize: stat.size,
    artifactSha256: await sha256File(installerPath),
  };

  await fsp.writeFile(output.installerManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`[Windows Package] NSIS installer ready: ${installerPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
