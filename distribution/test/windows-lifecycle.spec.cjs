const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const desktopRoot = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(desktopRoot, relative), 'utf8');
}

test('Windows packaged close hides the main window and tray owns explicit quit', () => {
  const windowManager = read('src/main/window-manager.ts');
  const main = read('src/main/index.ts');

  assert.match(
    windowManager,
    /process\.platform === 'win32'[\s\S]{0,120}this\.electronApp\.isPackaged/,
  );
  assert.match(windowManager, /event\.preventDefault\(\);[\s\S]{0,80}window\.hide\(\);/);

  assert.match(main, /new Tray\(icon\)/);
  assert.match(main, /label: "打开 SEEKMORE"/);
  assert.match(main, /label: "退出 SEEKMORE"/);
  assert.match(main, /click: \(\) => app\.quit\(\)/);
  assert.match(main, /tray\.on\("click", restoreWindow\)/);
  assert.match(main, /tray\.on\("double-click", restoreWindow\)/);
  assert.match(main, /if \(shutdownStarted\) return;/);
  assert.match(
    main,
    /process\.platform === "win32"[\s\S]{0,120}app\.isPackaged[\s\S]{0,120}return;/,
  );
});

test('Windows packaged backend readiness watchdog is 120 seconds only at the desktop call site', () => {
  const main = read('src/main/index.ts');
  const backend = read('src/main/runtime/backend-process.ts');

  assert.match(main, /WINDOWS_PACKAGED_BACKEND_HEALTH_TIMEOUT_MS = 120_000/);
  assert.match(
    main,
    /healthTimeoutMs:[\s\S]{0,160}process\.platform === "win32" && app\.isPackaged[\s\S]{0,120}WINDOWS_PACKAGED_BACKEND_HEALTH_TIMEOUT_MS/,
  );
  assert.match(backend, /this\.options\.healthTimeoutMs \?\? 60_000/);
});


test('Windows packaged startup window is created before runtime bootstrap and macOS keeps the original path', () => {
  const main = read('src/main/index.ts');
  const startup = read('src/main/startup-window.ts');

  assert.match(
    startup,
    /platform === 'win32' && electronApp\.isPackaged/,
  );
  assert.match(
    main,
    /startupWindow\.show\(\)[\s\S]{0,260}\.then\(startBootstrap\)/,
  );
  assert.match(
    main,
    /if \(!startupWindow\) \{[\s\S]{0,100}startBootstrap\(\)/,
  );
});

test('Windows startup window reports real phases and closes only after the main window becomes visible', () => {
  const main = read('src/main/index.ts');
  const startup = read('src/main/startup-window.ts');

  for (const phase of ['PREPARING', 'DATABASE', 'MIGRATION', 'CACHE', 'BACKEND', 'READY']) {
    assert.match(main, new RegExp(`startupWindow\\?\\.setPhase\\("${phase}"\\)`));
  }

  assert.match(
    main,
    /const mainWindow = await showDesktopWindow\(\);[\s\S]{0,180}await waitForWindowVisible\(mainWindow\);[\s\S]{0,120}startupWindow\.closeForMainWindow\(\)/,
  );
  assert.match(startup, /animation: logo-shine/);
  assert.match(startup, /animation: progress-flow/);
  assert.doesNotMatch(startup, /progress(?:Value|Percent|Percentage)|百分比|正在启动[^\n]*(?:10|30|80|99)%/i);
});

test('Windows first run uses PostgreSQL PG_VERSION and does not add a persistent first-run marker', () => {
  const main = read('src/main/index.ts');

  assert.match(main, /path\.join\(runtimePaths\.postgresDataRoot, "PG_VERSION"\)/);
  assert.match(main, /startupWindow\?\.setFirstRun\(!postgresInitialized\)/);
  assert.doesNotMatch(main, /first[-_ ]run\.json|first[-_ ]run\.flag/i);
});

test('Runtime bootstrap failure remains visible in the startup window with stage, error and logs', () => {
  const main = read('src/main/index.ts');
  const startup = read('src/main/startup-window.ts');

  assert.match(
    main,
    /if \(startupWindow\?\.isOpen\(\)\) \{[\s\S]{0,260}startupWindow\.showFailure\(/,
  );
  assert.match(startup, /失败阶段：/);
  assert.match(startup, /错误：/);
  assert.match(startup, /日志：/);
  assert.match(startup, /退出 SEEKMORE/);
});

test('Windows packaged main window uses native titleBarOverlay only and macOS titlebar settings remain intact', () => {
  const windowManager = read('src/main/window-manager.ts');

  assert.match(
    windowManager,
    /process\.platform[\s\S]{0,50}=== 'win32'[\s\S]{0,90}this\.electronApp[\s\S]{0,30}\.isPackaged[\s\S]{0,180}titleBarStyle:[\s\S]{0,30}'hidden'[\s\S]{0,100}titleBarOverlay/,
  );
  assert.match(windowManager, /WINDOWS_TITLE_BAR_TRANSPARENT[\s\S]{0,40}'#00000000'/);
  assert.match(windowManager, /symbolColor:/);
  assert.match(windowManager, /height:[\s\S]{0,30}WINDOWS_TITLE_BAR_HEIGHT/);
  assert.match(windowManager, /titleBarStyle:[\s\S]{0,30}'hiddenInset'/);
  assert.match(windowManager, /trafficLightPosition:/);
  assert.doesNotMatch(windowManager, /frame:\s*false/);
});

test('Windows titlebar theme follows renderer theme without changing frontend source', () => {
  const preload = read('src/preload/index.ts');
  const channels = read('src/shared/desktop-ipc.channels.ts');
  const windowManager = read('src/main/window-manager.ts');

  assert.match(preload, /process\.argv\.includes\("--seekmore-windows-title-bar-overlay"\)/);
  assert.match(preload, /document\.documentElement\.dataset\.theme === "dark"/);
  assert.match(preload, /MutationObserver/);
  assert.match(preload, /padding-right: 142px/);
  assert.match(channels, /windowTitleBarThemeChanged/);
  assert.match(windowManager, /setWindowsTitleBarTheme/);
  assert.match(windowManager, /typeof window[\s\S]{0,40}\.setTitleBarOverlay[\s\S]{0,40}!== 'function'/);
});

test('Windows tray close contract remains unchanged after titlebar overlay', () => {
  const windowManager = read('src/main/window-manager.ts');

  assert.match(
    windowManager,
    /process\.platform === 'win32'[\s\S]{0,120}this\.electronApp\.isPackaged/,
  );
  assert.match(
    windowManager,
    /event\.preventDefault\(\);[\s\S]{0,80}window\.hide\(\);/,
  );
});

test('Single instance focuses startup window before runtime ready and never starts a second runtime', () => {
  const main = read('src/main/index.ts');

  assert.match(main, /app\.requestSingleInstanceLock\(\)/);
  assert.match(
    main,
    /app\.on\('second-instance'[\s\S]{0,180}if \(!runtimeReady\) \{[\s\S]{0,80}startupWindow\?\.bringToFront\(\)/,
  );
  assert.equal((main.match(/bootstrap\(\)/g) || []).length, 2);
});
