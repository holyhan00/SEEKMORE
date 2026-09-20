                                                       
import React from "react";
import WorkspaceSelector from "./runtime/workspace/WorkspaceSelector";
import PermissionModeSelector from "./runtime/workspace/PermissionModeSelector";
import type {
  RuntimePermissionMode,
  RuntimeWorkspaceView,
} from "./runtime/workspace/runtime-workspace.types";

type RuntimeControlPanelProps = {

  selectedWorkspace: RuntimeWorkspaceView | null;
  onSelectedWorkspaceChange: (workspace: RuntimeWorkspaceView | null) => void;
  selectedPermissionMode: RuntimePermissionMode;
  onSelectedPermissionModeChange: (mode: RuntimePermissionMode) => void;
};

const RuntimeControlPanel: React.FC<RuntimeControlPanelProps> = ({
    selectedWorkspace,
  onSelectedWorkspaceChange,
  selectedPermissionMode,
  onSelectedPermissionModeChange,
}) => {
  return (
    <div
      className={[
        "relative mt-[2px] flex h-[60px] w-full select-none items-start overflow-visible [&_button]:!select-none [&_button_*]:!select-none",
        "rounded-b-[20px] rounded-t-none px-4",
        "transition-colors",
        "border-[#ccc] bg-surface-hover dark:border-[#333] ",
      ].join(" ")}
    >
      <div className="absolute bottom-[8px] left-[8px] flex flex-row flex-nowrap items-center gap-[10px] whitespace-nowrap">
        <div className="shrink-0">
          <WorkspaceSelector

            value={selectedWorkspace}
            onChange={onSelectedWorkspaceChange}
          />
        </div>

        <div className="shrink-0">
          <PermissionModeSelector

            value={selectedPermissionMode}
            onChange={onSelectedPermissionModeChange}
          />
        </div>
      </div>
    </div>
  );
};

export default RuntimeControlPanel;
