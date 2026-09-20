// desktop/src/main/window-manager.ts

import {
  BrowserWindow,
  Menu,
  nativeTheme,
  screen,
  session,
} from 'electron';
import type {
  App,
  BrowserWindowConstructorOptions,
  Rectangle,
  WebContents,
} from 'electron';
import type {
  SeekmoreObjectPreviewWindowRestoreResult,
  SeekmoreObjectPreviewWindowResult,
} from '../shared/desktop-api.types';
import {
  isRendererNavigationAllowed,
  resolveSeekmoreDesktopPaths,
  type SeekmoreDesktopPaths,
} from './desktop-path-resolver';

const SEEKMORE_WINDOW_TITLE =
  'SEEKMORE｜求索无境';

const WINDOWS_TITLE_BAR_HEIGHT =
  45;

const WINDOWS_TITLE_BAR_LIGHT_SYMBOL =
  '#111111';

const WINDOWS_TITLE_BAR_DARK_SYMBOL =
  '#ffffff';

const WINDOWS_TITLE_BAR_TRANSPARENT =
  '#00000000';

const WINDOWS_TITLE_BAR_OVERLAY_ARGUMENT =
  '--seekmore-windows-title-bar-overlay';

const OBJECT_PREVIEW_DEFAULT_WIDTH =
  360;

const OBJECT_PREVIEW_MIN_WIDTH =
  280;

const OBJECT_PREVIEW_MAX_WIDTH =
  480;

const OBJECT_PREVIEW_CHAT_COMPRESSION =
  100;

const RENDERER_UNRESPONSIVE_RECOVERY_MS =
  15_000;

const RENDERER_RECOVERY_WINDOW_MS =
  60_000;

const RENDERER_RECOVERY_LIMIT =
  3;

export class SeekmoreWindowManager {
  private mainWindow:
    BrowserWindow | null =
    null;

  private resolvedPaths:
    SeekmoreDesktopPaths | null =
    null;

  private backendOrigin:
    string | null =
    null;

  private appQuitting =
    false;

  private objectPreviewBaseBounds:
    Rectangle | null =
    null;

  private objectPreviewBaseMinimumSize: {
    width: number;
    height: number;
  } | null = null;

  private objectPreviewWidth:
    number | null =
    null;

  private rendererUnresponsiveTimer:
    ReturnType<typeof setTimeout> | null =
    null;

  private rendererRecoveryTimestamps:
    number[] =
    [];

  constructor(
    private readonly electronApp:
      App,
  ) {
    this.electronApp.on(
      'before-quit',
      () => {
        this.appQuitting =
          true;
      },
    );
  }

  async showOrCreate():
    Promise<BrowserWindow> {
    if (
      this.mainWindow
      && !this.mainWindow.isDestroyed()
    ) {
      if (
        this.mainWindow
          .isMinimized()
      ) {
        this.mainWindow
          .restore();
      }

      this.mainWindow
        .show();

      this.mainWindow
        .focus();

      return this.mainWindow;
    }

    const paths =
      await this.paths();

    const window =
      new BrowserWindow(
        this.windowOptions(
          paths.preloadScriptPath,
        ),
      );

    this.mainWindow =
      window;

    this.applyWindowSecurity(
      window,
      paths,
    );

    window.once(
      'ready-to-show',
      () => {
        if (
          !window.isDestroyed()
        ) {
          window.show();
        }
      },
    );

    window.on(
      'close',
      (event) => {
        const shouldHideInsteadOfClose =
          process.platform === 'darwin'
          || (
            process.platform === 'win32'
            && this.electronApp.isPackaged
          );

        if (
          shouldHideInsteadOfClose
          && !this.appQuitting
        ) {
          event.preventDefault();

          window.hide();
        }
      },
    );

    window.on(
      'closed',
      () => {
        if (
          this.mainWindow
          === window
        ) {
          this.mainWindow =
            null;

          this.objectPreviewBaseBounds =
            null;

          this.objectPreviewBaseMinimumSize =
            null;

          this.objectPreviewWidth =
            null;

          this.clearRendererUnresponsiveTimer();
        }
      },
    );

    await this.loadRenderer(
      window,
      paths,
    );

    window.setTitle(
      SEEKMORE_WINDOW_TITLE,
    );

    return window;
  }

