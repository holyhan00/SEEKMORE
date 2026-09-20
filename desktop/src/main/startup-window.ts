import { BrowserWindow } from 'electron';
import type { App } from 'electron';
import { SEEKMORE_START_LOGO_DATA_URL } from './startlogo';

export type SeekmoreStartupPhase =
  | 'PREPARING'
  | 'DATABASE'
  | 'MIGRATION'
  | 'CACHE'
  | 'BACKEND'
  | 'READY'
  | 'FAILED';

type StartupState = {
  phase: SeekmoreStartupPhase;
  firstRun: boolean;
  failedStage: Exclude<SeekmoreStartupPhase, 'FAILED'> | null;
  errorMessage: string | null;
  logsPath: string | null;
};

const SEEKMORE_STARTUP_WINDOW_TITLE = 'SEEKMORE｜求索无境';
const SEEKMORE_STARTUP_WIDTH = 420;
const SEEKMORE_STARTUP_HEIGHT = 310;

export function shouldUseWindowsStartupWindow(
  electronApp: Pick<App, 'isPackaged'>,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'win32' && electronApp.isPackaged;
}

export class SeekmoreStartupWindow {
  private window: BrowserWindow | null = null;
  private closingForMainWindow = false;
  private loaded = false;
  private state: StartupState = {
    phase: 'PREPARING',
    firstRun: false,
    failedStage: null,
    errorMessage: null,
    logsPath: null,
  };

  constructor(
    private readonly onUserClose: () => void,
  ) {}

  async show(): Promise<void> {
    if (this.window && !this.window.isDestroyed()) {
      this.bringToFront();
      return;
    }

    this.closingForMainWindow = false;
    this.loaded = false;

    const window = new BrowserWindow({
      title: SEEKMORE_STARTUP_WINDOW_TITLE,
      width: SEEKMORE_STARTUP_WIDTH,
      height: SEEKMORE_STARTUP_HEIGHT,
      useContentSize: true,
      center: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      closable: true,
      frame: false,
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    this.window = window;

    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
    });

    window.webContents.once('did-finish-load', () => {
      if (window.isDestroyed()) return;
      this.loaded = true;
      void this.flushState();
    });

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());

    window.on('close', () => {
      if (!this.closingForMainWindow) {
        this.onUserClose();
      }
    });

    window.on('closed', () => {
      if (this.window === window) {
        this.window = null;
        this.loaded = false;
      }
    });

    const html = buildStartupHtml();
    await window.loadURL(
      `data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`,
    );
  }

  isOpen(): boolean {
    return Boolean(this.window && !this.window.isDestroyed());
  }

  bringToFront(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;

    if (window.isMinimized()) {
      window.restore();
    }

    window.show();
    window.focus();
  }

  setFirstRun(firstRun: boolean): void {
    this.state = {
      ...this.state,
      firstRun,
    };
    void this.flushState();
  }

  setPhase(phase: Exclude<SeekmoreStartupPhase, 'FAILED'>): void {
    this.state = {
      ...this.state,
      phase,
      failedStage: null,
      errorMessage: null,
      logsPath: null,
    };
    void this.flushState();
  }

  showFailure(errorMessage: string, logsPath: string): void {
    const failedStage = this.state.phase === 'FAILED'
      ? this.state.failedStage
      : this.state.phase;

    this.state = {
      ...this.state,
      phase: 'FAILED',
      failedStage,
      errorMessage: normalizeSingleLine(errorMessage) || '未知启动错误',
      logsPath,
    };

    this.bringToFront();
    void this.flushState();
  }

  closeForMainWindow(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;

    this.closingForMainWindow = true;
    window.close();
  }

  private async flushState(): Promise<void> {
    const window = this.window;
    if (
      !this.loaded
      || !window
      || window.isDestroyed()
      || window.webContents.isDestroyed()
    ) {
      return;
    }

    const serialized = JSON.stringify(this.state);

    try {
      await window.webContents.executeJavaScript(
        `window.__SEEKMORE_STARTUP_UPDATE__?.(${serialized});`,
        true,
      );
    } catch (error) {
      if (!window.isDestroyed()) {
        console.warn('[StartupWindow] Failed to update startup state', error);
      }
    }
  }
}

