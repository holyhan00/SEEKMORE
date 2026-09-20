const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scriptsRoot = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'windows',
);

const distributionRoot = path.join(
  __dirname,
  '..',
  '..',
);

const {
  copyVerifiedStageResources,
} = require(
  '../../scripts/windows/package-app.cjs'
);

test(
  'Windows app packaging consumes only the verified symlink-free stage',
  () => {
    const source = fs.readFileSync(
      path.join(
        scriptsRoot,
        'package-app.cjs',
      ),
      'utf8',
    );

    const builder = fs.readFileSync(
      path.join(
        distributionRoot,
        'electron-builder.cjs',
      ),
      'utf8',
    );

    assert.match(
      source,
      /ensureVerifiedStage/,
    );
    assert.match(
      source,
      /electron-builder/,
    );
    assert.match(
      source,
      /'--win'/,
    );
    assert.match(
      source,
      /'dir'/,
    );
    assert.match(
      source,
      /copyVerifiedStageResources/,
    );
    assert.match(
      source,
      /node-linker=hoisted/,
    );
    assert.match(
      source,
      /Verified Windows Stage resources contain a filesystem link/,
    );

    assert.match(
      builder,
      /extraResources:\s*isMac/,
    );
    assert.match(
      builder,
      /from:\s*stage\.resourcesRoot/,
    );

    assert.doesNotMatch(
      source,
      /release:build|vendor-runtime|prisma generate/i,
    );
  },
);

