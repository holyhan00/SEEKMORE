const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const {
  assertNativeTarget,
  assertTargetEnabled,
  cacheRuntimeForTarget,
  inventory,
  loadRuntimeLock,
  repoRoot,
  spawnInvocation,
  stagePaths,
  targetKey,
} = require('../scripts/distribution-lib.cjs');
const {
  assertStageManifestIntegrity,
  assertWindowsPrismaMigrationRuntimePortability,
  isPortableMacDynamicPath,
  parseOtoolDependencies,
  parseOtoolInstallId,
  parseOtoolRpaths,
} = require('../scripts/verify-stage.cjs');

const root = repoRoot(path.join(__dirname, '..', 'scripts'));
const lock = loadRuntimeLock(root);
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('runtime lock is pinned to SEEKMORE release and native runtimes', () => {
  assert.equal(lock.generatedForRelease, rootPackage.version);
  assert.equal(lock.node.version, '24.19.0');
  assert.equal(lock.postgresql.version, '18.4');
  assert.equal(lock.postgresql.major, 18);
  assert.equal(lock.pgvector.version, '0.8.6');
  assert.equal(cacheRuntimeForTarget(lock, 'darwin-arm64').provider, 'Valkey');
  assert.equal(cacheRuntimeForTarget(lock, 'darwin-arm64').version, '9.1.1');
  assert.equal(cacheRuntimeForTarget(lock, 'win32-x64').provider, 'Garnet');
  assert.equal(cacheRuntimeForTarget(lock, 'win32-x64').version, '2.1.4');
  assert.equal(cacheRuntimeForTarget(lock, 'win32-x64').selfContained, true);
  assert.equal(lock.platformPolicy.macOSMinimumVersion, '13.5');
  assert.equal(lock.platformPolicy.windowsMinimumVersion, '10.0.22000');
});

test('darwin and Windows x64 runtime targets are enabled', () => {
  assert.doesNotThrow(() => assertTargetEnabled(lock, 'darwin-arm64'));
  assert.doesNotThrow(() => assertTargetEnabled(lock, 'darwin-x64'));
  assert.doesNotThrow(() => assertTargetEnabled(lock, 'win32-x64'));
});

test('stage paths keep app, immutable resources and packaging assets separated', () => {
  const p = stagePaths('/repo', 'win32-x64');
  const stage = path.join('/repo', 'distribution', 'stage', 'win32-x64');
  assert.equal(p.appRoot, path.join(stage, 'app'));
  assert.equal(p.resourcesRoot, path.join(stage, 'resources'));
  assert.equal(p.backendRoot, path.join(stage, 'resources', 'backend'));
  assert.equal(p.runtimeRoot, path.join(stage, 'resources', 'runtime'));
  assert.equal(p.audioRoot, path.join(stage, 'resources', 'resources', 'audio'));
  assert.equal(p.licensesRoot, path.join(stage, 'resources', 'licenses'));
  assert.equal(p.packagingRoot, path.join(stage, 'packaging'));
});

test('downloaded runtime archives use pinned SHA256 values', () => {
  for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
    assert.match(lock.node.targets[target].sha256, /^[a-f0-9]{64}$/);
  }
  assert.match(lock.postgresql.source.sha256, /^[a-f0-9]{64}$/);
  assert.match(lock.pgvector.commit, /^[a-f0-9]{40}$/);
  assert.match(lock.postgresql.targets['win32-x64'].sha256, /^[a-f0-9]{64}$/);
  assert.match(lock.postgresql.targets['win32-x64'].licenseSource.sha256, /^[a-f0-9]{64}$/);
  assert.match(cacheRuntimeForTarget(lock, 'darwin-arm64').source.sha256, /^[a-f0-9]{64}$/);
  assert.match(cacheRuntimeForTarget(lock, 'win32-x64').commit, /^[a-f0-9]{40}$/);
});

