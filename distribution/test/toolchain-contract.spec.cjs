const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { repoRoot } = require('../scripts/distribution-lib.cjs');
const { loadInstallerLock } = require('../scripts/packaging-lib.cjs');

const root = repoRoot(path.join(__dirname, '..', 'scripts'));
const runtimeLock = JSON.parse(
  fs.readFileSync(path.join(root, 'distribution', 'runtime-lock.json'), 'utf8'),
);
const installerLock = loadInstallerLock(root);
const desktopPackage = JSON.parse(
  fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'),
);

const rootPackage = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);

test('desktop release toolchain is pinned to Node 24 and Electron 43', () => {
  assert.equal(runtimeLock.node.version, '24.19.0');
  assert.equal(desktopPackage.engines?.node, runtimeLock.node.version);
  assert.equal(desktopPackage.engines?.pnpm, '10.6.5');

  assert.equal(installerLock.electron, '43.4.0');
  assert.equal(desktopPackage.devDependencies?.electron, installerLock.electron);
  assert.match(
    String(desktopPackage.devDependencies?.['@types/node'] ?? ''),
    /^(?:\^|~)?24(?:\.|$)/,
  );
});

test('packaging toolchain remains exact and Windows x64 stays enabled', () => {
  assert.equal(installerLock.electronBuilder, '26.15.6');
  assert.equal(installerLock.windows.targets['win32-x64'].enabled, true);
  assert.equal(installerLock.windows.targets['win32-x64'].arch, 'x64');
  assert.equal(installerLock.windows.targets['win32-x64'].installer, 'nsis');
});


test('Windows Backend compaction toolchain pins esbuild directly at the workspace root', () => {
  assert.equal(rootPackage.devDependencies?.esbuild, '0.28.1');
  assert.ok(rootPackage.pnpm?.onlyBuiltDependencies?.includes('esbuild'));

  const lockSource = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  assert.match(
    lockSource,
    /\n  \.:\n    devDependencies:[\s\S]{0,260}esbuild:\n        specifier: 0\.28\.1\n        version: 0\.28\.1/,
  );
});
