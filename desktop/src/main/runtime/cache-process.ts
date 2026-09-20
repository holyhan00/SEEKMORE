import type { SeekmorePackagedCacheResources } from '../desktop-path-resolver';
import {
  ManagedGarnetProcess,
  type ManagedGarnetProcessOptions,
} from './garnet-process';
import {
  ManagedValkeyProcess,
  type ManagedValkeyProcessOptions,
} from './valkey-process';

export type ManagedCacheProcessInfo = {
  pid: number;
  host: '127.0.0.1';
  port: number;
  password: string;
};

export interface ManagedCacheProcess {
  start(): Promise<ManagedCacheProcessInfo>;
  stop(): Promise<void>;
}

export type ManagedCacheProcessOptions = {
  resources: SeekmorePackagedCacheResources;
  dataRoot: string;
  runtimeRoot: string;
  host: '127.0.0.1';
  port: number;
  password: string;
  logPath: string;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  onUnexpectedExit?: (event: {
    code: number | null;
    signal: NodeJS.Signals | null;
  }) => void;
};

export function createManagedCacheProcess(
  options: ManagedCacheProcessOptions,
): ManagedCacheProcess {
  const common = {
    dataRoot: options.dataRoot,
    runtimeRoot: options.runtimeRoot,
    host: options.host,
    port: options.port,
    password: options.password,
    logPath: options.logPath,
    startupTimeoutMs:
      options.startupTimeoutMs,
    shutdownTimeoutMs:
      options.shutdownTimeoutMs,
    onUnexpectedExit:
      options.onUnexpectedExit,
  };

  if (options.resources.provider === 'garnet') {
    return new ManagedGarnetProcess({
      ...common,
      garnetServerExecutablePath:
        options.resources.executablePath,
    } satisfies ManagedGarnetProcessOptions);
  }

  return new ManagedValkeyProcess({
    ...common,
    redisServerExecutablePath:
      options.resources.executablePath,
  } satisfies ManagedValkeyProcessOptions);
}
