// desktop/src/main/index.ts
import { app, dialog, ipcMain, Menu, safeStorage, shell, Tray } from "electron";
import type { BrowserWindow, OpenDialogOptions } from "electron";
import { access, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";
import { SeekmoreWindowManager } from "./window-manager";
import {
  SeekmoreStartupWindow,
  shouldUseWindowsStartupWindow,
} from "./startup-window";
import { SEEKMORE_DESKTOP_IPC } from "../shared/desktop-ipc.channels";
import { DesktopWebRuntimeServer } from "./web-runtime/desktop-web-runtime-server";
import { registerCoreDesktopIpc } from "./ipc/desktop-ipc.registry";
import { ReminderRingCoordinator } from "./reminder/reminder-ring-coordinator";
import { ReminderAudioPlayer } from "./reminder/reminder-audio-player";
import { DesktopMcpSecretStore } from "./mcp/desktop-mcp-secret-store";
import { DesktopMcpExecutionApprovalStore } from "./mcp/desktop-mcp-execution-approval-store";
import { DesktopMcpStdioHost } from "./mcp/desktop-mcp-stdio-host";
import { BlenderAddonSetupAdapter } from "./mcp/integrations/blender/blender-addon-setup.adapter";
import { DesktopMcpSetupRegistry } from "./mcp/setup/desktop-mcp-setup-registry";
import {
  buildSeekmoreBackendRuntimeEnvironment,
  ManagedBackendProcess,
  ManagedPostgresProcess,
  createManagedCacheProcess,
  type ManagedCacheProcess,
  preparePrismaMigrationRuntime,
  PrismaMigrationRunner,
  reserveLoopbackPort,
  resolveSeekmoreRuntimePaths,
  SeekmoreRuntimeSecretStore,
} from "./runtime";
import { resolveSeekmoreDataHome } from "./seekmore-data-home";

const packagedSingleInstanceLock = app.isPackaged
  ? app.requestSingleInstanceLock()
  : true;

if (!packagedSingleInstanceLock) {
  app.quit();
}

const WINDOWS_PACKAGED_BACKEND_HEALTH_TIMEOUT_MS = 120_000;
const SEEKMORE_TRAY_TOOLTIP = "SEEKMORE｜求索无境";

const SKILL_FILE_SELECT_FOR_UPLOAD = "seekmore:skill-files:select-for-upload";
type SkillFileSelectionRequest = {
  allowDirectories?: boolean;
  multiple?: boolean;
};
type SkillFileSelectionEntry = {
  name: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  lastModified: number;
  contentBase64: string;
};
type SkillFileSelectionResult = {
  canceled: boolean;
  selectionKind: "FILES" | "DIRECTORY";
  files: SkillFileSelectionEntry[];
};

const windowManager = new SeekmoreWindowManager(app);
const useWindowsStartupWindow = shouldUseWindowsStartupWindow(app);
const startupWindow = useWindowsStartupWindow
  ? new SeekmoreStartupWindow(() => {
      if (!shutdownStarted) app.quit();
    })
  : null;
const desktopMcpSecrets = new DesktopMcpSecretStore();
const desktopMcpApprovals = new DesktopMcpExecutionApprovalStore();
const desktopMcpSetups = new DesktopMcpSetupRegistry([
  new BlenderAddonSetupAdapter(),
]);
const desktopMcpHost = new DesktopMcpStdioHost(
  desktopMcpSecrets,
  desktopMcpSetups,
  desktopMcpApprovals,
);
const desktopWebRuntime = new DesktopWebRuntimeServer(
  desktopMcpHost,
  desktopMcpSecrets,
);
const reminderAudioPath = app.isPackaged
  ? path.join(process.resourcesPath, "resources", "audio", "reminder.wav")
  : path.join(__dirname, "..", "..", "resources", "audio", "reminder.wav");
const reminderAudio = new ReminderAudioPlayer(reminderAudioPath);
const reminderRing = new ReminderRingCoordinator(reminderAudio);
let shutdownStarted = false;
let runtimeReady = false;
let managedBackend: ManagedBackendProcess | null = null;
let managedPostgres: ManagedPostgresProcess | null = null;
let managedCache: ManagedCacheProcess | null = null;
let runtimeStopPromise: Promise<void> | null = null;
let windowsTray: Tray | null = null;
let releaseSmokeProcesses: {
  postgresPid?: number;
  cachePid?: number;
  backendPid?: number;
  cacheProvider?: string;
  backendReadyMs?: number;
  runtimeReadyMs?: number;
} = {};
function clearDesktopIpc(): void {
  for (const channel of Object.values(SEEKMORE_DESKTOP_IPC)) {
    ipcMain.removeHandler(channel);
    ipcMain.removeAllListeners(channel);
  }
  ipcMain.removeHandler(SKILL_FILE_SELECT_FOR_UPLOAD);
}

function registerDesktopIpc(): void {
  clearDesktopIpc();
  registerCoreDesktopIpc({
    showDesktopWindow,
    reminderRing,
    expandObjectPreview: (previewWidth) =>
      windowManager.expandObjectPreview(previewWidth),
    restoreObjectPreview: () =>
      windowManager.restoreObjectPreview(),
  });
  ipcMain.on(
    SEEKMORE_DESKTOP_IPC.windowTitleBarThemeChanged,
    (_event, value: unknown) => windowManager.setWindowsTitleBarTheme(value),
  );
  ipcMain.handle(SKILL_FILE_SELECT_FOR_UPLOAD, (_event, input: unknown) =>
    selectSkillFilesForUpload(input),
  );

  ipcMain.handle(
    SEEKMORE_DESKTOP_IPC.webOpenExternal,
    async (_event, value: unknown): Promise<{ opened: boolean }> => {
      const raw = String(value ?? "").trim();
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return { opened: false };
      }
      if (!["http:", "https:"].includes(url.protocol)) return { opened: false };
      await shell.openExternal(url.toString(), { activate: true });
      return { opened: true };
    },
  );
}

