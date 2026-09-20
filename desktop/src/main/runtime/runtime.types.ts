import type { SeekmoreDesktopRuntimeEnvironment } from '../desktop-path-resolver';

export type SeekmoreRuntimePathContext = {
  runtimeEnvironment: SeekmoreDesktopRuntimeEnvironment;
  platform: NodeJS.Platform;
  resourcesRoot: string;
  dataHome: string;
  temporaryRoot: string;
};

export type SeekmoreRuntimePaths = {
  resourcesRoot: string;
  dataHome: string;

  databaseRoot: string;
  postgresDataRoot: string;

  storageRoot: string;
  userStorageRoot: string;
  agentStorageRoot: string;
  skillStorageRoot: string;
  objectStorageRoot: string;
  presentationStorageRoot: string;

  runtimeRoot: string;
  cacheDataRoot: string;
  prismaMigrationRuntimeRoot: string;
  desktopRuntimeDescriptorPath: string;

  secretsRoot: string;
  runtimeSecretsPath: string;

  logsRoot: string;
  backendLogPath: string;
  postgresLogPath: string;
  cacheLogPath: string;
  migrationLogPath: string;
};

export type SeekmoreRuntimeSecrets = {
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  mcpSecretEncryptionKey: string;
  postgresPassword: string;
  redisPassword: string;
};

export type SeekmoreBackendRuntimeSecrets = SeekmoreRuntimeSecrets;

export type SeekmorePackagedDataEnvironment = {
  databaseUrl: string;
  redisHost: '127.0.0.1';
  redisPort: number;
  redisPassword: string;
};

export type SeekmorePackagedBackendEnvironment = {
  backendRoot: string;
  nodeExecutablePath: string;
  port: number;
  secrets: SeekmoreRuntimeSecrets;
  data: SeekmorePackagedDataEnvironment;
};

export type SeekmoreRuntimeEnvironmentInput = {
  runtimeEnvironment: SeekmoreDesktopRuntimeEnvironment;
  paths: SeekmoreRuntimePaths;
  baseEnv: NodeJS.ProcessEnv;
  packagedBackend?: SeekmorePackagedBackendEnvironment;
};
