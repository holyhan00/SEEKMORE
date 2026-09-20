const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ManagedBackendProcess,
  reserveLoopbackPort,
} = require('../dist/main/runtime');

test('managed backend starts on loopback, becomes healthy, logs output and shuts down gracefully', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seekmore-managed-backend-'));
  const entryPath = path.join(root, 'backend.js');
  const logPath = path.join(root, 'logs', 'backend.log');
  const port = await reserveLoopbackPort();

  await fs.writeFile(entryPath, `
    const http = require('node:http');
    const host = process.env.HOST;
    const port = Number(process.env.PORT);
    const server = http.createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(port, host, () => console.log('fixture-ready'));
    process.on('SIGTERM', () => {
      console.log('fixture-stopping');
      server.close(() => process.exit(0));
    });
  `, 'utf8');

  const backend = new ManagedBackendProcess({
    nodeExecutablePath: process.execPath,
    backendEntryPath: entryPath,
    backendRoot: root,
    host: '127.0.0.1',
    port,
    environment: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
    },
    logPath,
    healthTimeoutMs: 10_000,
    shutdownTimeoutMs: 5_000,
  });

  try {
    const info = await backend.start();
    assert.ok(info.pid > 0);
    assert.equal(info.origin, `http://127.0.0.1:${port}`);

    const health = await fetch(`${info.origin}/api/health`);
    assert.equal(health.status, 200);
  } finally {
    await backend.stop();
  }

  await new Promise((resolve) => setTimeout(resolve, 50));
  const log = await fs.readFile(logPath, 'utf8');
  assert.match(log, /fixture-ready/);
  if (process.platform === 'win32') {
    assert.match(log, /SEEKMORE managed backend stopped/);
  } else {
    assert.match(log, /fixture-stopping/);
  }

  await fs.rm(root, { recursive: true, force: true });
});

test('managed backend reports a missing bundled Node executable before spawning', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seekmore-managed-backend-'));
  try {
    const backend = new ManagedBackendProcess({
      nodeExecutablePath: path.join(root, 'missing-node'),
      backendEntryPath: path.join(root, 'missing-backend.js'),
      backendRoot: root,
      host: '127.0.0.1',
      port: await reserveLoopbackPort(),
      environment: {},
      logPath: path.join(root, 'backend.log'),
    });

    await assert.rejects(
      () => backend.start(),
      /Bundled Node executable is missing/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
