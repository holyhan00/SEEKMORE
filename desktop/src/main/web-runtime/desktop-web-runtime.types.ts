export type DesktopWebSessionMode = 'BACKGROUND_SEARCH' | 'INTERACTIVE_BROWSER';

export type DesktopWebRuntimeOperation =
  | 'health'
  | 'fetch_public_page'
  | 'create_session'
  | 'navigate'
  | 'snapshot'
  | 'act'
  | 'get_content'
  | 'capture'
  | 'close_session'
  | 'mcp_health'
  | 'mcp_store_secret'
  | 'mcp_delete_secret'
  | 'mcp_connect'
  | 'mcp_disconnect'
  | 'mcp_discover'
  | 'mcp_list_tools'
  | 'mcp_consume_tool_changes'
  | 'mcp_call_tool'
  | 'mcp_cancel_tool'
  | 'mcp_status';

export type DesktopWebRuntimeRequest = {
  operation: DesktopWebRuntimeOperation;
  payload?: Record<string, unknown>;
};

export type DesktopWebRuntimeResponse = {
  ok: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    detail?: unknown;
  };
};

export type DesktopWebRuntimeDescriptor = {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
  updatedAt: string;
};

export type DesktopWebSessionRecord = {
  sessionId: string;
  mode: DesktopWebSessionMode;
  profileId: string | null;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
};
