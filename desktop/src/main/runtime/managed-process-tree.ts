import {
  spawn,
  type ChildProcess,
} from 'node:child_process';

export type ManagedProcessTerminationOptions = {
  platform?: NodeJS.Platform;
  gracefulTimeoutMs?: number;
  forceTimeoutMs?: number;
};

export async function terminateManagedProcessTree(
  child: ChildProcess,
  options: ManagedProcessTerminationOptions = {},
): Promise<void> {
  if (child.exitCode !== null) return;

  const platform =
    options.platform ?? process.platform;
  const gracefulTimeoutMs =
    options.gracefulTimeoutMs ?? 5_000;
  const forceTimeoutMs =
    options.forceTimeoutMs ?? 5_000;
  const exited = waitForChildExit(child);

  if (platform === 'win32') {
    const pid = child.pid;
    if (!pid) {
      child.kill();
      await Promise.race([
        exited,
        delay(forceTimeoutMs),
      ]);
      return;
    }

    await runTaskkill(pid, false).catch(
      () => undefined,
    );

    const graceful = await Promise.race([
      exited.then(() => true),
      delay(gracefulTimeoutMs).then(
        () => false,
      ),
    ]);

    if (graceful || child.exitCode !== null) {
      return;
    }

    await runTaskkill(pid, true).catch(
      () => undefined,
    );

    await Promise.race([
      exited,
      delay(forceTimeoutMs),
    ]);
    return;
  }

  child.kill('SIGTERM');
  const graceful = await Promise.race([
    exited.then(() => true),
    delay(gracefulTimeoutMs).then(
      () => false,
    ),
  ]);

  if (graceful || child.exitCode !== null) {
    return;
  }

  child.kill('SIGKILL');
  await Promise.race([
    exited,
    delay(forceTimeoutMs),
  ]);
}

function runTaskkill(
  pid: number,
  force: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '/PID',
      String(pid),
      '/T',
      ...(force ? ['/F'] : []),
    ];

    const process = spawn(
      'taskkill.exe',
      args,
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );

    process.once('error', reject);
    process.once('close', (code) => {
      if (code === 0 || code === 128) {
        resolve();
        return;
      }

      reject(
        new Error(
          `[ManagedProcessTree] taskkill exited with code ${String(code)} for PID ${pid}.`,
        ),
      );
    });
  });
}

function waitForChildExit(
  child: ChildProcess,
): Promise<void> {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    child.once('close', () => resolve());
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
