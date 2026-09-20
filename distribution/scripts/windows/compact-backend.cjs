const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { builtinModules } = require('node:module');
const path = require('node:path');

const WINDOWS_BACKEND_EXTERNAL_ROOTS = Object.freeze([
  '@modelcontextprotocol/client',
  '@modelcontextprotocol/sdk',
  '@nestjs/common',
  '@nestjs/config',
  '@nestjs/core',
  '@nestjs/event-emitter',
  '@nestjs/jwt',
  '@nestjs/platform-express',
  '@nestjs/platform-socket.io',
  '@nestjs/schedule',
  '@nestjs/throttler',
  '@nestjs/websockets',
  '@prisma/client',
  'class-transformer',
  'class-validator',
  'pdf-parse',
  'prisma',
  'sharp',
]);

const RUNTIME_MANIFEST_NAME = 'backend-runtime-manifest.json';

const NODE_BUILTIN_SPECIFIERS = new Set(
  builtinModules.flatMap((name) => {
    const normalized = String(name || '');
    if (!normalized) return [];
    if (normalized.startsWith('node:')) {
      return [normalized, normalized.slice('node:'.length)];
    }
    return [normalized, `node:${normalized}`];
  }),
);

async function compactWindowsBackend(root, backendRoot) {
  if (process.platform !== 'win32') {
    throw new Error('[Windows Backend Compact] Compaction may only run for a native Windows release build.');
  }

  const esbuild = require('esbuild');
  const entryPath = path.join(backendRoot, 'dist', 'src', 'main.js');
  const nodeModulesRoot = path.join(backendRoot, 'node_modules');
  const prismaGeneratedRoot = path.join(nodeModulesRoot, '.prisma');
  const compactRoot = path.join(backendRoot, '.seekmore-compact-node-modules');
  const compactEntryPath = path.join(backendRoot, 'dist', 'src', '.main.seekmore-compact.cjs');

  await ensureFile(entryPath, 'Backend compiled entry');
  await ensureDirectory(nodeModulesRoot, 'Backend production node_modules');
  await ensureDirectory(prismaGeneratedRoot, 'Generated Prisma client payload');

  const before = await directoryStats(nodeModulesRoot);

  await fsp.rm(compactRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  await fsp.mkdir(compactRoot, { recursive: true });

  const copiedPackages = new Map();
  for (const packageName of WINDOWS_BACKEND_EXTERNAL_ROOTS) {
    await copyPackageClosure({
      packageName,
      issuerRoot: backendRoot,
      sourceNodeModulesRoot: nodeModulesRoot,
      destinationNodeModulesRoot: compactRoot,
      copiedPackages,
      required: true,
    });
  }

  await copyTreeRejectingLinks(
    prismaGeneratedRoot,
    path.join(compactRoot, '.prisma'),
  );

  const external = WINDOWS_BACKEND_EXTERNAL_ROOTS.flatMap((packageName) => [
    packageName,
    `${packageName}/*`,
  ]);

  const buildResult = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [entryPath],
    outfile: compactEntryPath,
    platform: 'node',
    format: 'cjs',
    target: ['node24'],
    bundle: true,
    packages: 'bundle',
    treeShaking: true,
    keepNames: true,
    minify: false,
    sourcemap: false,
    metafile: true,
    logLevel: 'warning',
    external,
    banner: {
      js: '/* SEEKMORE Windows production backend bundle. */',
    },
  });

  await ensureFile(compactEntryPath, 'Compacted Backend entry');
  const bundleExternalContract = await reconcileBundleExternalContract({
    metafile: buildResult.metafile,
    configuredExternal: external,
    backendRoot,
    sourceNodeModulesRoot: nodeModulesRoot,
    destinationNodeModulesRoot: compactRoot,
    copiedPackages,
  });

  const backupNodeModulesRoot = path.join(backendRoot, '.seekmore-original-node-modules');
  await fsp.rm(backupNodeModulesRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  await fsp.rename(nodeModulesRoot, backupNodeModulesRoot);

  let committed = false;
  try {
    await fsp.rename(compactRoot, nodeModulesRoot);
    await fsp.rename(compactEntryPath, entryPath);
    committed = true;
  } finally {
    if (!committed) {
      await fsp.rm(nodeModulesRoot, { recursive: true, force: true }).catch(() => undefined);
      await fsp.rename(backupNodeModulesRoot, nodeModulesRoot).catch(() => undefined);
    }
  }

  await fsp.rm(backupNodeModulesRoot, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 });

  const after = await directoryStats(nodeModulesRoot);
  const entrySha256 = await sha256File(entryPath);
  const bundleBytes = (await fsp.stat(entryPath)).size;
  const closure = [...copiedPackages.values()]
    .sort((left, right) => left.path.localeCompare(right.path));

  if (after.fileCount >= before.fileCount) {
    throw new Error(
      `[Windows Backend Compact] Compaction did not reduce backend node_modules file count: before=${before.fileCount}, after=${after.fileCount}.`,
    );
  }

  const manifest = {
    schemaVersion: 1,
    platform: 'win32',
    arch: 'x64',
    bundler: {
      name: 'esbuild',
      version: String(esbuild.version || ''),
      target: 'node24',
      format: 'cjs',
    },
    entry: 'dist/src/main.js',
    entrySha256,
    bundleBytes,
    externalRoots: [...WINDOWS_BACKEND_EXTERNAL_ROOTS],
    discoveredExternalRoots: bundleExternalContract.discoveredExternalRoots,
    optionalUnresolvedExternals: bundleExternalContract.optionalUnresolvedExternals,
    externalPackages: closure,
    nodeModulesBefore: before,
    nodeModulesAfter: after,
    reduction: {
      fileCount: before.fileCount - after.fileCount,
      filePercent: before.fileCount > 0
        ? Number((((before.fileCount - after.fileCount) / before.fileCount) * 100).toFixed(2))
        : 0,
      bytes: before.bytes - after.bytes,
      bytePercent: before.bytes > 0
        ? Number((((before.bytes - after.bytes) / before.bytes) * 100).toFixed(2))
        : 0,
    },
  };

  await fsp.writeFile(
    path.join(backendRoot, RUNTIME_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  console.log(
    `[Stage] Compacted Windows Backend node_modules: ${before.fileCount} files / ${formatBytes(before.bytes)} -> ${after.fileCount} files / ${formatBytes(after.bytes)} (${manifest.reduction.filePercent}% fewer files).`,
  );

  return manifest;
}

async function copyPackageClosure(input) {
  const sourceRoot = resolvePackageRoot(
    input.packageName,
    input.issuerRoot,
    input.sourceNodeModulesRoot,
  );

  if (!sourceRoot) {
    if (input.required) {
      throw new Error(
        `[Windows Backend Compact] Required external package ${input.packageName} is missing from deployed backend runtime (issuer=${input.issuerRoot}).`,
      );
    }
    return;
  }

  const relativeRoot = toPortablePath(path.relative(input.sourceNodeModulesRoot, sourceRoot));
  if (relativeRoot.startsWith('..')) {
    throw new Error(
      `[Windows Backend Compact] External package ${input.packageName} resolved outside backend node_modules: ${sourceRoot}`,
    );
  }

  const key = path.resolve(sourceRoot).toLowerCase();
  if (input.copiedPackages.has(key)) return;

  const packageJsonPath = path.join(sourceRoot, 'package.json');
  const packageJson = JSON.parse(await fsp.readFile(packageJsonPath, 'utf8'));
  const packageName = String(packageJson.name || input.packageName);
  const version = String(packageJson.version || '');

  input.copiedPackages.set(key, {
    name: packageName,
    version,
    path: relativeRoot,
  });

  await copyTreeRejectingLinks(
    sourceRoot,
    path.join(input.destinationNodeModulesRoot, ...relativeRoot.split('/')),
  );

  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.optionalDependencies || {}),
  };

  const peerDependencies = packageJson.peerDependencies || {};
  const peerMeta = packageJson.peerDependenciesMeta || {};
  for (const peerName of Object.keys(peerDependencies)) {
    if (peerMeta?.[peerName]?.optional === true) continue;
    if (!(peerName in dependencies)) dependencies[peerName] = peerDependencies[peerName];
  }

  for (const dependencyName of Object.keys(dependencies).sort()) {
    const optional = Object.prototype.hasOwnProperty.call(
      packageJson.optionalDependencies || {},
      dependencyName,
    );

    await copyPackageClosure({
      ...input,
      packageName: dependencyName,
      issuerRoot: sourceRoot,
      required: !optional,
    });
  }
}

