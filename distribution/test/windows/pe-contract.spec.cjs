const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { assertPeX64, readPeMachine } = require('../../scripts/distribution-lib.cjs');

function pe(machine) {
  const buffer = Buffer.alloc(512);
  buffer.write('MZ', 0, 'ascii');
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write('PE\0\0', 0x80, 'binary');
  buffer.writeUInt16LE(machine, 0x84);
  return buffer;
}

test('PE contract recognizes AMD64 and rejects x86', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seekmore-pe-contract-'));
  try {
    const amd64 = path.join(root, 'amd64.exe');
    const x86 = path.join(root, 'x86.exe');
    fs.writeFileSync(amd64, pe(0x8664));
    fs.writeFileSync(x86, pe(0x014c));
    assert.equal(readPeMachine(amd64), 0x8664);
    assert.doesNotThrow(() => assertPeX64(amd64, 'AMD64 fixture'));
    assert.throws(() => assertPeX64(x86, 'x86 fixture'), /AMD64/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
