const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const SUPPORTED_TARGETS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'win32-x64',
]);

function repoRoot(from = __dirname) {
  let current = path.resolve(from);

  for (let depth = 0; depth < 8; depth += 1) {
    if (
      fs.existsSync(
        path.join(
          current,
          'distribution',
          'runtime-lock.json',
        ),
      )
    ) {
      return current;
    }

    if (
      path.basename(current) === 'distribution'
      && fs.existsSync(
        path.join(current, 'runtime-lock.json'),
      )
    ) {
      return path.dirname(current);
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    `[Distribution] Could not resolve repository root from ${from}.`,
  );
}

function targetKey(
  platform = process.platform,
  arch = process.arch,
) {
  const value = `${platform}-${arch}`;

  if (!SUPPORTED_TARGETS.has(value)) {
    throw new Error(
      `[Distribution] Unsupported distribution target: ${value}`,
    );
  }

  return value;
}

function loadRuntimeLock(root) {
  const file = path.join(
    root,
    'distribution',
    'runtime-lock.json',
  );

  return JSON.parse(
    fs.readFileSync(file, 'utf8'),
  );
}

function cacheRuntimeForTarget(
  lock,
  target,
) {
  const state =
    lock.cacheRuntime?.targets?.[target];

  if (!state) {
    throw new Error(
      `[Distribution] Runtime lock has no cache runtime target entry for ${target}.`,
    );
  }

  return state;
}

function assertTargetEnabled(
  lock,
  target,
) {

  const state =
    cacheRuntimeForTarget(
      lock,
      target,
    );

  if (state.status !== 'supported') {
    throw new Error(
      `[Distribution] ${target} distribution is blocked: ${
        state.reason
        || 'cache runtime provider unavailable'
      }`,
    );
  }
}

async function assertReleaseToolchain(
  root,
) {
  const lock = loadRuntimeLock(root);

  const expectedNode =
    `v${lock.node.version}`;

  if (process.version !== expectedNode) {
    throw new Error(
      `[Distribution] Release build requires Node ${expectedNode}; current build Node is ${process.version}.`,
    );
  }

  const packageJson = JSON.parse(
    await fsp.readFile(
      path.join(
        root,
        'package.json',
      ),
      'utf8',
    ),
  );

  const expectedPnpm = String(
    packageJson.packageManager || '',
  ).match(/^pnpm@(.+)$/)?.[1];

  if (!expectedPnpm) {
    throw new Error(
      '[Distribution] Root packageManager must pin an exact pnpm version.',
    );
  }

  const { stdout } = await capture(
    pnpmCommand(),
    ['--version'],
    {
      cwd: root,
      env: process.env,
    },
  );

  const actualPnpm =
    stdout.trim();

  if (
    actualPnpm !== expectedPnpm
  ) {
    throw new Error(
      `[Distribution] Release build requires pnpm ${expectedPnpm}; current pnpm is ${
        actualPnpm || 'unknown'
      }.`,
    );
  }
}

function assertNativeTarget(
  target,
  nativeTarget = targetKey(),
) {
  if (target !== nativeTarget) {
    throw new Error(
      `[Distribution] Cross-target staging is forbidden. Requested ${target}, native runner is ${nativeTarget}.`,
    );
  }
}

function stagePaths(
  root,
  target,
) {
  const stageRoot = path.join(
    root,
    'distribution',
    'stage',
    target,
  );

  return {
    stageRoot,

    appRoot: path.join(
      stageRoot,
      'app',
    ),

    resourcesRoot: path.join(
      stageRoot,
      'resources',
    ),

    frontendRoot: path.join(
      stageRoot,
      'resources',
      'frontend',
    ),

    backendRoot: path.join(
      stageRoot,
      'resources',
      'backend',
    ),

    runtimeRoot: path.join(
      stageRoot,
      'resources',
      'runtime',
    ),

    audioRoot: path.join(
      stageRoot,
      'resources',
      'resources',
      'audio',
    ),

    licensesRoot: path.join(
      stageRoot,
      'resources',
      'licenses',
    ),

    packagingRoot: path.join(
      stageRoot,
      'packaging',
    ),

    manifestPath: path.join(
      stageRoot,
      'stage-manifest.json',
    ),
  };
}

function spawnInvocation(
  command,
  args,
  platform = process.platform,
) {
  if (
    platform === 'win32'
    && /\.(?:cmd|bat)$/i.test(command)
  ) {
    const commandProcessor =
      process.env.ComSpec
      || process.env.COMSPEC
      || 'cmd.exe';

    return {
      command: commandProcessor,
      args: [
        '/d',
        '/s',
        '/c',
        command,
        ...args,
      ],
    };
  }

  return {
    command,
    args,
  };
}

function readPeMachine(file) {
  const fd = fs.openSync(file, 'r');

  try {
    const dosHeader = Buffer.alloc(64);
    if (fs.readSync(fd, dosHeader, 0, dosHeader.length, 0) < 64) {
      throw new Error(
        `[Distribution] PE file is too small: ${file}`,
      );
    }

    if (dosHeader.readUInt16LE(0) !== 0x5a4d) {
      throw new Error(
        `[Distribution] Missing DOS MZ header: ${file}`,
      );
    }

    const peOffset = dosHeader.readUInt32LE(0x3c);
    const peHeader = Buffer.alloc(6);
    if (fs.readSync(fd, peHeader, 0, peHeader.length, peOffset) < 6) {
      throw new Error(
        `[Distribution] Missing PE header: ${file}`,
      );
    }

    if (peHeader.readUInt32LE(0) !== 0x00004550) {
      throw new Error(
        `[Distribution] Invalid PE signature: ${file}`,
      );
    }

    return peHeader.readUInt16LE(4);
  } finally {
    fs.closeSync(fd);
  }
}

function assertPeX64(file, label = 'PE binary') {
  const machine = readPeMachine(file);

  if (machine !== 0x8664) {
    throw new Error(
      `[Distribution] ${label} must be PE32+ AMD64 (0x8664); got 0x${machine
        .toString(16)
        .padStart(4, '0')}: ${file}`,
    );
  }
}

async function run(
  command,
  args,
  options = {},
) {
  await new Promise(
    (resolve, reject) => {
      const invocation = spawnInvocation(
        command,
        args,
      );

      const child = spawn(
        invocation.command,
        invocation.args,
        {
          stdio: 'inherit',
          shell: false,
          windowsHide: true,
          ...options,
        },
      );

      child.once(
        'error',
        reject,
      );

      child.once(
        'close',
        (code) => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(
            new Error(
              `[Distribution] Command failed (${code}): ${command} ${args.join(
                ' ',
              )}`,
            ),
          );
        },
      );
    },
  );
}

