import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const gunzip = promisify(zlib.gunzip);
const RUNTIME_MANIFEST_FILENAME = 'runtime-manifest.json';
const RUNTIME_PACKAGE_FILENAME = 'package.json';
const PRISMA_CLI_RELATIVE_PATH = path.join(
  'node_modules',
  'prisma',
  'build',
  'index.js',
);

type PrismaMigrationRuntimePayload = {
  relativePath: string;
  payloadPath: string;
  sha256: string;
  mode: number;
};

export type PrismaMigrationRuntimeManifest = {
  schemaVersion: 1;
  prismaVersion: string;
  target: string;
  contentHash: string;
  payloads: PrismaMigrationRuntimePayload[];
};

export type PrismaMigrationRuntimePrepareOptions = {
  templateRoot: string;
  runtimeRoot: string;
  platform?: NodeJS.Platform;
  arch?: string;
};

export type PreparedPrismaMigrationRuntime = {
  runtimeRoot: string;
  prismaCliEntryPath: string;
  manifest: PrismaMigrationRuntimeManifest;
};

export async function preparePrismaMigrationRuntime(
  options: PrismaMigrationRuntimePrepareOptions,
): Promise<PreparedPrismaMigrationRuntime> {
  const templateRoot = path.resolve(options.templateRoot);
  const runtimeRoot = path.resolve(options.runtimeRoot);
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const expectedTarget = `${platform}-${arch}`;

  const templateManifest = await readRuntimeManifest(
    path.join(templateRoot, RUNTIME_MANIFEST_FILENAME),
    'template',
  );

  if (templateManifest.target !== expectedTarget) {
    throw new Error(
      `[PrismaMigrationRuntime] Template target ${templateManifest.target} does not match runtime target ${expectedTarget}.`,
    );
  }

  await assertFile(
    path.join(templateRoot, RUNTIME_PACKAGE_FILENAME),
    'template package manifest',
  );
  await assertFile(
    path.join(templateRoot, PRISMA_CLI_RELATIVE_PATH),
    'template Prisma CLI entry',
  );
  await assertPayloadFiles(
    templateRoot,
    templateManifest,
  );

  const destinationRoot = path.join(
    runtimeRoot,
    templateManifest.prismaVersion,
    templateManifest.target,
  );

  if (
    await destinationMatches(
      destinationRoot,
      templateManifest,
    )
  ) {
    return preparedRuntime(
      destinationRoot,
      templateManifest,
    );
  }

  await fs.mkdir(path.dirname(destinationRoot), {
    recursive: true,
    mode: 0o700,
  });

  const temporaryRoot = path.join(
    path.dirname(destinationRoot),
    `.${path.basename(destinationRoot)}.tmp-${process.pid}-${randomUUID()}`,
  );

  await fs.rm(temporaryRoot, {
    recursive: true,
    force: true,
  });

  try {
    await fs.cp(
      templateRoot,
      temporaryRoot,
      {
        recursive: true,
        force: true,
        dereference: false,
        verbatimSymlinks: true,
      },
    );

    const copiedManifest = await readRuntimeManifest(
      path.join(temporaryRoot, RUNTIME_MANIFEST_FILENAME),
      'copied template',
    );

    assertSameManifest(
      templateManifest,
      copiedManifest,
    );

    await materializePayloads(
      temporaryRoot,
      copiedManifest,
    );

    await assertFile(
      path.join(temporaryRoot, PRISMA_CLI_RELATIVE_PATH),
      'copied Prisma CLI entry',
    );

    await fs.rm(destinationRoot, {
      recursive: true,
      force: true,
    });

    await fs.rename(
      temporaryRoot,
      destinationRoot,
    );
  } catch (error) {
    await fs.rm(temporaryRoot, {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    throw error;
  }

  return preparedRuntime(
    destinationRoot,
    templateManifest,
  );
}

async function destinationMatches(
  destinationRoot: string,
  expected: PrismaMigrationRuntimeManifest,
): Promise<boolean> {
  try {
    const current = await readRuntimeManifest(
      path.join(destinationRoot, RUNTIME_MANIFEST_FILENAME),
      'installed runtime',
    );

    assertSameManifest(
      expected,
      current,
    );

    await assertFile(
      path.join(destinationRoot, PRISMA_CLI_RELATIVE_PATH),
      'installed Prisma CLI entry',
    );

    await assertMaterializedPayloads(
      destinationRoot,
      current,
    );

    return true;
  } catch {
    return false;
  }
}

async function materializePayloads(
  runtimeRoot: string,
  manifest: PrismaMigrationRuntimeManifest,
): Promise<void> {
  for (const payload of manifest.payloads) {
    const payloadPath = resolveRelativeRuntimePath(
      runtimeRoot,
      payload.payloadPath,
    );
    const destinationPath = resolveRelativeRuntimePath(
      runtimeRoot,
      payload.relativePath,
    );

    const compressed = await fs.readFile(
      payloadPath,
    );
    const bytes = await gunzip(
      compressed,
    );

    if (sha256(bytes) !== payload.sha256) {
      throw new Error(
        `[PrismaMigrationRuntime] Payload checksum mismatch for ${payload.relativePath}.`,
      );
    }

    await fs.mkdir(
      path.dirname(destinationPath),
      {
        recursive: true,
        mode: 0o700,
      },
    );

    await fs.writeFile(
      destinationPath,
      bytes,
      {
        mode: payload.mode,
      },
    );

    if (process.platform !== 'win32') {
      await fs.chmod(
        destinationPath,
        payload.mode,
      );
    }
  }
}

async function assertPayloadFiles(
  root: string,
  manifest: PrismaMigrationRuntimeManifest,
): Promise<void> {
  for (const payload of manifest.payloads) {
    await assertFile(
      resolveRelativeRuntimePath(
        root,
        payload.payloadPath,
      ),
      `runtime payload ${payload.payloadPath}`,
    );
  }
}

async function assertMaterializedPayloads(
  root: string,
  manifest: PrismaMigrationRuntimeManifest,
): Promise<void> {
  for (const payload of manifest.payloads) {
    const filePath = resolveRelativeRuntimePath(
      root,
      payload.relativePath,
    );

    const bytes = await fs.readFile(
      filePath,
    );

    if (sha256(bytes) !== payload.sha256) {
      throw new Error(
        `[PrismaMigrationRuntime] Installed native runtime checksum mismatch for ${payload.relativePath}.`,
      );
    }
  }
}

function preparedRuntime(
  runtimeRoot: string,
  manifest: PrismaMigrationRuntimeManifest,
): PreparedPrismaMigrationRuntime {
  return {
    runtimeRoot,
    prismaCliEntryPath: path.join(
      runtimeRoot,
      PRISMA_CLI_RELATIVE_PATH,
    ),
    manifest,
  };
}

async function readRuntimeManifest(
  manifestPath: string,
  label: string,
): Promise<PrismaMigrationRuntimeManifest> {
  let payload: unknown;

  try {
    payload = JSON.parse(
      await fs.readFile(
        manifestPath,
        'utf8',
      ),
    );
  } catch {
    throw new Error(
      `[PrismaMigrationRuntime] ${label} manifest is missing or invalid: ${manifestPath}`,
    );
  }

  if (
    !payload
    || typeof payload !== 'object'
  ) {
    throw new Error(
      `[PrismaMigrationRuntime] ${label} manifest is invalid: ${manifestPath}`,
    );
  }

  const value = payload as Partial<PrismaMigrationRuntimeManifest>;

  const contentHash = value.contentHash;

  if (
    value.schemaVersion !== 1
    || !isNonEmptyString(value.prismaVersion)
    || !isNonEmptyString(value.target)
    || typeof contentHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(contentHash)
    || !Array.isArray(value.payloads)
    || value.payloads.length === 0
  ) {
    throw new Error(
      `[PrismaMigrationRuntime] ${label} manifest contract is invalid: ${manifestPath}`,
    );
  }

  const payloads = value.payloads.map(
    (entry) => normalizePayloadEntry(
      entry,
      manifestPath,
    ),
  );

  return {
    schemaVersion: 1,
    prismaVersion: value.prismaVersion,
    target: value.target,
    contentHash,
    payloads,
  };
}

function normalizePayloadEntry(
  value: unknown,
  manifestPath: string,
): PrismaMigrationRuntimePayload {
  if (
    !value
    || typeof value !== 'object'
  ) {
    throw new Error(
      `[PrismaMigrationRuntime] Invalid payload entry in ${manifestPath}.`,
    );
  }

  const payload = value as Partial<PrismaMigrationRuntimePayload>;
  const payloadSha256 = payload.sha256;
  const payloadMode = payload.mode;

  if (
    !isSafeRelativePath(payload.relativePath)
    || !isSafeRelativePath(payload.payloadPath)
    || typeof payloadSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(payloadSha256)
    || typeof payloadMode !== 'number'
    || !Number.isInteger(payloadMode)
    || payloadMode < 0
    || payloadMode > 0o777
  ) {
    throw new Error(
      `[PrismaMigrationRuntime] Invalid payload contract in ${manifestPath}.`,
    );
  }

  return {
    relativePath: payload.relativePath,
    payloadPath: payload.payloadPath,
    sha256: payloadSha256,
    mode: payloadMode,
  };
}

function assertSameManifest(
  expected: PrismaMigrationRuntimeManifest,
  actual: PrismaMigrationRuntimeManifest,
): void {
  if (
    actual.schemaVersion !== expected.schemaVersion
    || actual.prismaVersion !== expected.prismaVersion
    || actual.target !== expected.target
    || actual.contentHash !== expected.contentHash
    || JSON.stringify(actual.payloads) !== JSON.stringify(expected.payloads)
  ) {
    throw new Error(
      '[PrismaMigrationRuntime] Installed runtime manifest does not match the packaged template.',
    );
  }
}

async function assertFile(
  filePath: string,
  label: string,
): Promise<void> {
  try {
    const metadata = await fs.stat(filePath);
    if (!metadata.isFile()) {
      throw new Error('not-a-file');
    }
  } catch {
    throw new Error(
      `[PrismaMigrationRuntime] ${label} is missing: ${filePath}`,
    );
  }
}

function resolveRelativeRuntimePath(
  root: string,
  relativePath: string,
): string {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(
      `[PrismaMigrationRuntime] Unsafe runtime relative path: ${String(relativePath)}`,
    );
  }

  return path.join(
    root,
    ...relativePath.split('/'),
  );
}

function isSafeRelativePath(
  value: unknown,
): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  if (
    path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
  ) {
    return false;
  }

  const normalized = value.replace(/\\/g, '/');
  const segments = normalized.split('/');

  return segments.every(
    (segment) =>
      segment.length > 0
      && segment !== '.'
      && segment !== '..',
  );
}

function sha256(
  value: Buffer,
): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

function isNonEmptyString(
  value: unknown,
): value is string {
  return typeof value === 'string'
    && value.trim().length > 0;
}