function normalizeSingleLine(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function buildStartupHtml(): string {
  const logo = JSON.stringify(SEEKMORE_START_LOGO_DATA_URL);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${SEEKMORE_STARTUP_WINDOW_TITLE}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", sans-serif;
      background: #ffffff;
      color: #171717;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #ffffff;
    }

    body {
      display: flex;
      align-items: center;
      justify-content: center;
      -webkit-app-region: drag;
      user-select: none;
    }

    .startup {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 28px 42px 25px;
    }

    .logo {
      position: relative;
      width: 86px;
      height: 86px;
      margin-bottom: 22px;
      overflow: hidden;
    }

    .logo img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .logo-shine {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(
        108deg,
        transparent 22%,
        rgba(255, 255, 255, 0.12) 38%,
        rgba(255, 255, 255, 0.92) 49%,
        rgba(255, 255, 255, 0.16) 60%,
        transparent 76%
      );
      transform: translateX(-145%);
      animation: logo-shine 2.35s cubic-bezier(.4, 0, .2, 1) infinite;
      -webkit-mask-image: url(${logo});
      -webkit-mask-repeat: no-repeat;
      -webkit-mask-position: center;
      -webkit-mask-size: contain;
      mask-image: url(${logo});
      mask-repeat: no-repeat;
      mask-position: center;
      mask-size: contain;
    }

    .status {
      min-height: 20px;
      font-size: 14px;
      line-height: 20px;
      font-weight: 600;
      letter-spacing: -0.1px;
      color: #202020;
      text-align: center;
    }

    .detail {
      min-height: 18px;
      margin-top: 5px;
      font-size: 12px;
      line-height: 18px;
      font-weight: 400;
      color: #777777;
      text-align: center;
    }

    .progress {
      position: relative;
      width: 218px;
      height: 2px;
      margin-top: 20px;
      overflow: hidden;
      border-radius: 999px;
      background: #ededed;
    }

    .progress::after {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      width: 36%;
      border-radius: inherit;
      background: #1677ff;
      transform: translateX(-130%);
      animation: progress-flow 1.3s cubic-bezier(.4, 0, .2, 1) infinite;
    }

    .note {
      width: 100%;
      min-height: 34px;
      margin-top: 17px;
      font-size: 10.5px;
      line-height: 17px;
      color: #a0a0a0;
      text-align: center;
      opacity: 0;
      transition: opacity 160ms ease;
    }

    .note.visible {
      opacity: 1;
    }

    .failure {
      display: none;
      width: 100%;
      margin-top: 14px;
      text-align: center;
    }

    .failure.visible {
      display: block;
    }

    .failure-line {
      width: 100%;
      margin-top: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 10.5px;
      line-height: 16px;
      color: #858585;
    }

    .failure-error {
      color: #555555;
    }

    .exit-button {
      margin-top: 13px;
      min-width: 92px;
      height: 30px;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      background: #ffffff;
      color: #2a2a2a;
      font: inherit;
      font-size: 11px;
      cursor: pointer;
      -webkit-app-region: no-drag;
    }

    .exit-button:hover {
      background: #f7f7f7;
    }

    body.failed .progress {
      display: none;
    }

    body.failed .note {
      display: none;
    }

    @keyframes logo-shine {
      0%, 18% {
        transform: translateX(-145%);
      }
      63%, 100% {
        transform: translateX(145%);
      }
    }

    @keyframes progress-flow {
      0% {
        transform: translateX(-130%);
      }
      100% {
        transform: translateX(380%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .logo-shine,
      .progress::after {
        animation-duration: 3.8s;
      }
    }
  </style>
</head>
<body>
  <main class="startup" aria-live="polite">
    <div class="logo" aria-hidden="true">
      <img src=${logo} alt="" />
      <div class="logo-shine"></div>
    </div>

    <div id="status" class="status">正在启动 SEEKMORE…</div>
    <div id="detail" class="detail">正在准备本地运行环境</div>
    <div class="progress" aria-hidden="true"></div>
    <div id="note" class="note"></div>

    <section id="failure" class="failure">
      <div id="failed-stage" class="failure-line"></div>
      <div id="failure-error" class="failure-line failure-error"></div>
      <div id="logs-path" class="failure-line"></div>
      <button id="exit-button" class="exit-button" type="button">退出 SEEKMORE</button>
    </section>
  </main>

  <script>
    (() => {
      const status = document.getElementById('status');
      const detail = document.getElementById('detail');
      const note = document.getElementById('note');
      const failure = document.getElementById('failure');
      const failedStage = document.getElementById('failed-stage');
      const failureError = document.getElementById('failure-error');
      const logsPath = document.getElementById('logs-path');
      const exitButton = document.getElementById('exit-button');

      const phaseLabels = {
        PREPARING: '正在准备本地运行环境',
        DATABASE: '正在启动本地数据库',
        MIGRATION: '正在更新数据结构',
        CACHE: '正在启动本地缓存',
        BACKEND: '正在启动 SEEKMORE Runtime',
        READY: '正在进入 SEEKMORE',
      };

      const failedStageLabels = {
        PREPARING: '准备本地运行环境',
        DATABASE: '本地数据库',
        MIGRATION: '数据结构更新',
        CACHE: '本地缓存',
        BACKEND: 'SEEKMORE Runtime',
        READY: '进入 SEEKMORE',
      };

      window.__SEEKMORE_STARTUP_UPDATE__ = (state) => {
        const failed = state?.phase === 'FAILED';
        document.body.classList.toggle('failed', failed);
        failure.classList.toggle('visible', failed);

        if (failed) {
          status.textContent = 'SEEKMORE 启动失败';
          detail.textContent = '本地运行环境未能完成启动';
          failedStage.textContent = state.failedStage
            ? '失败阶段：' + (failedStageLabels[state.failedStage] || state.failedStage)
            : '';
          failureError.textContent = state.errorMessage
            ? '错误：' + state.errorMessage
            : '';
          logsPath.textContent = state.logsPath
            ? '日志：' + state.logsPath
            : '';
          return;
        }

        status.textContent = state?.phase === 'READY'
          ? '正在进入 SEEKMORE…'
          : '正在启动 SEEKMORE…';

        detail.textContent = state?.phase === 'DATABASE' && state?.firstRun
          ? '正在初始化本地数据库'
          : (phaseLabels[state?.phase] || phaseLabels.PREPARING);

        const firstRun = state?.firstRun === true;
        note.textContent = firstRun
          ? '首次启动可能需要一些时间，后续启动将明显更快。'
          : '';
        note.classList.toggle('visible', firstRun);
      };

      exitButton.addEventListener('click', () => window.close());
    })();
  </script>
</body>
</html>`;
}