async function selectSkillFilesForUpload(
  value: unknown,
): Promise<SkillFileSelectionResult> {
  const input = asRecord(value) as SkillFileSelectionRequest;
  const allowDirectories = input.allowDirectories === true;
  const multiple = input.multiple !== false;

  const properties: NonNullable<OpenDialogOptions["properties"]> = ["openFile"];

  if (allowDirectories && process.platform === "darwin") {
    properties.push("openDirectory");
  }

  if (multiple) {
    properties.push("multiSelections");
  }

  const selection = await dialog.showOpenDialog({
    title: allowDirectories ? "选择文件或文件夹" : "选择文件",
    buttonLabel: "上传",
    properties,
  });

  if (selection.canceled || selection.filePaths.length === 0) {
    return {
      canceled: true,
      selectionKind: "FILES",
      files: [],
    };
  }

  const files: SkillFileSelectionEntry[] = [];
  let selectedDirectory = false;

  for (const selectedPath of selection.filePaths) {
    const metadata = await lstat(selectedPath);

    if (metadata.isSymbolicLink()) {
      continue;
    }

    if (metadata.isDirectory()) {
      if (!allowDirectories) {
        continue;
      }

      selectedDirectory = true;

      await collectDirectoryFiles(
        selectedPath,
        path.basename(selectedPath),
        files,
      );

      continue;
    }

    if (
      metadata.isFile() &&
      !isHiddenPathSegment(path.basename(selectedPath))
    ) {
      files.push(
        await readUploadFile(
          selectedPath,
          path.basename(selectedPath),
          metadata.mtimeMs,
          metadata.size,
        ),
      );
    }
  }

  return {
    canceled: false,
    selectionKind: selectedDirectory ? "DIRECTORY" : "FILES",
    files,
  };
}

async function collectDirectoryFiles(
  absoluteDirectory: string,
  relativeDirectory: string,
  output: SkillFileSelectionEntry[],
): Promise<void> {
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });

  entries.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );

  for (const entry of entries) {
    if (isHiddenPathSegment(entry.name) || entry.isSymbolicLink()) {
      continue;
    }

    const absolutePath = path.join(absoluteDirectory, entry.name);

    const relativePath = toPortablePath(
      path.join(relativeDirectory, entry.name),
    );

    if (entry.isDirectory()) {
      await collectDirectoryFiles(absolutePath, relativePath, output);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const metadata = await lstat(absolutePath);

    output.push(
      await readUploadFile(
        absolutePath,
        relativePath,
        metadata.mtimeMs,
        metadata.size,
      ),
    );
  }
}

async function readUploadFile(
  absolutePath: string,
  relativePath: string,
  lastModified: number,
  sizeBytes: number,
): Promise<SkillFileSelectionEntry> {
  const content = await readFile(absolutePath);

  return {
    name: path.basename(absolutePath),
    relativePath: toPortablePath(relativePath),
    mimeType: inferMimeType(absolutePath),
    sizeBytes,
    lastModified,
    contentBase64: content.toString("base64"),
  };
}

function inferMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".md":
    case ".txt":
    case ".log":
      return "text/plain";
    case ".json":
      return "application/json";
    case ".yaml":
    case ".yml":
      return "application/yaml";
    case ".js":
    case ".mjs":
      return "text/javascript";
    case ".ts":
    case ".tsx":
      return "text/typescript";
    case ".py":
      return "text/x-python";
    case ".html":
      return "text/html";
    case ".css":
      return "text/css";
    case ".csv":
      return "text/csv";
    case ".xml":
      return "application/xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

function isHiddenPathSegment(value: string): boolean {
  return value.startsWith(".");
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

async function showDesktopWindow() {
  return windowManager.showOrCreate();
}

async function ensureWindowsTray(): Promise<void> {
  if (
    process.platform !== "win32"
    || !app.isPackaged
    || windowsTray
  ) {
    return;
  }

  const icon = await app.getFileIcon(
    process.execPath,
    { size: "small" },
  );

  const tray = new Tray(icon);
  tray.setToolTip(SEEKMORE_TRAY_TOOLTIP);

  const restoreWindow = () => {
    if (!runtimeReady || shutdownStarted) return;

    void showDesktopWindow().catch((error) =>
      console.error(
        "[DesktopMain] Failed to restore SEEKMORE from tray",
        error,
      ),
    );
  };

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开 SEEKMORE",
        click: restoreWindow,
      },
      { type: "separator" },
      {
        label: "退出 SEEKMORE",
        click: () => app.quit(),
      },
    ]),
  );
  tray.on("click", restoreWindow);
  tray.on("double-click", restoreWindow);
  windowsTray = tray;
}