function resolvePackageRoot(packageName, issuerRoot, sourceNodeModulesRoot) {
  try {
    const resolved = require.resolve(packageName, {
      paths: [issuerRoot],
    });
    let current = fs.statSync(resolved).isDirectory()
      ? resolved
      : path.dirname(resolved);
    const boundary = path.resolve(sourceNodeModulesRoot);

    while (
      current === boundary
      || current.startsWith(`${boundary}${path.sep}`)
    ) {
      if (isNodeModulesPackageRoot(current, packageName)) {
        const packageJsonPath = path.join(current, 'package.json');
        try {
          const packageJson = JSON.parse(
            fs.readFileSync(packageJsonPath, 'utf8'),
          );
          if (packageJson.name === packageName) return current;
        } catch {
          // Keep walking toward the deployed node_modules root.
        }
      }

      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {
    // Fall back to the common hoisted package location below.
  }

  const fallback = path.join(
    sourceNodeModulesRoot,
    ...packageName.split('/'),
  );
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(fallback, 'package.json'), 'utf8'),
    );
    if (packageJson.name === packageName) return fallback;
  } catch {
    // Missing optional dependency is handled by the caller.
  }

  return null;
}

function isNodeModulesPackageRoot(directoryPath, packageName) {
  const segments = String(packageName || '').split('/').filter(Boolean);
  if (segments.length === 1) {
    return path.basename(directoryPath) === segments[0]
      && path.basename(path.dirname(directoryPath)) === 'node_modules';
  }

  if (segments.length === 2 && segments[0].startsWith('@')) {
    const scopeRoot = path.dirname(directoryPath);
    return path.basename(directoryPath) === segments[1]
      && path.basename(scopeRoot) === segments[0]
      && path.basename(path.dirname(scopeRoot)) === 'node_modules';
  }

  return false;
}