  recoverRenderer(
    reason: string,
    delayMs = 250,
  ): void {
    const window =
      this.mainWindow;

    if (
      this.appQuitting
      || !window
      || window.isDestroyed()
      || window.webContents.isDestroyed()
    ) {
      return;
    }

    const now = Date.now();

    this.rendererRecoveryTimestamps =
      this.rendererRecoveryTimestamps.filter(
        (value) =>
          now - value
          < RENDERER_RECOVERY_WINDOW_MS,
      );

    if (
      this.rendererRecoveryTimestamps.length
      >= RENDERER_RECOVERY_LIMIT
    ) {
      console.error(
        '[DesktopWindow] Renderer recovery suppressed after repeated failures',
        {
          reason,
          attempts:
            this.rendererRecoveryTimestamps.length,
          windowMs:
            RENDERER_RECOVERY_WINDOW_MS,
        },
      );

      return;
    }

    this.rendererRecoveryTimestamps.push(
      now,
    );

    setTimeout(
      () => {
        const current =
          this.mainWindow;

        if (
          this.appQuitting
          || !current
          || current.isDestroyed()
          || current.webContents.isDestroyed()
        ) {
          return;
        }

        console.warn(
          '[DesktopWindow] Reloading renderer after failure',
          {
            reason,
            url:
              current.webContents.getURL(),
          },
        );

        current.webContents.reload();
      },
      Math.max(0, delayMs),
    );
  }

  async resolvedDesktopPaths():
    Promise<SeekmoreDesktopPaths> {
    return this.paths();
  }

  setBackendOrigin(
    value: string | null,
  ): void {
    if (value === null) {
      this.backendOrigin =
        null;

      return;
    }

    const parsed =
      new URL(value);

    if (
      parsed.protocol
        !== 'http:'
      || parsed.hostname
        !== '127.0.0.1'
      || !parsed.port
    ) {
      throw new Error(
        `[DesktopWindow] Managed backend origin must be loopback HTTP: ${value}`,
      );
    }

    this.backendOrigin =
      parsed.origin;
  }

  setWindowsTitleBarTheme(
    value: unknown,
  ): void {
    if (
      process.platform
        !== 'win32'
      || !this.electronApp
        .isPackaged
    ) {
      return;
    }

    const window =
      this.mainWindow;

    if (
      !window
      || window.isDestroyed()
      || typeof window
        .setTitleBarOverlay
        !== 'function'
    ) {
      return;
    }

    const theme =
      value === 'dark'
        ? 'dark'
        : 'light';

    window.setTitleBarOverlay({
      color:
        WINDOWS_TITLE_BAR_TRANSPARENT,
      symbolColor:
        theme === 'dark'
          ? WINDOWS_TITLE_BAR_DARK_SYMBOL
          : WINDOWS_TITLE_BAR_LIGHT_SYMBOL,
      height:
        WINDOWS_TITLE_BAR_HEIGHT,
    });
  }

  hasOpenWindow():
    boolean {
    return Boolean(
      this.mainWindow
      && !this.mainWindow
        .isDestroyed(),
    );
  }

  async expandObjectPreview(
    requestedPreviewWidth:
      number,
  ): Promise<SeekmoreObjectPreviewWindowResult> {
    const window =
      this.mainWindow;

    if (
      !window
      || window.isDestroyed()
      || window.isMaximized()
      || window.isFullScreen()
    ) {
      return {
        expanded: false,
        previewWidth: 0,
      };
    }

    if (
      this.objectPreviewBaseBounds
    ) {
      return {
        expanded: true,

        previewWidth:
          this.objectPreviewWidth
          ?? OBJECT_PREVIEW_DEFAULT_WIDTH,
      };
    }

    const baseBounds =
      window.getBounds();

    const display =
      screen.getDisplayMatching(
        baseBounds,
      );

    const workArea =
      display.workArea;

    const requested =
      this.previewWidth(
        requestedPreviewWidth,
      );

    const availableExpansion =
      Math.max(
        0,
        workArea.width
          - baseBounds.width,
      );

    const requestedExpansion =
      Math.max(
        0,
        requested
          - OBJECT_PREVIEW_CHAT_COMPRESSION,
      );

    const actualExpansion =
      Math.min(
        requestedExpansion,
        availableExpansion,
      );

    const previewWidth =
      actualExpansion
      + OBJECT_PREVIEW_CHAT_COMPRESSION;

    if (
      previewWidth
      < OBJECT_PREVIEW_MIN_WIDTH
    ) {
      return {
        expanded: false,
        previewWidth: 0,
      };
    }

    const targetWidth =
      baseBounds.width
      + actualExpansion;

    const workAreaRight =
      workArea.x
      + workArea.width;

    const targetX =
      Math.max(
        workArea.x,
        Math.min(
          baseBounds.x,
          workAreaRight
            - targetWidth,
        ),
      );

    const baseMinimumSize =
      window.getMinimumSize();

    this.objectPreviewBaseBounds =
      {
        ...baseBounds,
      };

    this.objectPreviewBaseMinimumSize =
      {
        width:
          baseMinimumSize[0]
          ?? 0,

        height:
          baseMinimumSize[1]
          ?? 0,
      };

    this.objectPreviewWidth =
      previewWidth;

    window.setBounds(
      {
        x: targetX,
        y: baseBounds.y,
        width: targetWidth,
        height:
          baseBounds.height,
      },
      false,
    );

    window.setMinimumSize(
      targetWidth,
      this
        .objectPreviewBaseMinimumSize
        .height,
    );

    return {
      expanded: true,
      previewWidth,
    };
  }

