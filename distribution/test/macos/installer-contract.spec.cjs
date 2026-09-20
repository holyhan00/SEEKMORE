const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { releasePaths } = require('../../scripts/packaging-lib.cjs');
const { dmgFileName } = require('../../scripts/macos/platform-lib.cjs');

test('macOS installer paths use the shared target release root', () => {
  const p = releasePaths('/repo', 'darwin-arm64');
  const releaseRoot = path.join('/repo', 'distribution', 'release', 'darwin-arm64');
  assert.equal(p.installerOutputRoot, path.join(releaseRoot, 'installer'));
  assert.equal(p.installerManifestPath, path.join(releaseRoot, 'installer-manifest.json'));
});

test('macOS DMG filename remains deterministic', () => {
  assert.equal(dmgFileName('SEEKMORE', '1.0.0', 'arm64'), 'SEEKMORE-1.0.0-arm64.dmg');
});

test('macOS installer consumes the verified app without rebuilding it', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'macos', 'package-installer.cjs'), 'utf8');
  assert.match(source, /verifyMacosApp/);
  assert.match(source, /\/usr\/bin\/ditto/);
  assert.match(source, /\/usr\/bin\/hdiutil/);
  assert.match(source, /'\/Applications'/);
  assert.doesNotMatch(source, /electron-builder/);
  assert.doesNotMatch(source, /release:build|pnpm\s+build/);
});

test('macOS installer verifier mounts read-only and reuses the app contract', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'macos', 'verify-installer.cjs'), 'utf8');
  assert.match(source, /'verify'/);
  assert.match(source, /'attach'/);
  assert.match(source, /'-readonly'/);
  assert.match(source, /'detach'/);
  assert.match(source, /verifyMacosApp/);
  assert.match(source, /Applications shortcut/);
});
