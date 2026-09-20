const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  SeekmoreRuntimeSecretStore,
} = require('../dist/main/runtime');

function fakeEncryption() {
  return {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value) => {
      const text = value.toString('utf8');
      assert.ok(text.startsWith('encrypted:'));
      return text.slice('encrypted:'.length);
    },
  };
}

test('runtime secrets are created once and remain stable across launches', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seekmore-runtime-secrets-'));
  const filePath = path.join(root, 'secrets', 'runtime-secrets.json');
  try {
    const first = await new SeekmoreRuntimeSecretStore(
      filePath,
      fakeEncryption(),
    ).loadOrCreate();
    const second = await new SeekmoreRuntimeSecretStore(
      filePath,
      fakeEncryption(),
    ).loadOrCreate();

    assert.deepEqual(second, first);
    assert.ok(first.jwtAccessSecret.length >= 32);
    assert.ok(first.jwtRefreshSecret.length >= 32);
    assert.equal(Buffer.from(first.mcpSecretEncryptionKey, 'base64').length, 32);
    assert.ok(first.postgresPassword.length >= 32);
    assert.ok(first.redisPassword.length >= 32);

    const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.equal(stored.version, 2);
    assert.equal(typeof stored.encryptedBase64, 'string');
    assert.equal(JSON.stringify(stored).includes(first.jwtAccessSecret), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an invalid existing runtime secret store fails closed instead of regenerating secrets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seekmore-runtime-secrets-'));
  const filePath = path.join(root, 'runtime-secrets.json');
  try {
    await fs.writeFile(filePath, '{invalid-json', 'utf8');
    const before = await fs.readFile(filePath, 'utf8');

    await assert.rejects(
      () => new SeekmoreRuntimeSecretStore(
        filePath,
        fakeEncryption(),
      ).loadOrCreate(),
      /runtime secret store is invalid/i,
    );

    assert.equal(await fs.readFile(filePath, 'utf8'), before);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('runtime secret creation fails when secure storage is unavailable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seekmore-runtime-secrets-'));
  try {
    const store = new SeekmoreRuntimeSecretStore(
      path.join(root, 'runtime-secrets.json'),
      {
        isAvailable: () => false,
        encryptString: () => Buffer.alloc(0),
        decryptString: () => '',
      },
    );

    await assert.rejects(
      () => store.loadOrCreate(),
      /safeStorage is unavailable/i,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('runtime secret stores upgrade in place without rotating existing JWT/MCP secrets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seekmore-runtime-secrets-upgrade-'));
  const filePath = path.join(root, 'runtime-secrets.json');
  try {
    const legacyPayload = {
      version: 1,
      jwtAccessSecret: 'legacy-access-secret',
      jwtRefreshSecret: 'legacy-refresh-secret',
      mcpSecretEncryptionKey: Buffer.alloc(32, 9).toString('base64'),
    };
    const encryption = fakeEncryption();
    const encrypted = encryption.encryptString(JSON.stringify(legacyPayload));
    await fs.writeFile(filePath, JSON.stringify({
      version: 1,
      encryptedBase64: encrypted.toString('base64'),
      updatedAt: new Date().toISOString(),
    }));

    const upgraded = await new SeekmoreRuntimeSecretStore(
      filePath,
      encryption,
    ).loadOrCreate();

    assert.equal(upgraded.jwtAccessSecret, legacyPayload.jwtAccessSecret);
    assert.equal(upgraded.jwtRefreshSecret, legacyPayload.jwtRefreshSecret);
    assert.equal(upgraded.mcpSecretEncryptionKey, legacyPayload.mcpSecretEncryptionKey);
    assert.ok(upgraded.postgresPassword.length >= 32);
    assert.ok(upgraded.redisPassword.length >= 32);

    const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.equal(stored.version, 2);

    const second = await new SeekmoreRuntimeSecretStore(
      filePath,
      encryption,
    ).loadOrCreate();
    assert.deepEqual(second, upgraded);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
