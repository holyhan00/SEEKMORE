import path from 'node:path';
import type { App } from 'electron';

export function resolveSeekmoreDataHome(
  app: Pick<App, 'getPath'>,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (platform !== 'win32') {
    return app.getPath('userData');
  }

  const localAppData = String(
    environment.LOCALAPPDATA ?? '',
  ).trim();

  if (localAppData) {
    return path.win32.join(
      localAppData,
      'SEEKMORE',
    );
  }

  return path.win32.join(
    app.getPath('home'),
    'AppData',
    'Local',
    'SEEKMORE',
  );
}