function destroyWindowsTray(): void {
  if (!windowsTray) return;
  windowsTray.destroy();
  windowsTray = null;
}
async function bootstrap(): Promise<void> {
  const bootstrapStartedAt = Date.now();
  startupWindow?.setPhase("PREPARING");
  const desktopPaths = await windowManager.resolvedDesktopPaths();
  const runtimePaths = resolveSeekmoreRuntimePaths({
    runtimeEnvironment: desktopPaths.runtimeEnvironment,
    platform: process.platform,
    resourcesRoot:
      desktopPaths.runtimeEnvironment === 'production-packaged'
        ? process.resourcesPath
        : desktopPaths.projectRoot,
    dataHome: resolveSeekmoreDataHome(app),
    temporaryRoot: os.tmpdir(),
  });

  if (useWindowsStartupWindow) {
    const postgresInitialized = await pathExists(
      path.join(runtimePaths.postgresDataRoot, "PG_VERSION"),
    );
    startupWindow?.setFirstRun(!postgresInitialized);
  }

  let packagedBackend:
    | Parameters<typeof buildSeekmoreBackendRuntimeEnvironment>[0]['packagedBackend']
    | undefined;

  if (desktopPaths.runtimeEnvironment === 'production-packaged') {
    const backendResources = desktopPaths.packagedBackendResources;
    const dataResources = desktopPaths.packagedDataResources;
    if (!backendResources || !dataResources) {
      throw new Error(
        '[DesktopMain] Packaged runtime resources were not resolved.',
      );
    }

    const runtimeSecrets = await new SeekmoreRuntimeSecretStore(
      runtimePaths.runtimeSecretsPath,
      {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encryptString: (value) => safeStorage.encryptString(value),
        decryptString: (value) => safeStorage.decryptString(value),
      },
    ).loadOrCreate();

    const postgresPort = await reserveLoopbackPort();
    managedPostgres = new ManagedPostgresProcess({
      ...dataResources.postgres,
      dataRoot: runtimePaths.postgresDataRoot,
      host: '127.0.0.1',
      port: postgresPort,
      username: 'seekmore',
      databaseName: 'seekmore',
      password: runtimeSecrets.postgresPassword,
      logPath: runtimePaths.postgresLogPath,
      onUnexpectedExit: ({ code, signal }) => {
        console.error(
          '[DesktopMain] Managed PostgreSQL exited unexpectedly',
          { code, signal },
        );
        if (!shutdownStarted) app.quit();
      },
    });
    startupWindow?.setPhase("DATABASE");
    assertBootstrapActive();
    const postgres = await managedPostgres.start();
    releaseSmokeProcesses.postgresPid = postgres.pid;

    startupWindow?.setPhase("MIGRATION");
    assertBootstrapActive();
    const prismaMigrationRuntime =
      await preparePrismaMigrationRuntime({
        templateRoot:
          dataResources.prisma.migrationRuntimeTemplateRoot,
        runtimeRoot:
          runtimePaths.prismaMigrationRuntimeRoot,
      });

    await new PrismaMigrationRunner({
      nodeExecutablePath: backendResources.nodeExecutablePath,
      prismaCliEntryPath: prismaMigrationRuntime.prismaCliEntryPath,
      workingDirectory: prismaMigrationRuntime.runtimeRoot,
      schemaPath: dataResources.prisma.schemaPath,
      migrationsRoot: dataResources.prisma.migrationsRoot,
      databaseUrl: postgres.databaseUrl,
      logPath: runtimePaths.migrationLogPath,
    }).run();

    startupWindow?.setPhase("CACHE");
    assertBootstrapActive();
    const cachePort = await reserveLoopbackPort();
    managedCache = createManagedCacheProcess({
      resources: dataResources.cache,
      dataRoot: runtimePaths.cacheDataRoot,
      runtimeRoot: runtimePaths.runtimeRoot,
      host: '127.0.0.1',
      port: cachePort,
      password: runtimeSecrets.redisPassword,
      logPath: runtimePaths.cacheLogPath,
      onUnexpectedExit: ({ code, signal }) => {
        console.error(
          '[DesktopMain] Managed cache runtime exited unexpectedly',
          { code, signal },
        );
        if (!shutdownStarted) app.quit();
      },
    });
    const cache = await managedCache.start();
    releaseSmokeProcesses.cachePid = cache.pid;
    releaseSmokeProcesses.cacheProvider = dataResources.cache.provider;

    packagedBackend = {
      backendRoot: backendResources.backendRoot,
      nodeExecutablePath: backendResources.nodeExecutablePath,
      port: await reserveLoopbackPort(),
      secrets: runtimeSecrets,
      data: {
        databaseUrl: postgres.databaseUrl,
        redisHost: cache.host,
        redisPort: cache.port,
        redisPassword: cache.password,
      },
    };
  }

  startupWindow?.setPhase("BACKEND");
  assertBootstrapActive();
  const backendRuntimeEnvironment = buildSeekmoreBackendRuntimeEnvironment({
    runtimeEnvironment: desktopPaths.runtimeEnvironment,
    paths: runtimePaths,
    baseEnv: process.env,
    packagedBackend,
  });

  windowManager.clearApplicationMenu();
  windowManager.denyUnrequestedPermissions();
  registerDesktopIpc();

  await desktopWebRuntime.start({
    descriptorPath:
      backendRuntimeEnvironment.SEEKMORE_DESKTOP_RUNTIME_DESCRIPTOR_PATH,
  });

  if (desktopPaths.runtimeEnvironment === 'production-packaged') {
    const backendResources = desktopPaths.packagedBackendResources!;
    const port = Number(backendRuntimeEnvironment.PORT);

    managedBackend = new ManagedBackendProcess({
      nodeExecutablePath: backendResources.nodeExecutablePath,
      backendEntryPath: backendResources.backendEntryPath,
      backendRoot: backendResources.backendRoot,
      host: '127.0.0.1',
      port,
      environment: backendRuntimeEnvironment,
      logPath: runtimePaths.backendLogPath,
      healthTimeoutMs:
        process.platform === "win32" && app.isPackaged
          ? WINDOWS_PACKAGED_BACKEND_HEALTH_TIMEOUT_MS
          : undefined,
      onUnexpectedExit: ({ code, signal }) => {
        console.error(
          '[DesktopMain] Managed Backend exited unexpectedly',
          { code, signal },
        );
        if (!shutdownStarted) app.quit();
      },
    });

    const backendStartedAt = Date.now();
    const backend = await managedBackend.start();
    releaseSmokeProcesses.backendPid = backend.pid;
    releaseSmokeProcesses.backendReadyMs =
      Date.now() - backendStartedAt;
    windowManager.setBackendOrigin(backend.origin);
  } else {
    windowManager.setBackendOrigin(null);
  }

  await ensureWindowsTray();
  runtimeReady = true;
  releaseSmokeProcesses.runtimeReadyMs =
    Date.now() - bootstrapStartedAt;
  startupWindow?.setPhase("READY");
  const mainWindow = await showDesktopWindow();
  if (startupWindow) {
    await waitForWindowVisible(mainWindow);
    startupWindow.closeForMainWindow();
  }
  await completeReleaseSmokeIfRequested(runtimePaths.dataHome);
}