  async restoreObjectPreview():
    Promise<SeekmoreObjectPreviewWindowRestoreResult> {
    const window =
      this.mainWindow;

    const baseBounds =
      this.objectPreviewBaseBounds;

    const baseMinimumSize =
      this
        .objectPreviewBaseMinimumSize;

    this.objectPreviewBaseBounds =
      null;

    this.objectPreviewBaseMinimumSize =
      null;

    this.objectPreviewWidth =
      null;

    if (
      !window
      || window.isDestroyed()
    ) {
      return {
        restored: false,
      };
    }

    if (baseMinimumSize) {
      window.setMinimumSize(
        baseMinimumSize.width,
        baseMinimumSize.height,
      );
    }

    if (!baseBounds) {
      return {
        restored: false,
      };
    }

    if (
      window.isMaximized()
      || window.isFullScreen()
    ) {
      return {
        restored: false,
      };
    }

    window.setBounds(
      baseBounds,
      false,
    );

    return {
      restored: true,
    };
  }

  clearApplicationMenu():
    void {
    Menu.setApplicationMenu(
      null,
    );
  }

  denyUnrequestedPermissions():
    void {
    const isTrustedBluetoothRequest =
      (
        webContents:
          WebContents | null,
        permission:
          unknown,
      ): boolean => {
        return (
          String(permission)
            === 'bluetooth'
          && Boolean(
            webContents
            && this.mainWindow
            && !this.mainWindow
              .isDestroyed()
            && webContents.id
              === this.mainWindow
                .webContents.id,
          )
        );
      };

    session
      .defaultSession
      .setPermissionCheckHandler(
        (
          webContents,
          permission,
        ) =>
          isTrustedBluetoothRequest(
            webContents,
            permission,
          ),
      );

    session
      .defaultSession
      .setPermissionRequestHandler(
        (
          webContents,
          permission,
          callback,
        ) => {
          callback(
            isTrustedBluetoothRequest(
              webContents,
              permission,
            ),
          );
        },
      );
  }

  private async paths():
    Promise<SeekmoreDesktopPaths> {
    if (
      !this.resolvedPaths
    ) {
      this.resolvedPaths =
        await resolveSeekmoreDesktopPaths(
          this.electronApp,
          process.argv,
        );
    }

    return this.resolvedPaths;
  }

  private windowOptions(
    preloadScriptPath:
      string,
  ): BrowserWindowConstructorOptions {
    return {
      title:
        SEEKMORE_WINDOW_TITLE,

      width: 1020,
      height: 700,

      minWidth: 460,
      minHeight: 600,

      resizable: true,
      movable: true,
      minimizable: true,
      maximizable: true,
      fullscreenable: true,

      show: false,

      /*
       * macOS:
       * BrowserWindow 本身允许透明，
       * 这样 renderer 的透明区域才能露出
       * macOS 原生 vibrancy。
       *
       * Windows 保持原来的不透明窗口行为。
       */
      transparent:
        process.platform
        === 'darwin',

      backgroundColor:
        process.platform
        === 'darwin'
          ? '#00000000'
          : '#0f0f10',

      ...(process.platform
        === 'darwin'
        ? {
            titleBarStyle:
              'hiddenInset' as const,

            trafficLightPosition:
              {
                x: 4,
                y: 8,
              },

            vibrancy:
              'under-window' as const,

            visualEffectState:
              'followWindow' as const,
          }
        : {}),

      ...(process.platform
          === 'win32'
        && this.electronApp
          .isPackaged
        ? {
            titleBarStyle:
              'hidden' as const,

            titleBarOverlay: {
              color:
                WINDOWS_TITLE_BAR_TRANSPARENT,

              symbolColor:
                nativeTheme
                  .shouldUseDarkColors
                  ? WINDOWS_TITLE_BAR_DARK_SYMBOL
                  : WINDOWS_TITLE_BAR_LIGHT_SYMBOL,

              height:
                WINDOWS_TITLE_BAR_HEIGHT,
            },
          }
        : {}),

      webPreferences: {
        preload:
          preloadScriptPath,

        contextIsolation:
          true,

        nodeIntegration:
          false,

        sandbox:
          false,

        backgroundThrottling:
          false,

        ...(process.platform
            === 'win32'
          && this.electronApp
            .isPackaged
          ? {
              additionalArguments: [
                WINDOWS_TITLE_BAR_OVERLAY_ARGUMENT,
              ],
            }
          : {}),
      },
    };
  }

