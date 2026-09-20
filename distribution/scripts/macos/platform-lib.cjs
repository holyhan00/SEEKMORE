const fsp = require('node:fs/promises');
const path = require('node:path');

const {
  capture,
  ensureDirectory,
  ensureFile,
} = require('../distribution-lib.cjs');

function dmgFileName(
  productName,
  version,
  arch,
) {
  return `${productName}-${version}-${arch}.dmg`;
}

async function findUniqueAppBundle(
  searchRoot,
  productName = 'SEEKMORE',
) {
  await ensureDirectory(
    searchRoot,
    'macOS app output directory',
  );

  const matches = [];

  async function walk(dir) {
    const entries = await fsp.readdir(
      dir,
      { withFileTypes: true },
    );

    for (const entry of entries) {
      const absolute = path.join(
        dir,
        entry.name,
      );

      if (
        entry.isDirectory()
        && entry.name === `${productName}.app`
      ) {
        matches.push(absolute);
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolute);
      }
    }
  }

  await walk(searchRoot);

  if (matches.length !== 1) {
    throw new Error(
      `[macOS Package] Expected exactly one ${productName}.app under ${searchRoot}; found ${matches.length}.`,
    );
  }

  return matches[0];
}

async function readPlistValue(
  plistPath,
  key,
) {
  const { stdout } = await capture(
    'plutil',
    [
      '-extract',
      key,
      'raw',
      '-o',
      '-',
      plistPath,
    ],
  );

  return stdout.trim();
}

async function assertExecutable(
  file,
  label,
) {
  await ensureFile(file, label);

  const stat = await fsp.stat(file);

  if ((stat.mode & 0o111) === 0) {
    throw new Error(
      `[macOS Verify] ${label} is not executable: ${file}`,
    );
  }
}

async function assertMachOArchitecture(
  file,
  expectedArch,
  label,
) {
  const { stdout, stderr } =
    await capture(
      'lipo',
      ['-archs', file],
    );

  const archs = `${stdout} ${stderr}`
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!archs.includes(expectedArch)) {
    throw new Error(
      `[macOS Verify] ${label} architecture ${archs.join(', ') || 'unknown'} does not include ${expectedArch}.`,
    );
  }

  if (archs.length !== 1) {
    throw new Error(
      `[macOS Verify] ${label} must be a single-architecture ${expectedArch} binary; got ${archs.join(', ')}.`,
    );
  }
}

module.exports = {
  assertExecutable,
  assertMachOArchitecture,
  dmgFileName,
  findUniqueAppBundle,
  readPlistValue,
};
