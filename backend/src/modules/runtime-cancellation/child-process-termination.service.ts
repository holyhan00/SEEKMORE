import { Injectable } from '@nestjs/common';
import { spawn, type ChildProcess } from 'node:child_process';

@Injectable()
export class ChildProcessTerminationService {
  async terminate(child: ChildProcess, graceMs = 1500): Promise<{
    termSent: boolean; killSent: boolean; exited: boolean; durationMs: number;
  }> {
    const startedAt = Date.now();
    if (child.exitCode !== null || child.signalCode) {
      return { termSent: false, killSent: false, exited: true, durationMs: 0 };
    }
    let termSent = false;
    let killSent = false;
    const exited = new Promise<boolean>((resolve) => child.once('close', () => resolve(true)));
    try {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else if (child.pid) {
        process.kill(-child.pid, 'SIGTERM');
      } else {
        child.kill('SIGTERM');
      }
      termSent = true;
    } catch {                                        }
    let didExit = await Promise.race([exited, delay(graceMs).then(() => false)]);
    if (!didExit) {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
        killSent = true;
      } catch {                                        }
      didExit = await Promise.race([exited, delay(500).then(() => false)]);
    }
    return { termSent, killSent, exited: didExit, durationMs: Date.now() - startedAt };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}