  private previewWidth(
    value: number,
  ): number {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      return OBJECT_PREVIEW_DEFAULT_WIDTH;
    }

    return Math.max(
      OBJECT_PREVIEW_MIN_WIDTH,
      Math.min(
        OBJECT_PREVIEW_MAX_WIDTH,
        Math.round(value),
      ),
    );
  }

  private applyWindowSecurity(
    window: BrowserWindow,
    paths:
      SeekmoreDesktopPaths,
  ): void {
    window.webContents.on(
      'preload-error',
      (
        _event,
        preloadPath,
        error,
      ) => {
        console.error(
          '[DesktopBridge] Preload failed',
          {
            preloadPath,

            error:
              error
                instanceof Error
                ? error.message
                : String(
                    error,
                  ),
          },
        );
      },
    );

    window.webContents.on(
      'did-fail-load',
      (
        _event,
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      ) => {
        console.error(
          '[DesktopWindow] Renderer failed to load',
          {
            errorCode,
            errorDescription,
            validatedURL,
            isMainFrame,
          },
        );
      },
    );

    window.webContents.on(
      'render-process-gone',
      (_event, details) => {
        this.clearRendererUnresponsiveTimer();

        console.error(
          '[DesktopWindow] Renderer process gone',
          {
            reason: details.reason,
            exitCode: details.exitCode,
            url:
              window.webContents.getURL(),
          },
        );

        if (
          details.reason
          !== 'clean-exit'
        ) {
          this.recoverRenderer(
            `renderer_${details.reason}`,
            300,
          );
        }
      },
    );

    window.webContents.on(
      'unresponsive',
      () => {
        console.error(
          '[DesktopWindow] Renderer became unresponsive',
          {
            url:
              window.webContents.getURL(),
          },
        );

        this.clearRendererUnresponsiveTimer();

        this.rendererUnresponsiveTimer =
          setTimeout(
            () => {
              this.rendererUnresponsiveTimer =
                null;

              this.recoverRenderer(
                'renderer_unresponsive',
                0,
              );
            },
            RENDERER_UNRESPONSIVE_RECOVERY_MS,
          );
      },
    );

    window.webContents.on(
      'responsive',
      () => {
        console.warn(
          '[DesktopWindow] Renderer became responsive again',
          {
            url:
              window.webContents.getURL(),
          },
        );

        this.clearRendererUnresponsiveTimer();
      },
    );

    window.webContents.on(
      'did-finish-load',
      () => {
        this.clearRendererUnresponsiveTimer();

        console.log(
          '[DesktopWindow] Renderer load completed',
          {
            url:
              window.webContents.getURL(),
          },
        );
      },
    );

    window.webContents
      .setWindowOpenHandler(
        (details) => {
          console.warn(
            '[DesktopSecurity] Blocked new window request',
            {
              url:
                details.url,
            },
          );

          return {
            action:
              'deny',
          };
        },
      );

    window.webContents.on(
      'will-navigate',
      (
        event,
        targetUrl,
      ) => {
        if (
          isRendererNavigationAllowed(
            targetUrl,
            paths.rendererEntry,
          )
        ) {
          return;
        }

        event.preventDefault();

        console.warn(
          '[DesktopSecurity] Blocked navigation',
          {
            targetUrl,
          },
        );
      },
    );

    window.webContents.on(
      'will-attach-webview',
      (event) => {
        event.preventDefault();

        console.warn(
          '[DesktopSecurity] Blocked webview attachment',
        );
      },
    );
  }

  private clearRendererUnresponsiveTimer():
    void {
    if (
      !this.rendererUnresponsiveTimer
    ) {
      return;
    }

    clearTimeout(
      this.rendererUnresponsiveTimer,
    );

    this.rendererUnresponsiveTimer =
      null;
  }

  private async loadRenderer(
    window: BrowserWindow,
    paths:
      SeekmoreDesktopPaths,
  ): Promise<void> {
    const entry =
      paths.rendererEntry;

    if (
      entry.kind === 'url'
    ) {
      await window.loadURL(
        entry.url,
      );

      return;
    }

    await window.loadFile(
      entry.indexHtmlPath,
      {
        query: {
          seekmoreRuntime:
            'desktop',

          ...(this.backendOrigin
            ? {
                backendOrigin:
                  this
                    .backendOrigin,
              }
            : {}),
        },
      },
    );
  }
}