function pnpmCommand(
  platform = process.platform,
) {
  return platform === 'win32'
    ? 'pnpm.cmd'
    : 'pnpm';
}

function capture(
  command,
  args,
  options = {},
) {
  return new Promise(
    (resolve, reject) => {
      const invocation = spawnInvocation(
        command,
        args,
      );

      const child = spawn(
        invocation.command,
        invocation.args,
        {
          stdio: [
            'ignore',
            'pipe',
            'pipe',
          ],
          shell: false,
          windowsHide: true,
          ...options,
        },
      );

      let stdout = '';
      let stderr = '';

      child.stdout.on(
        'data',
        (chunk) => {
          stdout += String(chunk);
        },
      );

      child.stderr.on(
        'data',
        (chunk) => {
          stderr += String(chunk);
        },
      );

      child.once(
        'error',
        reject,
      );

      child.once(
        'close',
        (code) => {
          if (code === 0) {
            resolve({
              stdout,
              stderr,
            });
            return;
          }

          reject(
            new Error(
              `[Distribution] Command failed (${code}): ${command} ${args.join(
                ' ',
              )}${
                stderr.trim()
                  ? `\n${stderr.trim()}`
                  : ''
              }`,
            ),
          );
        },
      );
    },
  );
}

async function ensureFile(
  file,
  label = 'file',
) {
  const stat = await fsp
    .stat(file)
    .catch(() => null);

  if (!stat?.isFile()) {
    throw new Error(
      `[Distribution] Missing ${label}: ${file}`,
    );
  }
}