test(
  'Windows verified resource copy preserves ordinary files without filesystem links',
  async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        'seekmore-windows-portable-copy-',
      ),
    );

    const sourceRoot = path.join(
      tempRoot,
      'stage-resources',
    );

    const destinationRoot = path.join(
      tempRoot,
      'app-resources',
    );

    try {
      const packageRoot = path.join(
        sourceRoot,
        'backend',
        'node_modules',
        'fixture',
      );

      fs.mkdirSync(
        packageRoot,
        {
          recursive: true,
        },
      );

      fs.writeFileSync(
        path.join(
          packageRoot,
          'index.js',
        ),
        'module.exports = 1;\n',
        'utf8',
      );

      await copyVerifiedStageResources(
        sourceRoot,
        destinationRoot,
      );

      const copied = path.join(
        destinationRoot,
        'backend',
        'node_modules',
        'fixture',
        'index.js',
      );

      assert.equal(
        fs.readFileSync(
          copied,
          'utf8',
        ),
        'module.exports = 1;\n',
      );

      fs.rmSync(
        sourceRoot,
        {
          recursive: true,
          force: true,
        },
      );

      assert.equal(
        fs.readFileSync(
          copied,
          'utf8',
        ),
        'module.exports = 1;\n',
      );
    } finally {
      fs.rmSync(
        tempRoot,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

test(
  'Windows verified resource copy rejects junctions or symlinks instead of rewriting dependency topology',
  async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        'seekmore-windows-portable-link-reject-',
      ),
    );

    const sourceRoot = path.join(
      tempRoot,
      'stage-resources',
    );

    const destinationRoot = path.join(
      tempRoot,
      'app-resources',
    );

    try {
      const targetRoot = path.join(
        sourceRoot,
        'backend',
        'node_modules',
        'real-package',
      );

      const alias = path.join(
        sourceRoot,
        'backend',
        'node_modules',
        'fixture',
      );

      fs.mkdirSync(
        targetRoot,
        {
          recursive: true,
        },
      );

      fs.writeFileSync(
        path.join(
          targetRoot,
          'index.js',
        ),
        'module.exports = 1;\n',
        'utf8',
      );

      fs.mkdirSync(
        path.dirname(alias),
        {
          recursive: true,
        },
      );

      fs.symlinkSync(
        targetRoot,
        alias,
        process.platform === 'win32'
          ? 'junction'
          : 'dir',
      );

      await assert.rejects(
        () =>
          copyVerifiedStageResources(
            sourceRoot,
            destinationRoot,
          ),
        /node-linker=hoisted/i,
      );
    } finally {
      fs.rmSync(
        tempRoot,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

test(
  'Windows NSIS installer consumes the verified unpacked app with --prepackaged',
  () => {
    const source = fs.readFileSync(
      path.join(
        scriptsRoot,
        'package-installer.cjs',
      ),
      'utf8',
    );

    assert.match(
      source,
      /ensureVerifiedWindowsApp/,
    );
    assert.match(
      source,
      /'--prepackaged'/,
    );
    assert.match(
      source,
      /'nsis'/,
    );
    assert.doesNotMatch(
      source,
      /release:build|vendor-runtime|prisma generate/i,
    );
  },
);

test(
  'Windows verifier exercises real runtime, rejects reparse-point leakage and validates install/reinstall persistence',
  () => {
    const appVerify = fs.readFileSync(
      path.join(
        scriptsRoot,
        'verify-app.cjs',
      ),
      'utf8',
    );

    const installerVerify = fs.readFileSync(
      path.join(
        scriptsRoot,
        'verify-installer.cjs',
      ),
      'utf8',
    );

    assert.match(
      appVerify,
      /runDesktopRuntimeSmoke/,
    );
    assert.match(
      appVerify,
      /immutable resources changed/i,
    );
    assert.match(
      appVerify,
      /assertNoPackagedReparsePoints/,
    );
    assert.match(
      appVerify,
      /Verified Windows Stage contains a filesystem link/,
    );
    assert.match(
      appVerify,
      /node-linker=hoisted/,
    );
    assert.match(
      appVerify,
      /fsp\.mkdir\(input\.output\.workRoot, \{ recursive: true \}\)/,
    );

    assert.match(
      installerVerify,
      /verifyInstallReinstallPersistence/,
    );
    assert.match(
      installerVerify,
      /fsp\.mkdir\(input\.output\.workRoot, \{ recursive: true \}\)/,
    );
    assert.match(
      installerVerify,
      /PostgreSQL data retained after uninstall/,
    );
    assert.match(
      installerVerify,
      /Runtime secrets were replaced across uninstall\/reinstall/,
    );
  },
);


test(
  'Windows release reuses verified Stage/App receipts without weakening explicit verification',
  () => {
    const packageApp = fs.readFileSync(
      path.join(scriptsRoot, 'package-app.cjs'),
      'utf8',
    );
    const verifyApp = fs.readFileSync(
      path.join(scriptsRoot, 'verify-app.cjs'),
      'utf8',
    );
    const packageInstaller = fs.readFileSync(
      path.join(scriptsRoot, 'package-installer.cjs'),
      'utf8',
    );
    const verifyInstaller = fs.readFileSync(
      path.join(scriptsRoot, 'verify-installer.cjs'),
      'utf8',
    );
    const receipt = fs.readFileSync(
      path.join(scriptsRoot, 'verification-receipt.cjs'),
      'utf8',
    );

    assert.match(packageApp, /ensureVerifiedStage/);
    assert.match(packageApp, /invalidateAppVerificationReceipt/);
    assert.match(verifyApp, /writeAppVerificationReceipt/);
    assert.match(verifyApp, /ensureVerifiedWindowsApp/);
    assert.match(verifyApp, /skipping duplicate full App resource SHA256 verification and runtime smoke/);
    assert.match(packageInstaller, /ensureVerifiedWindowsApp/);
    assert.match(verifyInstaller, /ensureVerifiedWindowsApp/);
    assert.match(receipt, /stageManifestSha256/);
    assert.match(receipt, /appManifestSha256/);
    assert.match(receipt, /runtimeLockSha256/);
    assert.match(receipt, /installerLockSha256/);
    assert.match(receipt, /pnpmLockSha256/);
  },
);

test(
  'Windows installer verifier waits for delegated NSIS completion and preserves failure evidence',
  () => {
    const source = fs.readFileSync(
      path.join(scriptsRoot, 'verify-installer.cjs'),
      'utf8',
    );

    assert.match(source, /waitForStableInstalledLayout/);
    assert.match(source, /NSIS_INSTALL_TIMEOUT_MS = 60 \* 60_000/);
    assert.match(source, /NSIS_LAYOUT_POLL_MS = 5_000/);
    assert.match(source, /Promise\.all\(\[/);
    assert.match(source, /stableSamples >= NSIS_LAYOUT_STABLE_SAMPLES/);
    assert.match(source, /launcher exited with code/);
    assert.match(source, /Failure artifacts preserved/);
    assert.match(source, /acquireInstallerSmokeLock/);
    assert.match(source, /windows-installer-smoke\.lock/);
    assert.match(source, /if \(succeeded\)[\s\S]{0,220}fsp\.rm\(smokeRoot/);
    assert.match(source, /waitForPathRemoval\(installDir, 120_000\)/);
  },
);

test(
  'Windows runtime smoke enforces Backend cold-start quality while Desktop keeps a larger watchdog ceiling',
  () => {
    const platformSource = fs.readFileSync(
      path.join(scriptsRoot, 'platform-lib.cjs'),
      'utf8',
    );
    const desktopMain = fs.readFileSync(
      path.join(distributionRoot, '..', 'desktop', 'src', 'main', 'index.ts'),
      'utf8',
    );

    assert.match(platformSource, /maxBackendReadyMs = input\.maxBackendReadyMs \?\? 60_000/);
    assert.match(platformSource, /Windows Backend cold start/);
    assert.match(platformSource, /120s Desktop watchdog is a safety ceiling/);
    assert.match(desktopMain, /backendReadyMs/);
    assert.match(desktopMain, /runtimeReadyMs/);
    assert.match(desktopMain, /WINDOWS_PACKAGED_BACKEND_HEALTH_TIMEOUT_MS = 120_000/);
  },
);
