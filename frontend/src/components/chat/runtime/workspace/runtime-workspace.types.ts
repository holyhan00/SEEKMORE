export type RuntimePermissionMode =
  | 'confirm_required'
  | 'audit_autorun'
  | 'full_access';

export type RuntimeWorkspaceStatus = 'active' | 'archived' | 'revoked';

export type RuntimeWorkspaceView = {
  id: string;
  workspaceId?: string;
  name?: string | null;
  displayName: string;
  rootPathMasked?: string | null;
  trustLevel?: string | null;
  writable: boolean;
  status?: RuntimeWorkspaceStatus;
  defaultPermissionMode?: RuntimePermissionMode;
};

export type RuntimeConversationSettingsView = {
  conversationId: string;
  workspaceId: string | null;
  workspace: RuntimeWorkspaceView | null;
  permissionMode: RuntimePermissionMode;
  version: number;
  updatedAt: string | null;
};

export type RuntimeConversationSettingsStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'saving'
  | 'error';

export type RuntimeConversationSettingsState = RuntimeConversationSettingsView & {
  status: RuntimeConversationSettingsStatus;
  error: string | null;
};

export function emptyRuntimeConversationSettings(
  conversationId: string,
): RuntimeConversationSettingsState {
  return {
    conversationId,
    workspaceId: null,
    workspace: null,
    permissionMode: 'confirm_required',
    version: 0,
    updatedAt: null,
    status: 'idle',
    error: null,
  };
}