async function ensureDirectory(
  dir,
  label = 'directory',
) {
  const stat = await fsp
    .stat(dir)
    .catch(() => null);

  if (!stat?.isDirectory()) {
    throw new Error(
      `[Distribution] Missing ${label}: ${dir}`,
    );
  }
}

async function copyTree(
  source,
  destination,
) {
  await ensureDirectory(
    source,
    'source directory',
  );

  await fsp.mkdir(
    path.dirname(destination),
    {
      recursive: true,
    },
  );

  await fsp.cp(
    source,
    destination,
    {
      recursive: true,
      force: true,
      dereference: false,
      verbatimSymlinks: true,
    },
  );
}

async function sha256File(
  file,
) {
  const hash =
    crypto.createHash('sha256');

  await new Promise(
    (resolve, reject) => {
      const stream =
        fs.createReadStream(file);

      stream.on(
        'data',
        (chunk) => {
          hash.update(chunk);
        },
      );

      stream.once(
        'error',
        reject,
      );

      stream.once(
        'end',
        resolve,
      );
    },
  );

  return hash.digest('hex');
}

async function inventory(
  root,
) {
  const out = [];

  const normalizedRoot =
    path.resolve(root);

  async function walk(
    current,
  ) {
    const entries =
      await fsp.readdir(
        current,
        {
          withFileTypes: true,
        },
      );

    entries.sort(
      (a, b) =>
        a.name.localeCompare(
          b.name,
        ),
    );

    for (
      const entry
      of entries
    ) {
      const absolute = path.join(
        current,
        entry.name,
      );

      const relative = path
        .relative(
          root,
          absolute,
        )
        .split(path.sep)
        .join('/');

      if (
        entry.isDirectory()
      ) {
        await walk(absolute);
      } else if (
        entry.isFile()
      ) {
        const stat =
          await fsp.stat(
            absolute,
          );

        out.push({
          path: relative,
          type: 'file',
          size: stat.size,
          sha256:
            await sha256File(
              absolute,
            ),
        });
      } else if (
        entry.isSymbolicLink()
      ) {
        const target =
          await fsp.readlink(
            absolute,
          );

        const resolved =
          path.resolve(
            path.dirname(
              absolute,
            ),
            target,
          );

        const relativeResolved =
          path.relative(
            normalizedRoot,
            resolved,
          );

        if (
          relativeResolved === '..'
          || relativeResolved.startsWith(
            `..${path.sep}`,
          )
          || path.isAbsolute(
            relativeResolved,
          )
        ) {
          throw new Error(
            `[Distribution] Stage symlink escapes the stage root: ${relative} -> ${target}`,
          );
        }

        const targetBytes =
          Buffer.from(
            target,
            'utf8',
          );

        out.push({
          path: relative,
          type: 'symlink',
          target,
          size:
            targetBytes.length,
          sha256:
            crypto
              .createHash(
                'sha256',
              )
              .update(
                targetBytes,
              )
              .digest('hex'),
        });
      }
    }
  }

  await walk(root);

  return out;
}

module.exports = {
  assertNativeTarget,
  assertPeX64,
  assertReleaseToolchain,
  assertTargetEnabled,
  cacheRuntimeForTarget,
  capture,
  copyTree,
  ensureDirectory,
  ensureFile,
  inventory,
  loadRuntimeLock,
  pnpmCommand,
  repoRoot,
  readPeMachine,
  run,
  spawnInvocation,
  stagePaths,
  targetKey,
};