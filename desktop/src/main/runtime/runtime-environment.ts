import type {
  SeekmorePackagedBackendEnvironment,
  SeekmoreRuntimeEnvironmentInput,
} from './runtime.types';

export function buildSeekmoreBackendRuntimeEnvironment(
  input: SeekmoreRuntimeEnvironmentInput,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...input.baseEnv,
  };

  if (input.runtimeEnvironment !== 'production-packaged') {
    return env;
  }

  const backend = requiredPackagedBackend(input.packagedBackend);

  // Managed packaged runtime must not inherit caller-side Node injection hooks.
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.ELECTRON_RUN_AS_NODE;

  env.NODE_ENV = 'production';
  env.HOST = '127.0.0.1';
  env.PORT = String(backend.port);

  env.USER_STORAGE_DIR = input.paths.userStorageRoot;
  env.AGENT_STORAGE_DIR = input.paths.agentStorageRoot;
  env.SKILL_STORAGE_ROOT = input.paths.skillStorageRoot;
  env.OBJECT_STORAGE_ROOT = input.paths.objectStorageRoot;
  env.PRESENTATION_STORAGE_ROOT = input.paths.presentationStorageRoot;

  env.SEEKMORE_BACKEND_ROOT = backend.backendRoot;
  env.SEEKMORE_DESKTOP_RUNTIME_DESCRIPTOR_PATH =
    input.paths.desktopRuntimeDescriptorPath;

  env.SEEKMORE_LOCAL_IDENTITY_ENABLED = 'true';

  env.JWT_ACCESS_SECRET = backend.secrets.jwtAccessSecret;
  env.JWT_REFRESH_SECRET = backend.secrets.jwtRefreshSecret;
  env.MCP_SECRET_ENCRYPTION_KEY =
    backend.secrets.mcpSecretEncryptionKey;

  env.DATABASE_URL = backend.data.databaseUrl;
  env.REDIS_HOST = backend.data.redisHost;
  env.REDIS_PORT = String(backend.data.redisPort);
  env.REDIS_PASSWORD = backend.data.redisPassword;

  env.CORS_ALLOWED_ORIGINS = mergeCsv(
    input.baseEnv.CORS_ALLOWED_ORIGINS,
    'null',
  );

  return env;
}

function requiredPackagedBackend(
  value: SeekmorePackagedBackendEnvironment | undefined,
): SeekmorePackagedBackendEnvironment {
  if (!value) {
    throw new Error(
      '[RuntimeEnvironment] Packaged backend environment is required in production-packaged mode.',
    );
  }

  assertPort(value.port, 'backend');
  assertPort(value.data.redisPort, 'Redis');

  if (!value.backendRoot.trim()) {
    throw new Error('[RuntimeEnvironment] Packaged backend root is required.');
  }
  if (!value.nodeExecutablePath.trim()) {
    throw new Error('[RuntimeEnvironment] Packaged Node executable path is required.');
  }
  if (!value.data.databaseUrl.trim()) {
    throw new Error('[RuntimeEnvironment] Packaged DATABASE_URL is required.');
  }
  if (value.data.redisHost !== '127.0.0.1') {
    throw new Error('[RuntimeEnvironment] Packaged Redis must bind to 127.0.0.1.');
  }
  if (!value.data.redisPassword.trim()) {
    throw new Error('[RuntimeEnvironment] Packaged Redis password is required.');
  }

  for (const [name, secret] of Object.entries(value.secrets)) {
    if (!String(secret ?? '').trim()) {
      throw new Error(
        `[RuntimeEnvironment] Packaged runtime secret is missing: ${name}`,
      );
    }
  }

  return value;
}

function assertPort(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(
      `[RuntimeEnvironment] Invalid packaged ${label} port: ${String(value)}`,
    );
  }
}

function mergeCsv(existing: string | undefined, requiredValue: string): string {
  const values = String(existing ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  values.push(requiredValue);
  return Array.from(new Set(values)).join(',');
}
