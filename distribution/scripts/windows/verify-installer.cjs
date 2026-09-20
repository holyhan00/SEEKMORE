const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');

const {
  ensureFile,
  readPeMachine,
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

const NSIS_INSTALL_TIMEOUT_MS = 60 * 60_000;
const NSIS_LAYOUT_POLL_MS = 5_000;
const NSIS_LAYOUT_STABLE_SAMPLES = 4;
const {
  assertWindowsAppLayout,
  isProcessAlive,
  runDesktopRuntimeSmoke,
} = require('./platform-lib.cjs');

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('[Windows Verify] NSIS verification must run on Windows.');
  }

  const root = repoRoot(__dirname);
  const target = currentTarget();
  const { installerLock, rootPackage, targetState } = await assertInstallerContract(root, target);
  await ensureVerifiedWindowsApp(root, target);

  const output = releasePaths(root, target);
  const expectedName = windowsInstallerFileName(
    installerLock.productName,
    rootPackage.version,
    targetState.arch,
  );
  const installerPath = path.join(output.installerOutputRoot, expectedName);
  await Promise.all([
    ensureFile(installerPath, 'Windows NSIS installer'),
    ensureFile(output.installerManifestPath, 'Windows installer manifest'),
  ]);
  const installerMachine = await readPeMachine(installerPath);
  // NSIS may use an x86 bootstrap executable even when the packaged app and
  // every native runtime payload are x64. The application contract is x64;
  // here we only require the installer itself to be a valid Windows PE.
  if (![0x014c, 0x8664].includes(installerMachine)) {
    throw new Error(
      `[Windows Verify] NSIS installer has unsupported PE machine 0x${installerMachine.toString(16)}.`,
    );
  }

  const manifest = JSON.parse(await fsp.readFile(output.installerManifestPath, 'utf8'));
  const stat = await fsp.stat(installerPath);
  const hash = await sha256File(installerPath);
  const appManifestHash = await sha256File(output.appManifestPath);

  const identityMatches =
    manifest.product === installerLock.productName
    && manifest.version === rootPackage.version
    && manifest.target === target
    && manifest.arch === targetState.arch
    && manifest.appId === installerLock.appId
    && manifest.artifactType === 'exe'
    && manifest.installerType === 'nsis'
    && manifest.signed === false;
  if (!identityMatches) {
    throw new Error('[Windows Verify] installer-manifest.json identity does not match the release contract.');
  }
  if (manifest.artifactSize !== stat.size || manifest.artifactSha256 !== hash) {
    throw new Error('[Windows Verify] NSIS installer does not match installer-manifest.json.');
  }
  if (manifest.sourceAppManifestSha256 !== appManifestHash) {
    throw new Error('[Windows Verify] NSIS installer was not created from the currently verified app manifest.');
  }

  await verifyInstallReinstallPersistence({
    installerPath,
    output,
    productName: installerLock.productName,
  });

  console.log(`[Windows Verify] NSIS installer contract and install lifecycle verified: ${installerPath}`);
}


