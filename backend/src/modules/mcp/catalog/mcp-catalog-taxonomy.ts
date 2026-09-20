export const MCP_CATALOG_CATEGORIES = [
  'general',
  'design',
  'development',
  'collaboration',
  'cloud-data',
  'commerce-automation',
] as const;

export type McpCatalogCategory =
  (typeof MCP_CATALOG_CATEGORIES)[number];

export const MCP_CATALOG_AVAILABILITIES = [
  'ready',
  'oauth',
  'credential',
  'local_setup',
] as const;

export type McpCatalogAvailability =
  (typeof MCP_CATALOG_AVAILABILITIES)[number];

export function isMcpCatalogCategory(
  value: unknown,
): value is McpCatalogCategory {
  return MCP_CATALOG_CATEGORIES.includes(
    value as McpCatalogCategory,
  );
}

export function isMcpCatalogAvailability(
  value: unknown,
): value is McpCatalogAvailability {
  return MCP_CATALOG_AVAILABILITIES.includes(
    value as McpCatalogAvailability,
  );
}
