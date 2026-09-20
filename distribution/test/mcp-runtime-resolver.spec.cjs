const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DesktopMcpRuntimeResolver,
} = require('../dist/main/mcp/desktop-mcp-runtime-resolver.js');

async function createExecutable(
  file,
  content = '#!/bin/sh\nexit 0\n',
) {
  await fsp.mkdir(
    path.dirname(file),
    { recursive: true },
  );
  await fsp.writeFile(
    file,
    content,
    'utf8',
  );
  await fsp.chmod(
    file,
    0o755,
  );
  return file;
}

async function canonicalPath(file) {
  return await fsp.realpath(
    file,
  ).catch(
    () => path.resolve(file),
  );
}

async function fixture(
  options = {},
) {
  const root = await fsp.mkdtemp(
    path.join(
      os.tmpdir(),
      'seekmore-mcp-runtime-',
    ),
  );
  const resourcesPath = path.join(
    root,
    'resources',
  );
  const appPath = path.join(
    root,
    'app',
  );
  const homePath = path.join(
    root,
    'home',
  );
  const systemBin = path.join(
    root,
    'system-bin',
  );
  const runtimeBin = path.join(
    resourcesPath,
    'runtime',
    'node',
    'bin',
  );

  await Promise.all([
    fsp.mkdir(
      runtimeBin,
      { recursive: true },
    ),
    fsp.mkdir(
      systemBin,
      { recursive: true },
    ),
    fsp.mkdir(
      homePath,
      { recursive: true },
    ),
  ]);

  const environment = {
    PATH: systemBin,
    HOME: homePath,
    LANG: 'en_US.UTF-8',
    ...options.environment,
  };

  const resolver =
    new DesktopMcpRuntimeResolver({
      packaged:
        options.packaged
        ?? true,
      resourcesPath,
      appPath,
      homePath,
      platform: 'darwin',
      arch: 'arm64',
      environment,
    });

  return {
    root,
    resourcesPath,
    appPath,
    homePath,
    systemBin,
    runtimeBin,
    environment,
    resolver,
  };
}

async function withFixture(
  callback,
  options,
) {
  const state =
    await fixture(options);

  try {
    return await callback(state);
  } finally {
    await fsp.rm(
      state.root,
      {
        recursive: true,
        force: true,
      },
    );
  }
}

test(
  'packaged managed Node commands resolve to SEEKMORE bundled runtime',
  async () => {
    await withFixture(
      async ({
        resolver,
        runtimeBin,
      }) => {
        for (
          const command
          of [
            'node',
            'npm',
            'npx',
            'corepack',
          ]
        ) {
          const expected =
            await createExecutable(
              path.join(
                runtimeBin,
                command,
              ),
            );

          assert.equal(
            await resolver.resolveExecutable(
              command,
            ),
            expected,
          );
        }
      },
    );
  },
);

test(
  'packaged managed command fails closed when bundled executable is missing',
  async () => {
    await withFixture(
      async ({
        resolver,
        systemBin,
      }) => {
        await createExecutable(
          path.join(
            systemBin,
            'npx',
          ),
        );

        await assert.rejects(
          resolver.resolveExecutable(
            'npx',
          ),
          (error) => {
            assert.equal(
              error?.code,
              'MCP_STDIO_MANAGED_RUNTIME_MISSING',
            );
            return true;
          },
        );
      },
    );
  },
);

test(
  'packaged PATH prepends bundled Node bin',
  async () => {
    await withFixture(
      async ({
        resolver,
        runtimeBin,
        systemBin,
      }) => {
        const environment =
          resolver.cleanEnvironment({});
        const entries =
          environment.PATH.split(
            path.delimiter,
          );

        assert.equal(
          entries[0],
          runtimeBin,
        );
        assert.ok(
          entries.includes(
            systemBin,
          ),
        );
      },
    );
  },
);

test(
  'explicit executable path remains explicit',
  async () => {
    await withFixture(
      async ({
        resolver,
        root,
      }) => {
        const executable =
          await createExecutable(
            path.join(
              root,
              'custom',
              'server',
            ),
          );

        assert.equal(
          await resolver.resolveExecutable(
            executable,
          ),
          await canonicalPath(
            executable,
          ),
        );
      },
    );
  },
);

test(
  'non-managed command continues to resolve from system PATH',
  async () => {
    await withFixture(
      async ({
        resolver,
        systemBin,
      }) => {
        const uvx =
          await createExecutable(
            path.join(
              systemBin,
              'uvx',
            ),
          );

        assert.equal(
          await resolver.resolveExecutable(
            'uvx',
          ),
          await canonicalPath(
            uvx,
          ),
        );
      },
    );
  },
);

