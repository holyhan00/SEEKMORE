const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  capture,
  ensureDirectory,
  ensureFile,
  repoRoot,
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

async function parseAttachPlist(
  xml,
) {
  const tempRoot = await fsp.mkdtemp(
    path.join(
      os.tmpdir(),
      'seekmore-macos-installer-plist-',
    ),
  );

  const plistPath = path.join(
    tempRoot,
    'attach.plist',
  );

  try {
    await fsp.writeFile(
      plistPath,
      xml,
      'utf8',
    );

    const {
      stdout,
    } = await capture(
      '/usr/bin/plutil',
      [
        '-convert',
        'json',
        '-o',
        '-',
        plistPath,
      ],
    );

    return JSON.parse(stdout);
  } finally {
    await fsp.rm(
      tempRoot,
      {
        recursive: true,
        force: true,
      },
    );
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error(
      '[macOS Verify] macOS DMG verification must run on macOS.',
    );
  }

  const root = repoRoot(__dirname);
  const target = currentTarget();

  const {
    installerLock,
    rootPackage,
    targetState,
  } = await assertInstallerContract(
    root,
    target,
  );

  const output = releasePaths(
    root,
    target,
  );

  const expectedName = dmgFileName(
    installerLock.productName,
    rootPackage.version,
    targetState.arch,
  );

  const dmgPath = path.join(
    output.installerOutputRoot,
    expectedName,
  );

  await ensureFile(
    dmgPath,
    'macOS DMG',
  );

  await ensureFile(
    output.installerManifestPath,
    'macOS installer manifest',
  );

  const manifest = JSON.parse(
    await fsp.readFile(
      output.installerManifestPath,
      'utf8',
    ),
  );

  const stat = await fsp.stat(
    dmgPath,
  );

  const actualSha256 = await sha256File(
    dmgPath,
  );

  if (
    manifest.product
      !== installerLock.productName
    || manifest.version
      !== rootPackage.version
    || manifest.target
      !== target
    || manifest.arch
      !== targetState.arch
    || manifest.appId
      !== installerLock.appId
  ) {
    throw new Error(
      '[macOS Verify] DMG manifest identity does not match the current installer contract.',
    );
  }

  if (
    manifest.artifactSize !== stat.size
    || manifest.artifactSha256
      !== actualSha256
  ) {
    throw new Error(
      '[macOS Verify] DMG artifact does not match installer-manifest.json.',
    );
  }

  const currentAppManifestSha256 =
    await sha256File(
      output.appManifestPath,
    );

  if (
    manifest.sourceAppManifestSha256
      !== currentAppManifestSha256
  ) {
    throw new Error(
      '[macOS Verify] DMG was not created from the currently verified app manifest.',
    );
  }

  await capture(
    '/usr/bin/hdiutil',
    [
      'verify',
      dmgPath,
    ],
  );

  let detachTarget = null;

  try {
    const {
      stdout,
    } = await capture(
      '/usr/bin/hdiutil',
      [
        'attach',
        '-readonly',
        '-nobrowse',
        '-plist',
        dmgPath,
      ],
    );

    const attached = await parseAttachPlist(
      stdout,
    );

    const entities = Array.isArray(
      attached['system-entities'],
    )
      ? attached['system-entities']
      : [];

    const mountedEntity = entities.find(
      (entity) =>
        entity
        && typeof entity === 'object'
        && typeof entity['mount-point']
          === 'string',
    );

    if (!mountedEntity) {
      throw new Error(
        '[macOS Verify] DMG mounted without a readable volume mount point.',
      );
    }

    const mountPoint =
      mountedEntity['mount-point'];

    detachTarget =
      typeof mountedEntity['dev-entry']
        === 'string'
        ? mountedEntity['dev-entry']
        : mountPoint;

    const mountedApp = path.join(
      mountPoint,
      `${installerLock.productName}.app`,
    );

    const applicationsLink = path.join(
      mountPoint,
      'Applications',
    );

    await ensureDirectory(
      mountedApp,
      'mounted SEEKMORE.app',
    );

    const linkStat = await fsp.lstat(
      applicationsLink,
    ).catch(
      () => null,
    );

    if (!linkStat?.isSymbolicLink()) {
      throw new Error(
        '[macOS Verify] DMG does not contain the Applications shortcut symlink.',
      );
    }

    const linkTarget = await fsp.readlink(
      applicationsLink,
    );

    if (linkTarget !== '/Applications') {
      throw new Error(
        `[macOS Verify] Applications shortcut points to ${linkTarget} instead of /Applications.`,
      );
    }

    await verifyMacosApp(
      root,
      target,
      {
        appBundle:
          mountedApp,
      },
    );
  } finally {
    if (detachTarget) {
      await capture(
        '/usr/bin/hdiutil',
        [
          'detach',
          detachTarget,
        ],
      ).catch(
        async () => {
          await capture(
            '/usr/bin/hdiutil',
            [
              'detach',
              '-force',
              detachTarget,
            ],
          ).catch(
            () => undefined,
          );
        },
      );
    }
  }

  console.log(
    `[macOS Verify] DMG contract verified: ${dmgPath}`,
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