async function completeReleaseSmokeIfRequested(
  dataHome: string,
): Promise<void> {
  const resultPath = String(
    process.env.SEEKMORE_RELEASE_SMOKE_RESULT_PATH ?? '',
  ).trim();

  if (!app.isPackaged || !resultPath) return;

  await mkdir(path.dirname(resultPath), {
    recursive: true,
    mode: 0o700,
  });

  await writeFile(
    resultPath,
    `${JSON.stringify({
      schemaVersion: 1,
      status: 'ready',
      desktopPid: process.pid,
      dataHome,
      ...releaseSmokeProcesses,
      completedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  );

  if (
    process.env.SEEKMORE_RELEASE_SMOKE_AUTO_QUIT === '1'
  ) {
    setTimeout(() => app.quit(), 250);
  }
}

if (packagedSingleInstanceLock) {
  app.whenReady().then(() => {
    const startBootstrap = () => {
      void bootstrap().catch((error) => {
        console.error("[DesktopMain] Failed to bootstrap Seekmore Desktop", error);
        runtimeReady = false;

        if (startupWindow?.isOpen()) {
          startupWindow.showFailure(
            errorMessage(error),
            path.join(resolveSeekmoreDataHome(app), "logs"),
          );
          void stopManagedRuntime().catch((stopError) => {
            console.error(
              "[DesktopMain] Failed to stop runtime after bootstrap failure",
              stopError,
            );
          });
          return;
        }

        app.quit();
      });
    };

    if (!startupWindow) {
      startBootstrap();
      return;
    }

    void startupWindow.show()
      .then(startBootstrap)
      .catch((error) => {
        console.error("[DesktopMain] Failed to show Windows startup window", error);
        startBootstrap();
      });
  });
}

app.on('child-process-gone', (_event, details) => {
  console.error(
    '[DesktopMain] Electron child process gone',
    {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName ?? null,
      name: details.name ?? null,
    },
  );

  if (
    details.type === 'GPU'
    && details.reason !== 'clean-exit'
  ) {
    windowManager.recoverRenderer(
      `gpu_${details.reason}`,
      750,
    );
  }
});

app.on('second-instance', () => {
  if (!app.isPackaged) return;

  if (!runtimeReady) {
    startupWindow?.bringToFront();
    return;
  }

  if (!windowManager.hasOpenWindow()) return;

  void showDesktopWindow().catch((error) =>
    console.error(
      '[DesktopMain] Failed to focus existing SEEKMORE window',
      error,
    ),
  );
});

app.on("activate", () => {
  if (!runtimeReady) return;
  void showDesktopWindow().catch((error) =>
    console.error(
      "[DesktopMain] Failed to restore Seekmore Desktop window",
      error,
    ),
  );
});
app.on("before-quit", (event) => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  event.preventDefault();
  clearDesktopIpc();
  reminderRing.dispose();

  runtimeReady = false;
  destroyWindowsTray();
  void stopManagedRuntime()
    .catch((error) => {
      console.error('[DesktopMain] Managed runtime shutdown failed', error);
    })
    .finally(() => app.quit());
});
app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  if (shutdownStarted) return;
  if (
    process.platform === "win32"
    && app.isPackaged
  ) {
    return;
  }
  app.quit();
});
function assertBootstrapActive(): void {
  if (useWindowsStartupWindow && shutdownStarted) {
    throw new Error("[DesktopMain] Bootstrap cancelled because shutdown started.");
  }
}

function stopManagedRuntime(): Promise<void> {
  if (runtimeStopPromise) return runtimeStopPromise;

  runtimeStopPromise = (managedBackend?.stop() ?? Promise.resolve())
    .finally(() => desktopMcpHost.closeAll())
    .finally(() => desktopWebRuntime.stop())
    .finally(() => managedCache?.stop() ?? Promise.resolve())
    .finally(() => managedPostgres?.stop() ?? Promise.resolve())
    .finally(() => {
      managedBackend = null;
      managedCache = null;
      managedPostgres = null;
    });

  return runtimeStopPromise;
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForWindowVisible(
  window: BrowserWindow,
): Promise<void> {
  if (window.isDestroyed() || window.isVisible()) return;

  await new Promise<void>((resolve) => {
    const finish = () => {
      window.removeListener("show", finish);
      window.removeListener("closed", finish);
      resolve();
    };

    window.once("show", finish);
    window.once("closed", finish);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown startup error");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}