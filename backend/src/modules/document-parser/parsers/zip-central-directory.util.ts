export interface ZipCentralDirectoryEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  encrypted: boolean;
  directory: boolean;
  unsafePath: boolean;
}

export interface ZipCentralDirectoryManifest {
  entries: ZipCentralDirectoryEntry[];
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
  centralDirectoryBytes: number;
}

export interface ZipInspectionLimits {
  maxEntries: number;
  maxCentralDirectoryBytes: number;
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
  rejectEncrypted?: boolean;
  rejectUnsafePaths?: boolean;
}

export class ZipContainerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ZipContainerError';
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const MAX_EOCD_SEARCH_BYTES = 0xffff + 22;

export function inspectZipCentralDirectory(
  buffer: Buffer,
  limits: ZipInspectionLimits,
): ZipCentralDirectoryManifest {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new ZipContainerError('ZIP_INVALID', 'ZIP central directory was not found');
  }

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryBytes = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new ZipContainerError('ZIP_MULTI_DISK_UNSUPPORTED', 'Multi-disk ZIP archives are not supported');
  }

  if (
    totalEntries === ZIP64_SENTINEL_16
    || centralDirectoryBytes === ZIP64_SENTINEL_32
    || centralDirectoryOffset === ZIP64_SENTINEL_32
  ) {
    throw new ZipContainerError('ZIP64_UNSUPPORTED', 'ZIP64 archives are not supported by this parser');
  }

  if (totalEntries > limits.maxEntries) {
    throw new ZipContainerError('ZIP_ENTRY_LIMIT_EXCEEDED', 'ZIP contains too many entries', {
      totalEntries,
      maxEntries: limits.maxEntries,
    });
  }

  if (centralDirectoryBytes > limits.maxCentralDirectoryBytes) {
    throw new ZipContainerError('ZIP_DIRECTORY_LIMIT_EXCEEDED', 'ZIP central directory is too large', {
      centralDirectoryBytes,
      maxCentralDirectoryBytes: limits.maxCentralDirectoryBytes,
    });
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectoryBytes;
  if (
    centralDirectoryOffset < 0
    || centralDirectoryEnd > buffer.length
    || centralDirectoryEnd > eocdOffset
  ) {
    throw new ZipContainerError('ZIP_INVALID', 'ZIP central directory points outside the archive');
  }

  const entries: ZipCentralDirectoryEntry[] = [];
  let cursor = centralDirectoryOffset;
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;

  while (entries.length < totalEntries) {
    if (cursor + 46 > centralDirectoryEnd) {
      throw new ZipContainerError('ZIP_INVALID', 'ZIP central directory entry is truncated');
    }

    if (buffer.readUInt32LE(cursor) !== CENTRAL_FILE_SIGNATURE) {
      throw new ZipContainerError('ZIP_INVALID', 'ZIP central directory contains an invalid entry signature');
    }

    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const next = cursor + 46 + nameLength + extraLength + commentLength;

    if (next > centralDirectoryEnd) {
      throw new ZipContainerError('ZIP_INVALID', 'ZIP central directory entry exceeds declared bounds');
    }

    if (compressedSize === ZIP64_SENTINEL_32 || uncompressedSize === ZIP64_SENTINEL_32) {
      throw new ZipContainerError('ZIP64_UNSUPPORTED', 'ZIP64 entries are not supported by this parser');
    }

    const nameBuffer = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeEntryName(nameBuffer, (flags & 0x0800) !== 0).replace(/\\/g, '/');
    const encrypted = (flags & 0x0001) !== 0;
    const directory = name.endsWith('/') || ((externalAttributes >>> 16) & 0xf000) === 0x4000;
    const unsafePath = isUnsafeArchivePath(name);

    if (encrypted && limits.rejectEncrypted) {
      throw new ZipContainerError('ZIP_ENCRYPTED_UNSUPPORTED', 'Encrypted ZIP entries are not supported', { name });
    }

    if (unsafePath && limits.rejectUnsafePaths) {
      throw new ZipContainerError('ZIP_UNSAFE_PATH', 'ZIP contains an unsafe entry path', { name });
    }

    if (uncompressedSize > limits.maxEntryUncompressedBytes) {
      throw new ZipContainerError('ZIP_ENTRY_SIZE_LIMIT_EXCEEDED', 'A ZIP entry exceeds the uncompressed size limit', {
        name,
        uncompressedSize,
        maxEntryUncompressedBytes: limits.maxEntryUncompressedBytes,
      });
    }

    const ratio = compressedSize === 0
      ? (uncompressedSize === 0 ? 1 : Number.POSITIVE_INFINITY)
      : uncompressedSize / compressedSize;
    if (ratio > limits.maxCompressionRatio) {
      throw new ZipContainerError('ZIP_COMPRESSION_RATIO_LIMIT_EXCEEDED', 'A ZIP entry has a suspicious compression ratio', {
        name,
        compressedSize,
        uncompressedSize,
        ratio,
        maxCompressionRatio: limits.maxCompressionRatio,
      });
    }

    totalCompressedBytes += compressedSize;
    totalUncompressedBytes += uncompressedSize;

    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw new ZipContainerError('ZIP_TOTAL_SIZE_LIMIT_EXCEEDED', 'ZIP exceeds the total uncompressed size limit', {
        totalUncompressedBytes,
        maxTotalUncompressedBytes: limits.maxTotalUncompressedBytes,
      });
    }

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      method,
      encrypted,
      directory,
      unsafePath,
    });
    cursor = next;
  }

  return {
    entries,
    totalCompressedBytes,
    totalUncompressedBytes,
    centralDirectoryBytes,
  };
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const lowerBound = Math.max(0, buffer.length - MAX_EOCD_SEARCH_BYTES);
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function decodeEntryName(buffer: Buffer, utf8: boolean): string {
  if (utf8) return buffer.toString('utf8');
                                                                                    
  return buffer.toString('utf8');
}

function isUnsafeArchivePath(name: string): boolean {
  if (!name || name.startsWith('/') || /^[a-zA-Z]:\//.test(name)) return true;
  return name.split('/').some((segment) => segment === '..');
}
