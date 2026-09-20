const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
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
  assertWindowsAppLayout,
  findWinUnpacked,
  runDesktopRuntimeSmoke,
} = require('./platform-lib.cjs');

const { ensureVerifiedStage } = require('../verify-stage.cjs');
const {
  readValidAppVerificationReceipt,
  writeAppVerificationReceipt,
} = require('./verification-receipt.cjs');

async function assertNoPackagedReparsePoints(root) {
  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const stat = await fsp.lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `[Windows Verify] Packaged app still contains a filesystem link into build-time resources: ${absolute}`,
        );
      }
      if (stat.isDirectory()) {
        await walk(absolute);
      }
    }
  }

  await walk(root);
}

async function verifyWindowsApp(root, target, options = {}) {
  if (process.platform !== 'win32') {
    throw new Error('[Windows Verify] Windows app verification must run on Windows.');
  }
  if (target !== 'win32-x64') {
    throw new Error(`[Windows Verify] First release supports win32-x64 only, got ${target}.`);
  }

  const { installerLock, rootPackage, targetState } = await assertInstallerContract(root, target);
  const stage = stagePaths(root, target);
  await ensureVerifiedStage(root, target);

  const output = releasePaths(root, target);
  const appRoot = options.appRoot
    ? path.resolve(options.appRoot)
    : await findWinUnpacked(output.appOutputRoot, installerLock.productName);

  const { executablePath, resourcesRoot } = await assertWindowsAppLayout(
    appRoot,
    installerLock.productName,
  );

  await assertPackagedResources(stage.manifestPath, resourcesRoot);
  await assertNoPackagedReparsePoints(resourcesRoot);
  await assertAppManifest(output.appManifestPath, stage.manifestPath, {
    product: installerLock.productName,
    version: rootPackage.version,
    target,
    arch: targetState.arch,
    appId: installerLock.appId,
  });

  if (options.runtimeSmoke !== false) {
    await runRealRuntimeSmoke({
      executablePath,
      resourcesRoot,
      stageManifestPath: stage.manifestPath,
      output,
    });

    await writeAppVerificationReceipt(
      root,
      target,
    );
    console.log('[Windows Verify] Wrote verified App receipt.');
  }

  console.log(`[Windows Verify] App contract verified: ${appRoot}`);
  return { appRoot, executablePath, resourcesRoot, installerLock, rootPackage, targetState };
}

async function ensureVerifiedWindowsApp(root, target) {
  const receipt = await readValidAppVerificationReceipt(
    root,
    target,
  );

  if (!receipt) {
    return verifyWindowsApp(root, target);
  }

  const { installerLock, rootPackage, targetState } =
    await assertInstallerContract(root, target);
  const output = releasePaths(root, target);
  const appRoot = await findWinUnpacked(
    output.appOutputRoot,
    installerLock.productName,
  );
  const { executablePath, resourcesRoot } =
    await assertWindowsAppLayout(
      appRoot,
      installerLock.productName,
    );

  console.log('[Windows Verify] Reusing verified App receipt; skipping duplicate full App resource SHA256 verification and runtime smoke.');
  return {
    appRoot,
    executablePath,
    resourcesRoot,
    installerLock,
    rootPackage,
    targetState,
  };
}

async function assertPackagedResources(stageManifestPath, resourcesRoot) {
  const manifest = JSON.parse(await fsp.readFile(stageManifestPath, 'utf8'));
  const entries = manifest.files.filter((entry) => String(entry.path).startsWith('resources/'));
  if (entries.length === 0) {
    throw new Error('[Windows Verify] Stage manifest contains no immutable resources.');
  }

  for (const entry of entries) {
    const relative = String(entry.path).slice('resources/'.length);
    const destination = path.join(resourcesRoot, ...relative.split('/'));
    const stat = await fsp.lstat(destination).catch(() => null);
    if (!stat) throw new Error(`[Windows Verify] Stage resource is missing from app: ${relative}`);

    if (entry.type === 'file') {
      if (!stat.isFile()) throw new Error(`[Windows Verify] Stage file changed type in app: ${relative}`);
      if (stat.size !== entry.size) throw new Error(`[Windows Verify] Stage resource size changed in app: ${relative}`);
      const hash = await sha256File(destination);
      if (hash !== entry.sha256) throw new Error(`[Windows Verify] Stage resource hash changed in app: ${relative}`);
      continue;
    }

    if (entry.type === 'symlink') {
      throw new Error(
        `[Windows Verify] Verified Windows Stage contains a filesystem link: ${relative}. Windows backend deployment must use pnpm node-linker=hoisted before app packaging.`,
      );
    }

    throw new Error(
      `[Windows Verify] Unsupported Stage inventory type for ${relative}: ${String(entry.type)}`,
    );
  }
}

async function assertAppManifest(appManifestPath, stageManifestPath, expected) {
  const manifest = JSON.parse(await fsp.readFile(appManifestPath, 'utf8'));
  for (const [key, value] of Object.entries(expected)) {
    if (manifest[key] !== value) {
      throw new Error(`[Windows Verify] app-manifest.json ${key}=${String(manifest[key])} does not match ${String(value)}.`);
    }
  }
  const stageHash = await sha256File(stageManifestPath);
  if (manifest.sourceStageManifestSha256 !== stageHash) {
    throw new Error('[Windows Verify] App was not packaged from the current verified stage manifest.');
  }
}

async function runRealRuntimeSmoke(input) {
  await fsp.mkdir(input.output.workRoot, { recursive: true });
  const smokeRoot = await fsp.mkdtemp(path.join(input.output.workRoot, 'windows-runtime-smoke-'));
  const localAppData = path.join(smokeRoot, 'LocalAppData');
  const roamingAppData = path.join(smokeRoot, 'AppData');
  const resultPath = path.join(smokeRoot, 'runtime-result.json');

  const beforeMetadata = await immutableResourcesMetadataFingerprint(
    input.resourcesRoot,
    input.stageManifestPath,
  );

  await runDesktopRuntimeSmoke({
    executablePath: input.executablePath,
    localAppData,
    roamingAppData,
    resultPath,
  });

  const afterMetadata = await immutableResourcesMetadataFingerprint(
    input.resourcesRoot,
    input.stageManifestPath,
  );
  if (beforeMetadata !== afterMetadata) {
    throw new Error('[Windows Verify] Packaged immutable resources changed during runtime smoke.');
  }

  await fsp.rm(smokeRoot, { recursive: true, force: true });
}

async function immutableResourcesMetadataFingerprint(
  resourcesRoot,
  stageManifestPath,
) {
  const manifest = JSON.parse(
    await fsp.readFile(stageManifestPath, 'utf8'),
  );
  const rows = [];
  for (const entry of manifest.files.filter(
    (item) =>
      String(item.path).startsWith('resources/')
      && item.type === 'file',
  )) {
    const relative = String(entry.path).slice('resources/'.length);
    const file = path.join(resourcesRoot, ...relative.split('/'));
    const stat = await fsp.stat(file);
    rows.push(
      `${relative}\0${stat.size}\0${stat.mtimeMs}\0${stat.ctimeMs}`,
    );
  }
  rows.sort();
  return crypto
    .createHash('sha256')
    .update(rows.join('\n'))
    .digest('hex');
}

async function main() {
  const root = repoRoot(__dirname);
  const target = currentTarget();
  await verifyWindowsApp(root, target);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  assertNoPackagedReparsePoints,
  ensureVerifiedWindowsApp,
  verifyWindowsApp,
};
