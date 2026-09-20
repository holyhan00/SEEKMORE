const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  ensureFile,
  repoRoot,
  stagePaths,
  targetKey,
} = require('./distribution-lib.cjs');

function loadInstallerLock(root) {
  const file = path.join(
    root,
    'distribution',
    'installer-lock.json',
  );

  return JSON.parse(
    fs.readFileSync(file, 'utf8'),
  );
}

function releasePaths(root, target) {
  const releaseRoot = path.join(
    root,
    'distribution',
    'release',
    target,
  );

  const workRoot = path.join(
    releaseRoot,
    '.work',
  );

  return {
    releaseRoot,
    workRoot,
    appOutputRoot: path.join(
      releaseRoot,
      'app',
    ),
    installerOutputRoot: path.join(
      releaseRoot,
      'installer',
    ),
    buildResourcesRoot: path.join(
      workRoot,
      'build-resources',
    ),
    appManifestPath: path.join(
      releaseRoot,
      'app-manifest.json',
    ),
    installerManifestPath: path.join(
      releaseRoot,
      'installer-manifest.json',
    ),
  };
}

function platformForTarget(target) {
  if (target.startsWith('darwin-')) return 'macOS';
  if (target.startsWith('win32-')) return 'windows';

  throw new Error(
    `[Packaging] Unsupported installer target: ${target}`,
  );
}

function assertInstallerTargetEnabled(
  lock,
  target,
) {
  const platform = platformForTarget(target);
  const state =
    platform === 'macOS'
      ? lock.macOS?.targets?.[target]
      : lock.windows?.targets?.[target];

  if (!state) {
    throw new Error(
      `[Packaging] Installer lock has no ${platform} target entry for ${target}.`,
    );
  }

  if (state.enabled !== true) {
    throw new Error(
      `[Packaging] ${target} installer target is disabled.`,
    );
  }

  return {
    platform,
    state,
  };
}

async function assertInstallerContract(
  root,
  target,
) {
  const installerLock =
    loadInstallerLock(root);

  const runtimeLock = JSON.parse(
    await fsp.readFile(
      path.join(
        root,
        'distribution',
        'runtime-lock.json',
      ),
      'utf8',
    ),
  );

  const rootPackage = JSON.parse(
    await fsp.readFile(
      path.join(root, 'package.json'),
      'utf8',
    ),
  );

  const desktopPackage = JSON.parse(
    await fsp.readFile(
      path.join(
        root,
        'desktop',
        'package.json',
      ),
      'utf8',
    ),
  );

  const {
    platform,
    state: targetState,
  } = assertInstallerTargetEnabled(
    installerLock,
    target,
  );

  if (
    installerLock.generatedForRelease
    !== rootPackage.version
  ) {
    throw new Error(
      `[Packaging] installer-lock generatedForRelease=${String(
        installerLock.generatedForRelease,
      )} does not match root release version ${String(
        rootPackage.version,
      )}.`,
    );
  }

  if (
    installerLock.product !== 'SEEKMORE'
    || installerLock.productName
      !== 'SEEKMORE'
  ) {
    throw new Error(
      '[Packaging] Installer identity must use SEEKMORE.',
    );
  }

  if (
    !/^[a-z0-9]+(?:\.[a-z0-9-]+){2,}$/i.test(
      String(installerLock.appId || ''),
    )
  ) {
    throw new Error(
      `[Packaging] Invalid reverse-DNS appId: ${String(
        installerLock.appId,
      )}.`,
    );
  }

  const desktopElectron = String(
    desktopPackage.devDependencies
      ?.electron || '',
  );

  if (
    desktopElectron
    !== installerLock.electron
  ) {
    throw new Error(
      `[Packaging] Desktop Electron ${desktopElectron || 'missing'} does not match installer lock ${String(
        installerLock.electron,
      )}.`,
    );
  }

  if (platform === 'macOS') {
    if (
      installerLock.macOS
        ?.minimumSystemVersion
      !== runtimeLock.platformPolicy
        ?.macOSMinimumVersion
    ) {
      throw new Error(
        '[Packaging] Installer macOS minimum version must exactly match runtime platform policy.',
      );
    }

    if (
      target !== `darwin-${targetState.arch}`
    ) {
      throw new Error(
        `[Packaging] Installer target ${target} does not match configured architecture ${String(
          targetState.arch,
        )}.`,
      );
    }
  } else {
    if (
      installerLock.windows
        ?.minimumSystemVersion
      !== runtimeLock.platformPolicy
        ?.windowsMinimumVersion
    ) {
      throw new Error(
        '[Packaging] Installer Windows minimum version must exactly match runtime platform policy.',
      );
    }

    if (
      target !== `win32-${targetState.arch}`
    ) {
      throw new Error(
        `[Packaging] Installer target ${target} does not match configured architecture ${String(
          targetState.arch,
        )}.`,
      );
    }

    if (targetState.installer !== 'nsis') {
      throw new Error(
        `[Packaging] Windows installer for ${target} must be NSIS.`,
      );
    }
  }

  const builderPackagePath =
    path.join(
      root,
      'node_modules',
      'electron-builder',
      'package.json',
    );

  await ensureFile(
    builderPackagePath,
    'electron-builder package',
  );

  const builderPackage = JSON.parse(
    await fsp.readFile(
      builderPackagePath,
      'utf8',
    ),
  );

  if (
    builderPackage.version
    !== installerLock.electronBuilder
  ) {
    throw new Error(
      `[Packaging] electron-builder ${String(
        builderPackage.version,
      )} does not match installer lock ${String(
        installerLock.electronBuilder,
      )}.`,
    );
  }

  return {
    installerLock,
    runtimeLock,
    rootPackage,
    desktopPackage,
    platform,
    targetState,
  };
}

async function sha256File(file) {
  const hash =
    crypto.createHash('sha256');

  await new Promise(
    (resolve, reject) => {
      const stream =
        fs.createReadStream(file);

      stream.on(
        'data',
        (chunk) => {
          hash.update(chunk);
        },
      );

      stream.once(
        'error',
        reject,
      );

      stream.once(
        'end',
        resolve,
      );
    },
  );

  return hash.digest('hex');
}

function currentTarget() {
  const value =
    process.env.SEEKMORE_RELEASE_TARGET
    || targetKey();

  platformForTarget(value);
  return value;
}

function windowsInstallerFileName(
  productName,
  version,
  arch,
) {
  return `${productName}-${version}-win-${arch}.exe`;
}

module.exports = {
  assertInstallerContract,
  assertInstallerTargetEnabled,
  currentTarget,
  loadInstallerLock,
  platformForTarget,
  releasePaths,
  repoRoot,
  sha256File,
  stagePaths,
  windowsInstallerFileName,
};