test('macOS vendor implementation remains present and keeps portable pgvector flags', () => {
  const source = fs.readFileSync(
    path.join(root, 'distribution', 'scripts', 'macos', 'vendor-runtime.sh'),
    'utf8',
  );
  assert.match(source, /OPTFLAGS=""/);
  assert.match(source, /PG_CONFIG="\$PG_CONFIG"/);
  assert.match(source, /Valkey|valkey/);
  assert.match(source, /lock_value\(\)/);
  assert.match(source, /NODE_VERSION=\"\$\(lock_value nodeVersion\)\"/);
  assert.match(source, /PGVECTOR_EXPECTED_COMMIT=\"\$\(lock_value pgvectorCommit\)\"/);
  assert.doesNotMatch(source, /NODE_VERSION=\"24\.19\.0\"/);
  assert.match(source, /\"cacheProvider\": \"Valkey\"/);
  assert.match(source, /\"cacheVersion\": \"\$VALKEY_VERSION\"/);
  assert.match(source, /relocate_postgres_runtime/);
  assert.match(source, /verify_postgres_macho_relocation/);
  assert.match(source, /smoke_test_relocated_postgres/);
  assert.match(source, /install_name_tool/);
  assert.match(source, /@loader_path/);
});


test('macOS Mach-O dependency parser ignores the otool file header and rejects build-machine absolute paths', () => {
  const output = [
    '/Users/builder/SEEKMORE.app/Contents/Resources/runtime/postgres/bin/initdb:',
    '\t@loader_path/../lib/libpq.5.dylib (compatibility version 5.0.0, current version 5.18.0)',
    '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)',
    '',
  ].join('\n');

  assert.deepEqual(
    parseOtoolDependencies(output),
    [
      '@loader_path/../lib/libpq.5.dylib',
      '/usr/lib/libSystem.B.dylib',
    ],
  );

  assert.equal(
    parseOtoolInstallId([
      '/tmp/libpq.5.dylib:',
      '@loader_path/libpq.5.dylib',
      '',
    ].join('\n')),
    '@loader_path/libpq.5.dylib',
  );

  assert.deepEqual(
    parseOtoolRpaths([
      'Load command 12',
      '          cmd LC_RPATH',
      '      cmdsize 48',
      '         path @loader_path/../lib (offset 12)',
      '',
    ].join('\n')),
    ['@loader_path/../lib'],
  );

  assert.equal(isPortableMacDynamicPath('@loader_path/../lib/libpq.5.dylib'), true);
  assert.equal(isPortableMacDynamicPath('@rpath/libpq.5.dylib'), true);
  assert.equal(isPortableMacDynamicPath('/usr/lib/libSystem.B.dylib'), true);
  assert.equal(isPortableMacDynamicPath('/System/Library/Frameworks/Security.framework/Versions/A/Security'), true);
  assert.equal(isPortableMacDynamicPath('/Users/builder/seekmore/distribution/vendor/postgres/lib/libpq.5.dylib'), false);
  assert.equal(isPortableMacDynamicPath('/opt/homebrew/opt/lib/libfoo.dylib'), false);
});

test('macOS stage verification enforces PostgreSQL relocation and relocated pgvector smoke', () => {
  const source = fs.readFileSync(
    path.join(root, 'distribution', 'scripts', 'verify-stage.cjs'),
    'utf8',
  );

  assert.match(source, /assertMacPostgresMachORelocatable/);
  assert.match(source, /assertMacPostgresVectorSmoke/);
  assert.match(source, /seekmore-macos-postgres-relocated-smoke-/);
  assert.match(source, /CREATE EXTENSION vector/);
  assert.match(source, /parseOtoolDependencies/);
  assert.match(source, /parseOtoolRpaths/);
});

test('Windows vendor uses portable PostgreSQL, native pgvector and self-contained Garnet', () => {
  const source = fs.readFileSync(
    path.join(root, 'distribution', 'scripts', 'windows', 'vendor-runtime.ps1'),
    'utf8',
  );
  assert.equal(lock.postgresql.targets['win32-x64'].archive, 'postgresql-18.4-1-windows-x64-binaries.zip');
  assert.equal(lock.postgresql.targets['win32-x64'].build, 'edb-binary-zip');
  assert.equal(lock.postgresql.source.archive, 'postgresql-18.4.tar.bz2');
  assert.equal(
    lock.postgresql.source.sha256,
    '81a81ec695fb0c7901407defaa1d2f7973617154cf27ba74e3a7ab8e64436094',
  );
  assert.equal(lock.postgresql.targets['win32-x64'].licenseSource.archive, 'postgresql-18.4.tar.gz');
  assert.match(
    lock.postgresql.targets['win32-x64'].licenseSource.url,
    /^https:\/\/ftp\.postgresql\.org\/pub\/source\/v18\.4\//,
  );
  assert.equal(
    lock.postgresql.targets['win32-x64'].licenseSource.sha256,
    '450aa8f2da06c46f8221916e82ae06b04fb1040f8f00643dbf8b7d663caac0b9',
  );
  assert.match(
    source,
    /Get-VerifiedDownload[\s\S]{0,160}\$PostgresTarget\.url[\s\S]{0,160}\$PostgresArchive[\s\S]{0,160}\$PostgresTarget\.sha256/,
  );
  assert.match(source, /Copy-PostgresLicense/);
  assert.match(source, /\$PostgresTarget\.licenseSource/);
  assert.match(source, /tar\.exe/);
  assert.match(source, /curl\.exe/);
  assert.match(source, /--retry-all-errors/);
  assert.ok(lock.platformPolicy.windowsBuildRunner.requiredCommands.includes('curl.exe'));
  assert.ok(lock.platformPolicy.windowsBuildRunner.requiredCommands.includes('tar.exe'));
  assert.match(source, /attempt \$Attempt\/5/);
  assert.doesNotMatch(source, /\$Lock\.postgresql\.source/);
  assert.match(source, /Expand-Archive[\s\S]{0,100}-Path \$PostgresArchive/);
  assert.doesNotMatch(source, /meson setup/);
  assert.doesNotMatch(source, /ninja -C \$PostgresBuild/);
  assert.match(source, /nmake \/F Makefile\.win/);
  assert.match(source, /dotnet publish/);
  assert.match(source, /--self-contained' 'true/);
  assert.match(source, /GarnetServer\.csproj/);
  assert.doesNotMatch(source, /WSL|docker/i);
});

test('stage verification exposes progress and command diagnostics without weakening verification', () => {
  const source = fs.readFileSync(
    path.join(root, 'distribution', 'scripts', 'verify-stage.cjs'),
    'utf8',
  );

  assert.match(source, /async function withProgress/);
  assert.match(source, /Verifying complete stage inventory and SHA256 manifest/);
  assert.match(source, /Running bundled PostgreSQL \+ pgvector smoke test/);
  assert.match(source, /Running bundled Garnet cache smoke test/);
  assert.match(source, /Command output:/);
  assert.match(source, /resolveOnExit/);
  assert.match(source, /PostgreSQL smoke: server ready/);
  assert.match(source, /PostgreSQL smoke: temporary server fully stopped and released/);
  assert.match(source, /readWindowsPostgresMasterPid/);
  assert.match(source, /waitForProcessExit/);
  assert.match(source, /forceKillWindowsProcessTree/);
  assert.match(source, /taskkill\.exe/);
  assert.match(source, /'-t', '60'/);

  const stopCommand = source.match(
    /await capture\(\s*pgCtl,\s*\['-D', dataRoot, '-m', 'fast', '-w', '-t', '60', 'stop'\][\s\S]{0,220}?\);/,
  );
  assert.ok(stopCommand, 'Windows PostgreSQL smoke must contain a bounded pg_ctl stop command.');
  assert.doesNotMatch(stopCommand[0], /resolveOnExit/);

  assert.match(source, /assertStageManifestIntegrity/);
  assert.match(source, /assertWindowsPostgresVectorSmoke/);
  assert.match(source, /assertWindowsCacheSmoke/);
});

test('Windows Garnet smoke and managed runtime use checkpoint persistence without enabling storage tier', () => {
  const verifySource = fs.readFileSync(
    path.join(root, 'distribution', 'scripts', 'verify-stage.cjs'),
    'utf8',
  );
  const runtimeSource = fs.readFileSync(
    path.join(root, 'desktop', 'src', 'main', 'runtime', 'garnet-process.ts'),
    'utf8',
  );

  assert.match(verifySource, /async function assertWindowsCacheSmoke/);
  assert.match(verifySource, /EnableAOF:\s*true/);
  assert.match(verifySource, /Recover:\s*true/);
  assert.match(verifySource, /CheckpointDir:\s*dataRoot/);
  assert.doesNotMatch(verifySource, /LogDir:\s*dataRoot/);

  assert.match(runtimeSource, /EnableAOF:\s*true/);
  assert.match(runtimeSource, /Recover:\s*true/);
  assert.match(runtimeSource, /CheckpointDir:\s*options\.dataRoot/);
  assert.doesNotMatch(runtimeSource, /LogDir:\s*options\.dataRoot/);
});

test('Windows stage reports long-running finalization and uses non-interactive pnpm progress output', () => {
  const source = fs.readFileSync(
    path.join(root, 'distribution', 'scripts', 'stage.cjs'),
    'utf8',
  );

  assert.match(source, /async function withStageProgress/);
  assert.match(source, /Refreshing Prisma migration runtime manifest/);
  assert.match(source, /Building complete stage inventory and SHA256 manifest/);
  assert.match(source, /still running \(\$\{elapsedSeconds\}s\)/);
  assert.match(source, /target === 'win32-x64'/);
  assert.match(source, /'--reporter=append-only'/);
});

test('Windows backend stage uses pnpm hoisted node_modules so release resources are portable without junctions', () => {
  const source = fs.readFileSync(
    path.join(root, 'distribution', 'scripts', 'stage.cjs'),
    'utf8',
  );

  assert.match(source, /target === 'win32-x64'[\s\S]{0,180}'--config\.node-linker=hoisted'/);
  assert.match(source, /'--filter=backend'[\s\S]{0,100}'deploy'/);
});

test('Windows stage removes pnpm legacy-deploy workspace links without changing macOS staging', () => {
  const source = fs.readFileSync(
    path.join(root, 'distribution', 'scripts', 'stage.cjs'),
    'utf8',
  );

  assert.match(source, /target === 'win32-x64'/);
  assert.match(source, /removeWindowsLegacyDeployWorkspaceLinks/);
  assert.match(source, /'\.pnpm'[\s\S]{0,120}'node_modules'/);
  assert.match(source, /'@seekmore'[\s\S]{0,80}'desktop'/);
  assert.match(source, /sourceSegments:[\s\S]{0,80}'backend'/);
  assert.match(source, /sourceSegments:[\s\S]{0,80}'frontend'/);
});

test('release source contains existing packaging resources and migrations', () => {
  assert.ok(fs.existsSync(path.join(root, 'desktop', 'resources', 'audio', 'reminder.wav')));
  assert.ok(fs.existsSync(path.join(root, 'assets', 'app-icons', 'mac', 'SEEKMORE.png')));
  assert.ok(fs.existsSync(path.join(root, 'assets', 'app-icons', 'win', 'SEEKMORE.png')));
  const migrations = fs.readdirSync(path.join(root, 'backend', 'prisma', 'migrations'), { withFileTypes: true });
  assert.ok(migrations.some((entry) => entry.isDirectory()));
});

test('native target contract rejects cross-architecture assembly', () => {
  assert.doesNotThrow(() => assertNativeTarget('darwin-arm64', 'darwin-arm64'));
  assert.doesNotThrow(() => assertNativeTarget('win32-x64', 'win32-x64'));
  assert.throws(() => assertNativeTarget('win32-x64', 'darwin-arm64'), /Cross-target staging is forbidden/);
});

test('targetKey only exposes the supported release matrix', () => {
  assert.equal(targetKey('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(targetKey('darwin', 'x64'), 'darwin-x64');
  assert.equal(targetKey('win32', 'x64'), 'win32-x64');
  assert.throws(() => targetKey('linux', 'x64'), /Unsupported distribution target/);
});

test('Windows command adapter executes cmd/bat through cmd.exe without enabling generic shell mode', () => {
  const batchInvocation = spawnInvocation(
    'pnpm.cmd',
    ['--version'],
    'win32',
  );

  assert.equal(
    path.win32.basename(batchInvocation.command).toLowerCase(),
    'cmd.exe',
  );
  assert.deepEqual(
    batchInvocation.args,
    ['/d', '/s', '/c', 'pnpm.cmd', '--version'],
  );

  assert.deepEqual(
    spawnInvocation('node.exe', ['--version'], 'win32'),
    { command: 'node.exe', args: ['--version'] },
  );
});

test('stage manifest integrity detects post-stage mutation', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seekmore-stage-manifest-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'resources'), { recursive: true });
    const payload = path.join(tempRoot, 'resources', 'payload.txt');
    fs.writeFileSync(payload, 'seekmore\n', 'utf8');
    const files = await inventory(tempRoot);
    await assertStageManifestIntegrity(tempRoot, { files });
    fs.writeFileSync(payload, 'tampered\n', 'utf8');
    await assert.rejects(() => assertStageManifestIntegrity(tempRoot, { files }), /integrity mismatch/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('stage inventory records internal symlinks and rejects escaping symlinks', async () => {
  if (process.platform === 'win32') return;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seekmore-stage-symlink-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'node_modules', '.pnpm'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'node_modules', '.pnpm', 'payload.txt'), 'ok\n');
    fs.symlinkSync('.pnpm/payload.txt', path.join(tempRoot, 'node_modules', 'payload-link'));
    const files = await inventory(tempRoot);
    const link = files.find((entry) => entry.path === 'node_modules/payload-link');
    assert.equal(link?.type, 'symlink');
    assert.equal(link?.target, '.pnpm/payload.txt');
    fs.symlinkSync('../outside', path.join(tempRoot, 'escape-link'));
    await assert.rejects(() => inventory(tempRoot), /symlink escapes the stage root/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('stage produces an isolated immutable Prisma migration template', () => {
  const stageSource = fs.readFileSync(path.join(root, 'distribution', 'scripts', 'stage.cjs'), 'utf8');
  assert.match(stageSource, /preparePrismaMigrationRuntimeTemplate/);
  assert.match(stageSource, /'prisma-migrate'/);
  assert.match(stageSource, /runtime-manifest\.json/);
  assert.match(stageSource, /contentHash/);
  assert.match(stageSource, /copyPackageDependencyTreeHoisted/);
  assert.match(stageSource, /WINDOWS_PRISMA_RUNTIME_APP_RELATIVE_PATH_BUDGET\s*=\s*170/);
  assert.match(stageSource, /target === 'win32-x64'[\s\S]{0,260}copyPackageDependencyTreeHoisted/);

  const verifySource = fs.readFileSync(path.join(root, 'distribution', 'scripts', 'verify-stage.cjs'), 'utf8');
  assert.match(
    verifySource,
    /target === 'win32-x64'[\s\S]{0,180}\['@prisma', 'engines'\][\s\S]{0,180}\['prisma', 'node_modules', '@prisma', 'engines'\]/,
  );
  const desktopSource = fs.readFileSync(path.join(root, 'desktop', 'src', 'main', 'desktop-path-resolver.ts'), 'utf8');
  assert.match(desktopSource, /migrationRuntimeTemplateRoot/);
  assert.match(desktopSource, /'prisma-migrate'/);
});

test('Windows Prisma migration runtime rejects legacy nested engines and overlong install-relative paths', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seekmore-prisma-runtime-portability-'));

  try {
    const enginesRoot = path.join(tempRoot, 'node_modules', '@prisma', 'engines');
    fs.mkdirSync(enginesRoot, { recursive: true });
    fs.writeFileSync(
      path.join(enginesRoot, 'package.json'),
      '{\"name\":\"@prisma/engines\",\"version\":\"6.19.3\"}\n',
      'utf8',
    );

    await assert.doesNotReject(
      () => assertWindowsPrismaMigrationRuntimePortability(tempRoot),
    );

    const legacyEngines = path.join(
      tempRoot,
      'node_modules',
      'prisma',
      'node_modules',
      '@prisma',
      'engines',
    );
    fs.mkdirSync(legacyEngines, { recursive: true });
    fs.writeFileSync(path.join(legacyEngines, 'package.json'), '{}\n');

    await assert.rejects(
      () => assertWindowsPrismaMigrationRuntimePortability(tempRoot),
      /legacy nested @prisma\/engines layout/,
    );

    fs.rmSync(path.join(tempRoot, 'node_modules', 'prisma'), { recursive: true, force: true });

    const longName = 'x'.repeat(150);
    fs.writeFileSync(path.join(tempRoot, longName), 'x\n');

    await assert.rejects(
      () => assertWindowsPrismaMigrationRuntimePortability(tempRoot),
      /path exceeds the portability budget/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Windows stage compacts the Backend production runtime after Prisma migration template preparation', () => {
  const stageSource = fs.readFileSync(
    path.join(root, 'distribution', 'scripts', 'stage.cjs'),
    'utf8',
  );
  const compactSource = fs.readFileSync(
    path.join(root, 'distribution', 'scripts', 'windows', 'compact-backend.cjs'),
    'utf8',
  );
  const verifySource = fs.readFileSync(
    path.join(root, 'distribution', 'scripts', 'verify-stage.cjs'),
    'utf8',
  );

  assert.match(stageSource, /preparePrismaMigrationRuntimeTemplate[\s\S]{0,900}Windows Backend before compaction[\s\S]{0,420}Compacting Windows Backend production runtime/);
  const backendPruneIndex = stageSource.indexOf("'Windows Backend before compaction'");
  const compactIndex = stageSource.indexOf("'Compacting Windows Backend production runtime'");
  const finalStagePruneIndex = stageSource.indexOf(
    'await pruneReleaseMetadata(\n    paths.stageRoot,',
  );
  assert.ok(backendPruneIndex >= 0, 'Windows Backend metadata prune must be present');
  assert.ok(compactIndex > backendPruneIndex, 'Windows Backend metadata prune must run before compaction');
  assert.ok(finalStagePruneIndex > compactIndex, 'final Stage metadata prune must remain after compaction');
  assert.match(stageSource, /compactWindowsBackend/);
  assert.match(compactSource, /esbuild\.build/);
  assert.match(compactSource, /target: \['node24'\]/);
  assert.match(compactSource, /format: 'cjs'/);
  assert.match(compactSource, /backend-runtime-manifest\.json/);
  assert.match(compactSource, /@prisma\/client/);
  assert.match(compactSource, /'class-transformer'/);
  assert.match(compactSource, /'class-validator'/);
  assert.match(compactSource, /'sharp'/);
  assert.match(compactSource, /copyPackageClosure/);
  assert.match(compactSource, /Filesystem link is not allowed/);
  assert.match(compactSource, /builtinModules/);
  assert.match(compactSource, /optionalUnresolvedExternals/);
  assert.match(compactSource, /packageRootFromSpecifier/);

  assert.match(verifySource, /assertWindowsBackendCompaction/);
  assert.doesNotMatch(verifySource, /reductionPercent < 50/);
  assert.match(verifySource, /reducedFiles !== expectedReducedFiles/);
  assert.match(verifySource, /reducedBytes !== expectedReducedBytes/);
  assert.match(verifySource, /reductionPercent !== expectedFilePercent/);
  assert.match(verifySource, /byteReductionPercent !== expectedBytePercent/);
  assert.match(verifySource, /generated Prisma client package/);
  assert.match(verifySource, /require\('class-transformer'\)/);
  assert.match(verifySource, /require\('class-validator'\)/);
  assert.match(verifySource, /new ValidationPipe\(\{ transform: true \}\)/);
  assert.match(verifySource, /require\('@nestjs\/platform-socket\.io'\)/);
  assert.match(verifySource, /require\('socket\.io'\)/);
  assert.match(verifySource, /require\('engine\.io-parser'\)/);
  assert.match(verifySource, /require\('@socket\.io\/component-emitter'\)/);
  assert.match(verifySource, /!entry\.version\.trim\(\)/);
});

test('Windows Backend compaction classifies Node builtins and package externals without treating guarded optional packages as release defects', () => {
  const compactModule = require(
    path.join(root, 'distribution', 'scripts', 'windows', 'compact-backend.cjs'),
  );

  for (const builtinName of [
    'assert',
    'async_hooks',
    'buffer',
    'child_process',
    'constants',
    'crypto',
    'dns',
    'events',
    'fs',
    'fs/promises',
    'http',
    'https',
    'net',
    'os',
    'path',
    'process',
    'querystring',
    'stream',
    'string_decoder',
    'timers',
    'tls',
    'tty',
    'url',
    'util',
    'zlib',
    'node:fs',
  ]) {
    assert.equal(compactModule.isNodeBuiltinSpecifier(builtinName), true);
  }

  assert.equal(compactModule.packageRootFromSpecifier('supports-color'), 'supports-color');
  assert.equal(compactModule.packageRootFromSpecifier('bufferutil'), 'bufferutil');
  assert.equal(compactModule.packageRootFromSpecifier('utf-8-validate'), 'utf-8-validate');
  assert.equal(compactModule.packageRootFromSpecifier('@scope/pkg/subpath'), '@scope/pkg');
  assert.equal(compactModule.packageRootFromSpecifier('./relative-runtime.js'), null);
  assert.equal(compactModule.packageRootFromSpecifier('C:/absolute/runtime.js'), null);
});


test('Windows Backend compaction resolves real node_modules package roots instead of nested package metadata markers', () => {
  const compactModule = require(
    path.join(root, 'distribution', 'scripts', 'windows', 'compact-backend.cjs'),
  );
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'seekmore-package-root-'),
  );
  const nodeModulesRoot = path.join(tempRoot, 'node_modules');

  try {
    const engineRoot = path.join(nodeModulesRoot, 'engine.io-parser');
    fs.mkdirSync(path.join(engineRoot, 'build', 'cjs'), { recursive: true });
    fs.writeFileSync(
      path.join(engineRoot, 'package.json'),
      JSON.stringify({
        name: 'engine.io-parser',
        version: '5.2.3',
        main: 'build/cjs/index.js',
      }),
    );
    fs.writeFileSync(
      path.join(engineRoot, 'build', 'cjs', 'package.json'),
      JSON.stringify({
        name: 'engine.io-parser',
        type: 'commonjs',
      }),
    );
    fs.writeFileSync(
      path.join(engineRoot, 'build', 'cjs', 'index.js'),
      'module.exports = {};\n',
    );

    const emitterRoot = path.join(
      nodeModulesRoot,
      '@socket.io',
      'component-emitter',
    );
    fs.mkdirSync(path.join(emitterRoot, 'lib', 'cjs'), { recursive: true });
    fs.writeFileSync(
      path.join(emitterRoot, 'package.json'),
      JSON.stringify({
        name: '@socket.io/component-emitter',
        version: '3.1.2',
        main: 'lib/cjs/index.js',
      }),
    );
    fs.writeFileSync(
      path.join(emitterRoot, 'lib', 'cjs', 'package.json'),
      JSON.stringify({
        name: '@socket.io/component-emitter',
        type: 'commonjs',
      }),
    );
    fs.writeFileSync(
      path.join(emitterRoot, 'lib', 'cjs', 'index.js'),
      'module.exports = {};\n',
    );

    assert.equal(
      compactModule.resolvePackageRoot(
        'engine.io-parser',
        tempRoot,
        nodeModulesRoot,
      ),
      engineRoot,
    );
    assert.equal(
      compactModule.resolvePackageRoot(
        '@socket.io/component-emitter',
        tempRoot,
        nodeModulesRoot,
      ),
      emitterRoot,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Windows stage verification writes a receipt only after full verification and can reuse it downstream', () => {
  const verifySource = fs.readFileSync(
    path.join(root, 'distribution', 'scripts', 'verify-stage.cjs'),
    'utf8',
  );
  const receiptSource = fs.readFileSync(
    path.join(root, 'distribution', 'scripts', 'windows', 'verification-receipt.cjs'),
    'utf8',
  );

  assert.match(verifySource, /writeStageVerificationReceipt/);
  assert.match(verifySource, /async function ensureVerifiedStage/);
  assert.match(verifySource, /skipping duplicate full Stage SHA256 verification/);
  assert.match(receiptSource, /verificationContractSha256/);
  assert.match(receiptSource, /rootPackageSha256/);
  assert.match(receiptSource, /pnpmLockSha256/);
  assert.match(receiptSource, /runtimeLockSha256/);
  assert.match(receiptSource, /installerLockSha256/);
});
