const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  loadInstallerLock,
  releasePaths,
  windowsInstallerFileName,
} = require('../scripts/packaging-lib.cjs');
const { repoRoot } = require('../scripts/distribution-lib.cjs');

const root = repoRoot(path.join(__dirname, '..', 'scripts'));
const installerLock = loadInstallerLock(root);
const runtimeLock = JSON.parse(fs.readFileSync(path.join(root, 'distribution', 'runtime-lock.json'), 'utf8'));
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'));

test('installer identity and tool versions are release-pinned', () => {
  assert.equal(installerLock.generatedForRelease, rootPackage.version);
  assert.equal(installerLock.product, 'SEEKMORE');
  assert.equal(installerLock.productName, 'SEEKMORE');
  assert.equal(installerLock.appId, 'ai.seekmore.desktop');
  assert.match(installerLock.appId, /^[a-z0-9]+(?:\.[a-z0-9-]+){2,}$/i);
  assert.equal(installerLock.electron, '43.4.0');
  assert.equal(desktopPackage.devDependencies.electron, installerLock.electron);
  assert.equal(installerLock.electronBuilder, '26.15.6');
});

test('platform installer policies share runtime minimum-version locks', () => {
  assert.equal(installerLock.macOS.minimumSystemVersion, runtimeLock.platformPolicy.macOSMinimumVersion);
  assert.equal(installerLock.windows.minimumSystemVersion, runtimeLock.platformPolicy.windowsMinimumVersion);
  assert.equal(installerLock.macOS.targets['darwin-arm64'].enabled, true);
  assert.equal(installerLock.macOS.targets['darwin-x64'].enabled, false);
  assert.equal(installerLock.windows.targets['win32-x64'].enabled, true);
  assert.equal(installerLock.windows.targets['win32-x64'].installer, 'nsis');
  assert.equal(installerLock.windows.targets['win32-x64'].signed, false);
});

test('release output no longer contains historical phase directories', () => {
  for (const target of ['darwin-arm64', 'win32-x64']) {
    const p = releasePaths('/repo', target);
    const releaseRoot = path.join('/repo', 'distribution', 'release', target);
    assert.equal(p.releaseRoot, releaseRoot);
    assert.equal(p.appOutputRoot, path.join(releaseRoot, 'app'));
    assert.equal(p.installerOutputRoot, path.join(releaseRoot, 'installer'));
    assert.equal(p.appManifestPath, path.join(releaseRoot, 'app-manifest.json'));
    assert.equal(p.installerManifestPath, path.join(releaseRoot, 'installer-manifest.json'));
  }
});

test('Windows installer filename is deterministic', () => {
  assert.equal(
    windowsInstallerFileName('SEEKMORE', '1.0.0', 'x64'),
    'SEEKMORE-1.0.0-win-x64.exe',
  );
  assert.equal(
    installerLock.windows.targets['win32-x64'].artifactName,
    'SEEKMORE-1.0.0-win-x64.exe',
  );
});

test('electron-builder consumes stage resources and never rebuilds runtime dependencies', () => {
  const source = fs.readFileSync(path.join(root, 'distribution', 'electron-builder.cjs'), 'utf8');
  assert.match(source, /app:\s*stage\.appRoot/);
  assert.match(source, /from:\s*stage\.resourcesRoot/);
  assert.match(source, /asar:\s*true/);
  assert.match(source, /npmRebuild:\s*false/);
  assert.match(source, /target:[\s\S]*'nsis'/);
  assert.match(source, /deleteAppDataOnUninstall:\s*false/);
  assert.doesNotMatch(source, /prisma generate|pnpm build|vendor-runtime/i);
});
