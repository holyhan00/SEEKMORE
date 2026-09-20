const fs = require('node:fs');
const path = require('node:path');

const {
  currentTarget,
  loadInstallerLock,
  releasePaths,
  stagePaths,
} = require('./scripts/packaging-lib.cjs');

const root = path.resolve(
  __dirname,
  '..',
);

const target = currentTarget();
const installerLock =
  loadInstallerLock(root);
const stage = stagePaths(root, target);
const output = releasePaths(root, target);
const packageKind =
  process.env.SEEKMORE_PACKAGE_KIND === 'installer'
    ? 'installer'
    : 'app';

const isMac = target.startsWith('darwin-');
const isWindows = target === 'win32-x64';
const targetState = isMac
  ? installerLock.macOS?.targets?.[target]
  : installerLock.windows?.targets?.[target];

if (!targetState?.enabled) {
  throw new Error(
    `[Packaging] Target ${target} is not enabled in installer-lock.json.`,
  );
}

const config = {
  appId: installerLock.appId,
  productName: installerLock.productName,
  electronVersion: installerLock.electron,

  directories: {
    app: stage.appRoot,
    output:
      isWindows && packageKind === 'installer'
        ? output.installerOutputRoot
        : output.appOutputRoot,
    buildResources: stage.packagingRoot,
  },

  files: [
    '**/*',
  ],

  // macOS keeps the already-verified Stage resource copy path unchanged.
  // Windows injects verified Stage resources after electron-builder finishes,
  // because pnpm uses absolute NTFS junctions that must not leak into the
  // portable win-unpacked app.
  extraResources: isMac
    ? [
      {
        from: stage.resourcesRoot,
        to: '.',
        filter: [
          '**/*',
        ],
      },
    ]
    : [],

  asar: true,
  npmRebuild: false,
};

if (isMac) {
  Object.assign(config, {
    forceCodeSigning: true,
    mac: {
      target: [
        {
          target: 'dir',
          arch: [targetState.arch],
        },
      ],
      icon: path.join(
        stage.packagingRoot,
        'app-icons',
        'mac',
        'SEEKMORE.png',
      ),
      minimumSystemVersion:
        installerLock.macOS.minimumSystemVersion,
      identity: '-',
      hardenedRuntime: false,
      notarize: false,
    },
  });
}

if (isWindows) {
  Object.assign(config, {
    win: {
      target: [
        {
          target:
            packageKind === 'installer'
              ? 'nsis'
              : 'dir',
          arch: [targetState.arch],
        },
      ],
      icon: (() => {
        const iconRoot = path.join(
          stage.packagingRoot,
          'app-icons',
          'win',
        );
        const ico = path.join(iconRoot, 'SEEKMORE.ico');
        return fs.existsSync(ico)
          ? ico
          : path.join(iconRoot, 'SEEKMORE.png');
      })(),
      artifactName: targetState.artifactName,
      signAndEditExecutable: true,
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: installerLock.productName,
    },
  });
}

module.exports = config;