async function copyTreeRejectingLinks(source, destination) {
  const stat = await fsp.lstat(source);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `[Windows Backend Compact] Filesystem link is not allowed in Windows production backend runtime: ${source}`,
    );
  }

  if (stat.isDirectory()) {
    await fsp.mkdir(destination, { recursive: true });
    const entries = await fsp.readdir(source, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await copyTreeRejectingLinks(
        path.join(source, entry.name),
        path.join(destination, entry.name),
      );
    }
    return;
  }

  if (!stat.isFile()) {
    throw new Error(`[Windows Backend Compact] Unsupported runtime filesystem entry: ${source}`);
  }

  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.copyFile(source, destination);
}

async function reconcileBundleExternalContract(input) {
  const {
    metafile,
    configuredExternal,
    backendRoot,
    sourceNodeModulesRoot,
    destinationNodeModulesRoot,
    copiedPackages,
  } = input;

  if (!metafile || typeof metafile !== 'object' || !metafile.outputs) {
    throw new Error('[Windows Backend Compact] esbuild did not produce a metafile.');
  }

  const allowed = new Set(configuredExternal);
  const discoveredExternalRoots = new Set();
  const optionalUnresolvedExternals = new Set();
  const invalidExternals = new Set();

  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports || []) {
      if (imported.external !== true) continue;
      const value = String(imported.path || '');
      if (
        allowed.has(value)
        || WINDOWS_BACKEND_EXTERNAL_ROOTS.some(
          (root) => value === root || value.startsWith(`${root}/`),
        )
      ) {
        continue;
      }
      if (isNodeBuiltinSpecifier(value)) continue;

      const packageName = packageRootFromSpecifier(value);
      if (!packageName) {
        invalidExternals.add(value);
        continue;
      }

      const sourceRoot = resolvePackageRoot(
        packageName,
        backendRoot,
        sourceNodeModulesRoot,
      );

      if (!sourceRoot) {
        // esbuild only permits an unresolved package import to survive a
        // successful bundle when the import is optional/guarded (for example
        // ws -> bufferutil / utf-8-validate or debug -> supports-color). The
        // original deployed runtime also does not contain that package, so
        // preserving the guarded require keeps the same runtime semantics.
        optionalUnresolvedExternals.add(value);
        continue;
      }

      await copyPackageClosure({
        packageName,
        issuerRoot: backendRoot,
        sourceNodeModulesRoot,
        destinationNodeModulesRoot,
        copiedPackages,
        required: true,
      });
      discoveredExternalRoots.add(packageName);
    }
  }

  if (invalidExternals.size > 0) {
    throw new Error(
      `[Windows Backend Compact] Bundle contains unsupported relative/absolute runtime externals: ${[...invalidExternals].sort().join(', ')}`,
    );
  }

  return {
    discoveredExternalRoots: [...discoveredExternalRoots].sort(),
    optionalUnresolvedExternals: [...optionalUnresolvedExternals].sort(),
  };
}

function isNodeBuiltinSpecifier(value) {
  return NODE_BUILTIN_SPECIFIERS.has(String(value || ''));
}

function packageRootFromSpecifier(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (
    !normalized
    || normalized.startsWith('.')
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
  ) {
    return null;
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  if (segments[0].startsWith('@')) {
    if (segments.length < 2) return null;
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0];
}

async function directoryStats(root) {
  let fileCount = 0;
  let bytes = 0;

  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const stat = await fsp.lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `[Windows Backend Compact] Filesystem link found in hoisted Windows backend deployment: ${absolute}`,
        );
      }
      if (stat.isDirectory()) {
        await walk(absolute);
      } else if (stat.isFile()) {
        fileCount += 1;
        bytes += stat.size;
      }
    }
  }

  await walk(root);
  return { fileCount, bytes };
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

async function ensureFile(filePath, label) {
  const stat = await fsp.lstat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`[Windows Backend Compact] ${label} is missing: ${filePath}`);
  }
}

async function ensureDirectory(directoryPath, label) {
  const stat = await fsp.lstat(directoryPath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`[Windows Backend Compact] ${label} is missing: ${directoryPath}`);
  }
}

function toPortablePath(value) {
  return value.split(path.sep).join('/');
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

module.exports = {
  NODE_BUILTIN_SPECIFIERS,
  RUNTIME_MANIFEST_NAME,
  WINDOWS_BACKEND_EXTERNAL_ROOTS,
  compactWindowsBackend,
  directoryStats,
  isNodeBuiltinSpecifier,
  packageRootFromSpecifier,
  resolvePackageRoot,
};