async function verifyInstallReinstallPersistence(input) {
  await fsp.mkdir(input.output.workRoot, { recursive: true });
  const releaseLock = await acquireInstallerSmokeLock(input.output.workRoot);
  const smokeRoot = await fsp.mkdtemp(
    path.join(input.output.workRoot, 'windows-install-smoke-'),
  );
  const installDir = path.join(smokeRoot, 'Install', input.productName);
  const localAppData = path.join(smokeRoot, 'LocalAppData');
  const roamingAppData = path.join(smokeRoot, 'AppData');
  const environment = {
    ...process.env,
    LOCALAPPDATA: localAppData,
    APPDATA: roamingAppData,
  };

  let succeeded = false;
  try {
    await installNsis(input.installerPath, installDir, environment);
    const executablePath = path.join(installDir, `${input.productName}.exe`);
    await assertWindowsAppLayout(installDir, input.productName);

    await runDesktopRuntimeSmoke({
      executablePath,
      localAppData,
      roamingAppData,
      resultPath: path.join(smokeRoot, 'first-runtime.json'),
    });

    const dataHome = path.join(localAppData, 'SEEKMORE');
    const pgVersionPath = path.join(dataHome, 'database', 'postgres', 'PG_VERSION');
    const secretsPath = path.join(dataHome, 'secrets', 'runtime-secrets.json');
    await Promise.all([
      ensureFile(pgVersionPath, 'persisted PostgreSQL PG_VERSION'),
      ensureFile(secretsPath, 'persisted runtime secrets'),
    ]);
    const pgVersionBefore = await fsp.readFile(pgVersionPath, 'utf8');
    const secretsHashBefore = await sha256File(secretsPath);

    const uninstaller = await findUninstaller(installDir);
    await run(uninstaller, ['/S'], { env: environment });
    await waitForPathRemoval(installDir, 120_000);

    await Promise.all([
      ensureFile(pgVersionPath, 'PostgreSQL data retained after uninstall'),
      ensureFile(secretsPath, 'runtime secrets retained after uninstall'),
    ]);

    await installNsis(input.installerPath, installDir, environment);
    await assertWindowsAppLayout(installDir, input.productName);

    await runDesktopRuntimeSmoke({
      executablePath: path.join(installDir, `${input.productName}.exe`),
      localAppData,
      roamingAppData,
      resultPath: path.join(smokeRoot, 'second-runtime.json'),
    });

    const pgVersionAfter = await fsp.readFile(pgVersionPath, 'utf8');
    const secretsHashAfter = await sha256File(secretsPath);
    if (pgVersionAfter !== pgVersionBefore) {
      throw new Error('[Windows Verify] PostgreSQL data identity changed across uninstall/reinstall.');
    }
    if (secretsHashAfter !== secretsHashBefore) {
      throw new Error('[Windows Verify] Runtime secrets were replaced across uninstall/reinstall.');
    }

    const finalUninstaller = await findUninstaller(installDir);
    await run(finalUninstaller, ['/S'], { env: environment });
    await waitForPathRemoval(installDir, 120_000);

    await Promise.all([
      ensureFile(pgVersionPath, 'PostgreSQL data retained after final uninstall'),
      ensureFile(secretsPath, 'runtime secrets retained after final uninstall'),
    ]);

    succeeded = true;
  } catch (error) {
    console.error(`[Windows Verify] Failure artifacts preserved: ${smokeRoot}`);
    throw error;
  } finally {
    await releaseLock();
    if (succeeded) {
      await fsp.rm(smokeRoot, {
        recursive: true,
        force: true,
        maxRetries: 12,
        retryDelay: 250,
      });
    }
  }
}