test(
  'development npx continues to resolve from development PATH',
  async () => {
    await withFixture(
      async ({
        resolver,
        systemBin,
      }) => {
        const npx =
          await createExecutable(
            path.join(
              systemBin,
              'npx',
            ),
          );

        assert.equal(
          await resolver.resolveExecutable(
            'npx',
          ),
          await canonicalPath(
            npx,
          ),
        );
      },
      {
        packaged: false,
      },
    );
  },
);

test(
  'explicit PATH cannot override SEEKMORE managed PATH',
  async () => {
    await withFixture(
      async ({
        resolver,
        runtimeBin,
        systemBin,
      }) => {
        const environment =
          resolver.cleanEnvironment({
            PATH: '/tmp/attacker-path',
            HOME: '/tmp/attacker-home',
            FOO: 'bar',
          });

        const entries =
          environment.PATH.split(
            path.delimiter,
          );

        assert.equal(
          entries[0],
          runtimeBin,
        );
        assert.ok(
          entries.includes(
            systemBin,
          ),
        );
        assert.equal(
          entries.includes(
            '/tmp/attacker-path',
          ),
          false,
        );
        assert.notEqual(
          environment.HOME,
          '/tmp/attacker-home',
        );
        assert.equal(
          environment.FOO,
          'bar',
        );
      },
    );
  },
);

test(
  'packaged managed npx cannot be redirected by same-name system executable',
  async () => {
    await withFixture(
      async ({
        resolver,
        runtimeBin,
        systemBin,
      }) => {
        const bundled =
          await createExecutable(
            path.join(
              runtimeBin,
              'npx',
            ),
          );
        await createExecutable(
          path.join(
            systemBin,
            'npx',
          ),
        );

        assert.equal(
          await resolver.resolveExecutable(
            'npx',
          ),
          bundled,
        );
      },
    );
  },
);

test(
  'pre-existing Desktop resource bin lookup remains available for non-managed commands',
  async () => {
    await withFixture(
      async ({
        resolver,
        resourcesPath,
      }) => {
        const executable =
          await createExecutable(
            path.join(
              resourcesPath,
              'bin',
              'custom-mcp',
            ),
          );

        assert.equal(
          await resolver.resolveExecutable(
            'custom-mcp',
          ),
          await canonicalPath(
            executable,
          ),
        );
      },
    );
  },
);

test(
  'managed launcher suffix still uses packaged managed-runtime policy',
  async () => {
    await withFixture(
      async ({ resolver }) => {
        await assert.rejects(
          resolver.resolveExecutable(
            'npx.cmd',
          ),
          (error) => {
            assert.equal(
              error?.code,
              'MCP_STDIO_MANAGED_RUNTIME_MISSING',
            );
            return true;
          },
        );
      },
    );
  },
);
test(
  'Windows packaged npm/npx/corepack invocations run their bundled JS entry through bundled node.exe',
  async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'seekmore-mcp-runtime-win-'));
    try {
      const resourcesPath = path.join(root, 'resources');
      const nodeRoot = path.join(resourcesPath, 'runtime', 'node');
      await fsp.mkdir(path.join(nodeRoot, 'node_modules', 'npm', 'bin'), { recursive: true });
      await fsp.mkdir(path.join(nodeRoot, 'node_modules', 'corepack', 'dist'), { recursive: true });
      for (const file of [
        path.join(nodeRoot, 'node.exe'),
        path.join(nodeRoot, 'npm.cmd'),
        path.join(nodeRoot, 'npx.cmd'),
        path.join(nodeRoot, 'corepack.cmd'),
        path.join(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(nodeRoot, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
        path.join(nodeRoot, 'node_modules', 'corepack', 'dist', 'corepack.js'),
      ]) {
        await fsp.writeFile(file, 'fixture');
      }
      const resolver = new DesktopMcpRuntimeResolver({
        packaged: true,
        resourcesPath,
        homePath: root,
        platform: 'win32',
        arch: 'x64',
        environment: { PATH: '', ComSpec: 'cmd.exe' },
      });
      const invocation = await resolver.resolveInvocation('npx', ['-y', 'server']);
      assert.equal(invocation.command, path.join(nodeRoot, 'node.exe'));
      assert.deepEqual(invocation.args, [
        path.join(nodeRoot, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
        '-y',
        'server',
      ]);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  },
);
