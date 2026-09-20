export interface ArchiveManifestEntry {
  path: string;
  normalizedPath: string;
  extension: string;
  mimeType?: string | null;
  sizeBytes: number;
  objectKind: string;
  hash?: string | null;
  safe: boolean;
  ignored: boolean;
  ignoreReason?: string | null;
}

export interface ArchiveSafetySummary {
  hasPathTraversal: boolean;
  hasExecutable: boolean;
  hasOversizedObject: boolean;
  hasTooManyObjects: boolean;
  warnings: string[];
}

export interface ArchiveManifest {
  archiveObjectId: string;
  extractedRoot: string | null;
  totalEntries: number;
  totalObjects: number;
  totalDirectories: number;
  totalBytes: number;
  entries: ArchiveManifestEntry[];
  safety: ArchiveSafetySummary;
  detectedBundleKind: string;
  bundleConfidence: number;
  metadata: Record<string, unknown>;
}
