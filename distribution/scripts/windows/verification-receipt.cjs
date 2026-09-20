const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const {
  stagePaths,
} = require('../distribution-lib.cjs');

const {
  releasePaths,
  sha256File,
} = require('../packaging-lib.cjs');

const RECEIPT_SCHEMA_VERSION = 1;

function receiptPaths(root, target) {
  const release = releasePaths(root, target);
  const verificationRoot = path.join(release.releaseRoot, '.verification');
  return {
    verificationRoot,
    stageReceiptPath: path.join(verificationRoot, 'stage.json'),
    appReceiptPath: path.join(verificationRoot, 'app.json'),
  };
}

async function writeStageVerificationReceipt(root, target) {
  const stage = stagePaths(root, target);
  const paths = receiptPaths(root, target);
  const identity = await releaseIdentity(root);
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: 'stage',
    target,
    ...identity,
    verificationContractSha256: await stageVerificationContractHash(root),
    stageManifestSha256: await sha256File(stage.manifestPath),
    verifiedAt: new Date().toISOString(),
  };

  await writeReceipt(paths.stageReceiptPath, receipt);
  await fsp.rm(paths.appReceiptPath, { force: true });
  return receipt;
}

async function readValidStageVerificationReceipt(root, target) {
  const paths = receiptPaths(root, target);
  const receipt = await readReceipt(paths.stageReceiptPath);
  if (!receipt) return null;
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION || receipt.kind !== 'stage' || receipt.target !== target) return null;

  const stage = stagePaths(root, target);
  const stageManifestStat = await fsp.lstat(stage.manifestPath).catch(() => null);
  if (!stageManifestStat?.isFile()) return null;

  const [identity, contractHash, stageManifestSha256] = await Promise.all([
    releaseIdentity(root),
    stageVerificationContractHash(root),
    sha256File(stage.manifestPath),
  ]);

  if (!matchesIdentity(receipt, identity)) return null;
  if (receipt.verificationContractSha256 !== contractHash) return null;
  if (receipt.stageManifestSha256 !== stageManifestSha256) return null;
  return receipt;
}

async function writeAppVerificationReceipt(root, target) {
  const paths = receiptPaths(root, target);
  const release = releasePaths(root, target);
  const stageReceipt = await readValidStageVerificationReceipt(root, target);
  if (!stageReceipt) {
    throw new Error('[Windows Verify] Cannot attest App without a valid verified Stage receipt.');
  }

  const identity = await releaseIdentity(root);
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: 'app',
    target,
    ...identity,
    verificationContractSha256: await appVerificationContractHash(root),
    stageReceiptSha256: await canonicalObjectSha256(stageReceipt),
    stageManifestSha256: stageReceipt.stageManifestSha256,
    appManifestSha256: await sha256File(release.appManifestPath),
    verifiedAt: new Date().toISOString(),
  };

  await writeReceipt(paths.appReceiptPath, receipt);
  return receipt;
}

async function readValidAppVerificationReceipt(root, target) {
  const paths = receiptPaths(root, target);
  const release = releasePaths(root, target);
  const receipt = await readReceipt(paths.appReceiptPath);
  if (!receipt) return null;
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION || receipt.kind !== 'app' || receipt.target !== target) return null;

  const appManifestStat = await fsp.lstat(release.appManifestPath).catch(() => null);
  if (!appManifestStat?.isFile()) return null;

  const stageReceipt = await readValidStageVerificationReceipt(root, target);
  if (!stageReceipt) return null;

  const [identity, contractHash, appManifestSha256, stageReceiptSha256] = await Promise.all([
    releaseIdentity(root),
    appVerificationContractHash(root),
    sha256File(release.appManifestPath),
    canonicalObjectSha256(stageReceipt),
  ]);

  if (!matchesIdentity(receipt, identity)) return null;
  if (receipt.verificationContractSha256 !== contractHash) return null;
  if (receipt.stageReceiptSha256 !== stageReceiptSha256) return null;
  if (receipt.stageManifestSha256 !== stageReceipt.stageManifestSha256) return null;
  if (receipt.appManifestSha256 !== appManifestSha256) return null;
  return receipt;
}

async function invalidateStageVerificationReceipts(root, target) {
  const paths = receiptPaths(root, target);
  await Promise.all([
    fsp.rm(paths.stageReceiptPath, { force: true }),
    fsp.rm(paths.appReceiptPath, { force: true }),
  ]);
}

async function invalidateAppVerificationReceipt(root, target) {
  const paths = receiptPaths(root, target);
  await fsp.rm(paths.appReceiptPath, { force: true });
}

async function releaseIdentity(root) {
  const rootPackagePath = path.join(root, 'package.json');
  const rootPackage = JSON.parse(await fsp.readFile(rootPackagePath, 'utf8'));
  const [rootPackageSha256, pnpmLockSha256, runtimeLockSha256, installerLockSha256] = await Promise.all([
    sha256File(rootPackagePath),
    sha256File(path.join(root, 'pnpm-lock.yaml')),
    sha256File(path.join(root, 'distribution', 'runtime-lock.json')),
    sha256File(path.join(root, 'distribution', 'installer-lock.json')),
  ]);

  return {
    product: 'SEEKMORE',
    version: String(rootPackage.version || ''),
    rootPackageSha256,
    pnpmLockSha256,
    runtimeLockSha256,
    installerLockSha256,
  };
}

function matchesIdentity(receipt, expected) {
  return Object.entries(expected).every(([key, value]) => receipt[key] === value);
}

async function stageVerificationContractHash(root) {
  return hashFiles([
    path.join(root, 'distribution', 'scripts', 'verify-stage.cjs'),
    path.join(root, 'distribution', 'scripts', 'windows', 'compact-backend.cjs'),
    path.join(root, 'distribution', 'test', 'stage-contract.spec.cjs'),
  ]);
}

async function appVerificationContractHash(root) {
  return hashFiles([
    path.join(root, 'distribution', 'scripts', 'windows', 'verify-app.cjs'),
    path.join(root, 'distribution', 'scripts', 'windows', 'platform-lib.cjs'),
    path.join(root, 'distribution', 'test', 'windows', 'installer-contract.spec.cjs'),
  ]);
}

async function hashFiles(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(toPortablePath(file));
    hash.update('\0');
    hash.update(await fsp.readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function canonicalObjectSha256(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

async function writeReceipt(filePath, payload) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function readReceipt(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function toPortablePath(value) {
  return value.split(path.sep).join('/');
}

module.exports = {
  RECEIPT_SCHEMA_VERSION,
  invalidateAppVerificationReceipt,
  invalidateStageVerificationReceipts,
  readValidAppVerificationReceipt,
  readValidStageVerificationReceipt,
  receiptPaths,
  writeAppVerificationReceipt,
  writeStageVerificationReceipt,
};