async function installNsis(installerPath, installDir, environment) {
  await fsp.mkdir(path.dirname(installDir), { recursive: true });

  const child = spawn(
    installerPath,
    ['/S', `/D=${installDir}`],
    {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout = `${stdout}${String(chunk)}`.slice(-64 * 1024);
  });
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-64 * 1024);
  });

  const installStartedAt = Date.now();
  const launcherExitPromise = waitForChildExit(child, NSIS_INSTALL_TIMEOUT_MS);
  const layoutPromise = waitForStableInstalledLayout(
    installDir,
    NSIS_INSTALL_TIMEOUT_MS,
    installStartedAt,
  );

  let launcherExit;
  try {
    [launcherExit] = await Promise.all([
      launcherExitPromise,
      layoutPromise,
    ]);
  } catch (error) {
    throw new Error(
      `[Windows Verify] NSIS install did not complete within the release verification window. launcherPid=${String(child.pid || 'unknown')} launcherExit=${String(child.exitCode)} elapsedMs=${Date.now() - installStartedAt} stdout=${stdout.trim()} stderr=${stderr.trim()} cause=${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (launcherExit !== 0) {
    console.warn(
      `[Windows Verify] NSIS launcher exited with code ${String(launcherExit)}, but the delegated install completed and reached a stable verified layout.`,
    );
  }

  await ensureFile(path.join(installDir, 'SEEKMORE.exe'), 'installed SEEKMORE.exe');
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `[Windows Verify] NSIS launcher ${String(child.pid || 'unknown')} did not exit within ${timeoutMs}ms.`,
        ),
      );
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function waitForStableInstalledLayout(
  installDir,
  timeoutMs,
  startedAt = Date.now(),
) {
  const deadline = startedAt + timeoutMs;
  let previous = null;
  let stableSamples = 0;
  let lastProgressAt = 0;

  while (Date.now() < deadline) {
    const executable = path.join(installDir, 'SEEKMORE.exe');
    const appAsar = path.join(installDir, 'resources', 'app.asar');
    const backendEntry = path.join(installDir, 'resources', 'backend', 'dist', 'src', 'main.js');
    const bundledNode = path.join(installDir, 'resources', 'runtime', 'node', 'node.exe');

    const required = await Promise.all(
      [executable, appAsar, backendEntry, bundledNode].map(
        (candidate) => fsp.lstat(candidate).catch(() => null),
      ),
    );

    if (required.every((stat) => stat?.isFile())) {
      const uninstallers = (await fsp.readdir(installDir, { withFileTypes: true }).catch(() => []))
        .filter((entry) => entry.isFile() && /^uninstall.*\.exe$/i.test(entry.name));

      if (uninstallers.length === 1) {
        const sample = await installedTreeSample(installDir);
        if (
          previous
          && previous.fileCount === sample.fileCount
          && previous.bytes === sample.bytes
          && previous.latestMtimeMs === sample.latestMtimeMs
        ) {
          stableSamples += 1;
        } else {
          stableSamples = 0;
        }
        previous = sample;

        if (stableSamples >= NSIS_LAYOUT_STABLE_SAMPLES) return;
      }
    }

    const now = Date.now();
    if (now - lastProgressAt >= 30_000) {
      console.log(
        `[Windows Verify] NSIS install still running (${Math.round((now - startedAt) / 1000)}s): layoutStableSamples=${stableSamples}/${NSIS_LAYOUT_STABLE_SAMPLES}.`,
      );
      lastProgressAt = now;
    }

    await new Promise((resolve) => setTimeout(resolve, NSIS_LAYOUT_POLL_MS));
  }

  throw new Error(`[Windows Verify] Timed out waiting for NSIS install to stabilize: ${installDir}`);
}

async function installedTreeSample(root) {
  let fileCount = 0;
  let bytes = 0;
  let latestMtimeMs = 0;

  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const stat = await fsp.lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`[Windows Verify] Installed application contains a filesystem link: ${absolute}`);
      }
      if (stat.isDirectory()) {
        await walk(absolute);
      } else if (stat.isFile()) {
        fileCount += 1;
        bytes += stat.size;
        latestMtimeMs = Math.max(latestMtimeMs, stat.mtimeMs);
      }
    }
  }

  await walk(root);
  return { fileCount, bytes, latestMtimeMs };
}

async function acquireInstallerSmokeLock(workRoot) {
  const lockPath = path.join(workRoot, 'windows-installer-smoke.lock');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await fsp.open(lockPath, 'wx');
      await handle.writeFile(
        `${JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        })}\n`,
      );
      await handle.close();

      return async () => {
        await fsp.rm(lockPath, { force: true });
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!(error && typeof error === 'object' && error.code === 'EEXIST')) {
        throw error;
      }

      const existing = await fsp.readFile(lockPath, 'utf8')
        .then((value) => JSON.parse(value))
        .catch(() => null);
      const existingPid = Number(existing?.pid);
      if (
        Number.isInteger(existingPid)
        && existingPid > 0
        && isProcessAlive(existingPid)
      ) {
        throw new Error(
          `[Windows Verify] Another Windows installer lifecycle verification is already active (pid=${existingPid}): ${lockPath}`,
        );
      }

      if (attempt === 0) {
        console.warn(
          `[Windows Verify] Removing stale installer verification lock: ${lockPath}`,
        );
        await fsp.rm(lockPath, { force: true });
        continue;
      }

      throw new Error(
        `[Windows Verify] Unable to acquire Windows installer lifecycle verification lock: ${lockPath}`,
      );
    }
  }

  throw new Error(
    `[Windows Verify] Unable to acquire Windows installer lifecycle verification lock: ${lockPath}`,
  );
}

async function findUninstaller(installDir) {
  const entries = await fsp.readdir(installDir, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isFile() && /^uninstall.*\.exe$/i.test(entry.name))
    .map((entry) => path.join(installDir, entry.name));
  if (matches.length !== 1) {
    throw new Error(`[Windows Verify] Expected exactly one NSIS uninstaller in ${installDir}, found ${matches.length}.`);
  }
  return matches[0];
}

async function waitForPathRemoval(targetPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stat = await fsp.lstat(targetPath).catch(() => null);
    if (!stat) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`[Windows Verify] Installer directory was not removed after uninstall: ${targetPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
