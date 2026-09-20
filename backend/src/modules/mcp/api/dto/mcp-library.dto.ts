export interface CreateMcpDefinitionDto {
  displayName: string;
  description?: string;
  transport: 'stdio' | 'streamable_http';
  endpoint?: string;
  command?: string;
  args?: string[];
  workingDirectory?: string;
  authKind?: 'none' | 'bearer' | 'api_key' | 'custom_headers' | 'environment' | 'oauth2';
  headers?: Record<string, string>;
  environment?: Record<string, string>;
  timeoutMs?: number;
}

export interface ImportMcpDefinitionDto {
  format: 'claude_desktop_json';
  config: unknown;
  commit?: boolean;
}
