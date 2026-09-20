import type { SkillRuntimePolicy } from "./skill.types";

const positiveInt = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
};

export function defaultSkillRuntimePolicy(): SkillRuntimePolicy {
  return {
    maxCatalogEntries: positiveInt(
      process.env.SKILL_MAX_CATALOG_ENTRIES,
      40,
      1,
      200,
    ),
    catalogCharBudget: positiveInt(
      process.env.SKILL_CATALOG_CHAR_BUDGET,
      8000,
      1000,
      50000,
    ),
    instructionTokenBudget: positiveInt(
      process.env.SKILL_INSTRUCTION_TOKEN_BUDGET,
      6000,
      500,
      50000,
    ),
    resourceTokenBudget: positiveInt(
      process.env.SKILL_RESOURCE_TOKEN_BUDGET,
      12000,
      500,
      100000,
    ),
    maxAutomaticSkills: positiveInt(process.env.SKILL_MAX_AUTOMATIC, 2, 1, 10),
    maxResourceFiles: positiveInt(
      process.env.SKILL_MAX_RESOURCE_FILES,
      5,
      1,
      50,
    ),
    publicDiscoveryEnabled: true,
    publicCatalogLimit: 12,
  };
}

export const SKILL_PACKAGE_LIMITS = Object.freeze({
  maxFiles: positiveInt(process.env.SKILL_MAX_FILES, 100, 1, 1000),
  maxArchiveUploadBytes: positiveInt(
    process.env.SKILL_MAX_ARCHIVE_UPLOAD_BYTES,
    50 * 1024 * 1024,
    1024 * 1024,
    200 * 1024 * 1024,
  ),
  maxArchiveEntries: positiveInt(
    process.env.SKILL_MAX_ARCHIVE_ENTRIES,
    5000,
    100,
    20000,
  ),
  maxArchiveUncompressedBytes: positiveInt(
    process.env.SKILL_MAX_ARCHIVE_UNCOMPRESSED_BYTES,
    100 * 1024 * 1024,
    1024 * 1024,
    500 * 1024 * 1024,
  ),
  maxArchiveEntryBytes: positiveInt(
    process.env.SKILL_MAX_ARCHIVE_ENTRY_BYTES,
    25 * 1024 * 1024,
    1024,
    100 * 1024 * 1024,
  ),
  maxPackageBytes: positiveInt(
    process.env.SKILL_MAX_PACKAGE_BYTES,
    20 * 1024 * 1024,
    1024,
    200 * 1024 * 1024,
  ),
  maxSkillMarkdownBytes: positiveInt(
    process.env.SKILL_MAX_MARKDOWN_BYTES,
    512 * 1024,
    1024,
    5 * 1024 * 1024,
  ),
  maxReferenceBytes: positiveInt(
    process.env.SKILL_MAX_REFERENCE_BYTES,
    2 * 1024 * 1024,
    1024,
    20 * 1024 * 1024,
  ),
  maxScriptBytes: positiveInt(
    process.env.SKILL_MAX_SCRIPT_BYTES,
    1024 * 1024,
    1024,
    10 * 1024 * 1024,
  ),
  maxAssetBytes: positiveInt(
    process.env.SKILL_MAX_ASSET_BYTES,
    10 * 1024 * 1024,
    1024,
    100 * 1024 * 1024,
  ),
  maxDepth: positiveInt(process.env.SKILL_MAX_PATH_DEPTH, 8, 1, 32),
});
