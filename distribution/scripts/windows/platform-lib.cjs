const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');

const {
  ensureDirectory,
  ensureFile,
  assertPeX64,
} = require('../distribution-lib.cjs');

async function findWinUnpacked(appOutputRoot, productName = 'SEEKMORE') {
  const direct = path.join(appOutputRoot, 'win-unpacked');
  const directStat = await fsp.lstat(direct).catch(() => null);
  if (directStat?.isDirectory()) return direct;

  const entries = await fsp.readdir(appOutputRoot, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory() && /win.*unpacked/i.test(entry.name))
    .map((entry) => path.join(appOutputRoot, entry.name));

  if (matches.length !== 1) {
    throw new Error(
      `[Windows Package] Expected exactly one unpacked Windows application for ${productName}, found ${matches.length}.`,
    );
  }

  return matches[0];
}

async function assertWindowsAppLayout(appRoot, productName = 'SEEKMORE') {
  await ensureDirectory(appRoot, 'Windows unpacked application');

  const executablePath = path.join(appRoot, `${productName}.exe`);
  const resourcesRoot = path.join(appRoot, 'resources');

  await Promise.all([
    ensureFile(executablePath, 'SEEKMORE Windows executable'),
    ensureDirectory(resourcesRoot, 'SEEKMORE Windows resources'),
    ensureFile(path.join(resourcesRoot, 'app.asar'), 'SEEKMORE app.asar'),
  ]);

  await assertPeX64(executablePath, 'SEEKMORE Windows executable');

  return {
    executablePath,
    resourcesRoot,
  };
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EPERM') return true;
    return false;
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[Windows Verify] Process ${child.pid ?? 'unknown'} did not exit within ${timeoutMs}ms.`));
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


async function runDesktopRuntimeSmoke(input) {
  const smokeStartedAt = Date.now();
  await Promise.all([
    fsp.mkdir(input.localAppData, { recursive: true }),
    fsp.mkdir(input.roamingAppData, { recursive: true }),
    fsp.mkdir(path.dirname(input.resultPath), { recursive: true }),
  ]);

  await fsp.rm(input.resultPath, { force: true });

  const child = spawn(input.executablePath, [], {
    cwd: path.dirname(input.executablePath),
    env: {
      ...process.env,
      LOCALAPPDATA: input.localAppData,
      APPDATA: input.roamingAppData,
      SEEKMORE_RELEASE_SMOKE_RESULT_PATH: input.resultPath,
      SEEKMORE_RELEASE_SMOKE_AUTO_QUIT: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-64 * 1024);
  });

  const exitCode = await waitForExit(child, input.timeoutMs ?? 180_000).catch(async (error) => {
    if (child.pid) {
      await runTaskkill(child.pid, true).catch(() => undefined);
    }
    throw error;
  });

  const raw = await fsp.readFile(input.resultPath, 'utf8').catch(() => null);
  if (!raw) {
    throw new Error(
      `[Windows Verify] Packaged application did not reach real runtime-ready state. exitCode=${String(exitCode)} stderr=${stderr.trim()}`,
    );
  }

  const result = JSON.parse(raw);
  if (result.status !== 'ready') {
    throw new Error(`[Windows Verify] Runtime smoke returned unexpected status ${String(result.status)}.`);
  }

  const expectedDataHome = path.resolve(input.localAppData, 'SEEKMORE');
  if (path.resolve(String(result.dataHome || '')) !== expectedDataHome) {
    throw new Error(
      `[Windows Verify] Windows dataHome ${String(result.dataHome)} does not match ${expectedDataHome}.`,
    );
  }

  if (result.cacheProvider !== 'garnet') {
    throw new Error(
      `[Windows Verify] Windows packaged runtime used cache provider ${String(result.cacheProvider)} instead of garnet.`,
    );
  }

  const backendReadyMs = Number(result.backendReadyMs);
  const runtimeReadyMs = Number(result.runtimeReadyMs);
  if (!Number.isFinite(backendReadyMs) || backendReadyMs <= 0) {
    throw new Error('[Windows Verify] Runtime smoke did not report backendReadyMs.');
  }
  if (!Number.isFinite(runtimeReadyMs) || runtimeReadyMs <= 0) {
    throw new Error('[Windows Verify] Runtime smoke did not report runtimeReadyMs.');
  }

  const maxBackendReadyMs = input.maxBackendReadyMs ?? 60_000;
  if (backendReadyMs >= maxBackendReadyMs) {
    throw new Error(
      `[Windows Verify] Windows Backend cold start ${backendReadyMs}ms exceeds release quality budget ${maxBackendReadyMs}ms. The 120s Desktop watchdog is a safety ceiling, not the performance target.`,
    );
  }

  console.log(
    `[Windows Verify] Runtime ready: backend=${backendReadyMs}ms total=${runtimeReadyMs}ms process=${Date.now() - smokeStartedAt}ms.`,
  );

  for (const key of ['backendPid', 'cachePid', 'postgresPid']) {
    const pid = Number(result[key]);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`[Windows Verify] Runtime smoke did not report a valid ${key}.`);
    }
    if (isProcessAlive(pid)) {
      throw new Error(`[Windows Verify] Orphan runtime process remains after Electron quit: ${key}=${pid}.`);
    }
  }

  return result;
}

function runTaskkill(pid, force) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'taskkill.exe',
      ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])],
      { stdio: 'ignore', windowsHide: true },
    );
    child.once('error', reject);
    child.once('close', () => resolve());
  });
}

module.exports = {
  assertWindowsAppLayout,
  findWinUnpacked,
  isProcessAlive,
  runDesktopRuntimeSmoke,
  waitForExit,
};
