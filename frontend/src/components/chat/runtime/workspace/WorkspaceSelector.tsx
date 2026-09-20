                                                                       

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import {
  Check,
  ChevronRight,
  Folder,
  Plus,
  Search,
  X,
} from 'lucide-react';

import {
  listRuntimeWorkspaces,
  registerRuntimeWorkspace,
  removeRuntimeWorkspace,
  verifyRuntimeWorkspace,
} from './runtime-workspace.api';
import type {
  RuntimeWorkspaceView,
} from './runtime-workspace.types';
import WorkspaceCreateDialog from './WorkspaceCreateDialog';
import { useLocalize } from '../../../../localization/useLocalize';
import { localizeApiError } from '../../../../localization/localizeApiError';
import {
  useDesktopRuntime,
} from '../../../../runtime/desktop/useDesktopRuntime';

type Props = {

  value: RuntimeWorkspaceView | null;
  onChange?: (
    workspace: RuntimeWorkspaceView | null,
  ) => void;
};

type FloatingRect = {
  left: number;
  bottom: number;
};

type WorkspaceItemProps = {

  workspace: RuntimeWorkspaceView;
  selected: boolean;
  onClick: () => void;
  onRemove: () => void;
};

const itemClass =
  'bg-transparent hover:bg-surface-list-hover active:bg-[#e5e5e5] dark:bg-[#2a2a2a]  dark:active:bg-[#1f1f1f]';

function WorkspaceItem({
    workspace,
  selected,
  onClick,
  onRemove,
}: WorkspaceItemProps) {
  const localize = useLocalize();
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'group flex h-[29px] w-full items-center gap-[8px] rounded-[7px] px-[8px] text-left transition',
        itemClass,
      )}
      title={
        workspace.rootPathMasked
        ?? workspace.displayName
      }
    >
      <Folder
        className={clsx(
          'h-[11px] w-[11px] shrink-0',
          'text-[#666] dark:text-[#b8b8b8]',
        )}
        strokeWidth={2}
      />

      <div className="min-w-0 flex-1">
        <div
          className={clsx(
            'truncate text-[10px] font-medium leading-[14px]',
            'text-theme-primary-soft ',
          )}
        >
          {workspace.displayName}

          {workspace.writable === false ? (
            <span
              className={clsx(
                'ml-[3px] text-[8px]',
                'text-[#888] dark:text-[#9a9a9a]',
              )}
            >
              {localize('workspace.readOnly')}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex h-[13px] w-[13px] shrink-0 items-center justify-center">
        {selected ? (
          <Check
            className={clsx(
              'h-[13px] w-[13px] group-hover:hidden',
              'text-theme-caption ',
            )}
            strokeWidth={2.4}
          />
        ) : null}

        <span
          className="hidden h-[13px] w-[13px] items-center justify-center group-hover:flex"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <X
            className={clsx(
              'h-[11px] w-[11px]',
              'text-theme-caption ',
            )}
            strokeWidth={2}
          />
        </span>
      </div>
    </button>
  );
}

export default function WorkspaceSelector({
    value,
  onChange,
}: Props) {
  const localize = useLocalize();
  const desktopRuntime =
    useDesktopRuntime();

  const [open, setOpen] =
    useState(false);

  const [createOpen, setCreateOpen] =
    useState(false);

  const [newProjectOpen, setNewProjectOpen] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [workspaces, setWorkspaces] =
    useState<RuntimeWorkspaceView[]>([]);

  const [error, setError] =
    useState<string | null>(null);

  const [query, setQuery] =
    useState('');

  const [floatingRect, setFloatingRect] =
    useState<FloatingRect | null>(null);

  const rootRef =
    useRef<HTMLDivElement>(null);

  const menuRef =
    useRef<HTMLDivElement>(null);

  const submenuRef =
    useRef<HTMLDivElement>(null);

  const buttonText = useMemo(() => {
    if (!value) {
      return localize('workspace.none');
    }

    if (value.status === 'revoked') {
      return localize('workspace.unavailable');
    }

    return value.displayName;
  }, [localize, value]);

  const filteredWorkspaces = useMemo(() => {
    const keyword =
      query.trim().toLowerCase();

    if (!keyword) {
      return workspaces;
    }

    return workspaces.filter(
      (workspace) => {
        const name =
          workspace.displayName
            .toLowerCase();

        const path =
          workspace.rootPathMasked
            ?.toLowerCase()
          ?? '';

        return (
          name.includes(keyword)
          || path.includes(keyword)
        );
      },
    );
  }, [
    query,
    workspaces,
  ]);

  const updateFloatingRect = () => {
    const rect =
      rootRef.current
        ?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setFloatingRect({
      left: rect.left,
      bottom:
        window.innerHeight
        - rect.top
        + 6,
    });
  };

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const list =
        await listRuntimeWorkspaces();

      setWorkspaces(list);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : localize('workspace.loadFailed'),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
    };

    window.addEventListener(
      'runtime:workspace:open',
      onOpen,
    );

    return () => {
      window.removeEventListener(
        'runtime:workspace:open',
        onOpen,
      );
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setNewProjectOpen(false);
      return;
    }

    updateFloatingRect();

    const handler = (
      event: MouseEvent,
    ) => {
      const target =
        event.target as Node | null;

      if (
        target
        && rootRef.current
          ?.contains(target)
      ) {
        return;
      }

      if (
        target
        && menuRef.current
          ?.contains(target)
      ) {
        return;
      }

      if (
        target
        && submenuRef.current
          ?.contains(target)
      ) {
        return;
      }

      setOpen(false);
      setNewProjectOpen(false);
    };

    const update = () => {
      updateFloatingRect();
    };

    document.addEventListener(
      'mousedown',
      handler,
    );

    window.addEventListener(
      'resize',
      update,
    );

    window.addEventListener(
      'scroll',
      update,
      true,
    );

    return () => {
      document.removeEventListener(
        'mousedown',
        handler,
      );

      window.removeEventListener(
        'resize',
        update,
      );

      window.removeEventListener(
        'scroll',
        update,
        true,
      );
    };
  }, [open]);

  const select = async (
    workspace: RuntimeWorkspaceView,
  ) => {
    onChange?.(workspace);

    setOpen(false);
    setNewProjectOpen(false);

    try {
      const verified =
        await verifyRuntimeWorkspace(
          workspace.id,
        );

      if (verified.workspace) {
        onChange?.(verified.workspace);
      }
    } catch {
                                                             
    }
  };

  const clearWorkspace = () => {
    onChange?.(null);

    setOpen(false);
    setNewProjectOpen(false);
  };

  const removeWorkspace = async (
    workspace: RuntimeWorkspaceView,
  ) => {
    setError(null);

    try {
      await removeRuntimeWorkspace(
        workspace.id,
      );

      setWorkspaces(
        (previous) =>
          previous.filter(
            (item) =>
              item.id !== workspace.id,
          ),
      );

      if (value?.id === workspace.id) {
        onChange?.(null);
      }
    } catch (removeError) {
      setError(
        localizeApiError(
          removeError,
          'errors.operationFailed',
        ),
      );
    }
  };

  const openExistingFolder =
    async () => {
      if (
        desktopRuntime.phase === 'web'
      ) {
        setError(localize('workspace.desktopOnly'));
        return;
      }

      if (
        desktopRuntime.phase === 'unknown'
      ) {
        setError(localize('workspace.bridgeLoading'));
        return;
      }

      if (
        !desktopRuntime.bridgeReady
        || !desktopRuntime
          .capabilities.workspace
      ) {
        setError(localize('workspace.bridgeFailed'));
        return;
      }

      const picker =
        window.seekmoreDesktop
          ?.workspace
          ?.selectDirectory;

      if (!picker) {
        setError(localize('workspace.bridgeFailed'));
        return;
      }

      setLoading(true);
      setError(null);

      try {
        let selection;

        try {
          selection =
            await picker();
        } catch (selectionError) {
          console.error(
            '[Workspace] Directory picker failed',
            selectionError,
          );

          setError(localize('workspace.pickerFailed'));

          return;
        }

        if (
          selection.canceled
          || !selection.rootPath
        ) {
          return;
        }

        const workspace =
          await registerRuntimeWorkspace({
            rootPath:
              selection.rootPath,
            name:
              selection.name
              ?? undefined,
          });

        setWorkspaces(
          (previous) => [
            workspace,
            ...previous.filter(
              (item) =>
                item.id
                !== workspace.id,
            ),
          ],
        );

        onChange?.(workspace);

        setOpen(false);
        setNewProjectOpen(false);
      } catch (requestError) {
        const message = (() => {
          const response = (
            requestError as {
              response?: {
                data?: {
                  message?:
                    | string
                    | string[];
                };
              };
            }
          ).response
            ?.data
            ?.message;

          if (
            Array.isArray(response)
          ) {
            return response
              .map(String)
              .join('；');
          }

          if (
            typeof response
              === 'string'
            && response.trim()
          ) {
            return response.trim();
          }

          return (
            requestError
              instanceof Error
              ? requestError.message
              : localizeApiError(requestError, 'workspace.openFolderFailed')
          );
        })();

        setError(message);
      } finally {
        setLoading(false);
      }
    };

  const openCreateDialog = () => {
    setCreateOpen(true);

    setOpen(false);
    setNewProjectOpen(false);
  };

  const menu =
    open
    && floatingRect
    && typeof document !== 'undefined'
      ? createPortal(
          <>
            <div
              ref={menuRef}
              style={{
                left:
                  floatingRect.left,
                bottom:
                  floatingRect.bottom,
              }}
              className={clsx(
                'fixed z-[9999] w-[168px] select-none overflow-hidden rounded-[13px] border p-[7px] shadow-[7px_7px_21px_rgba(0,0,0,0.1)] [&_button]:!select-none [&_button_*]:!select-none',
                'border-edge-control bg-surface-menu text-theme-primary-soft   ',
              )}
            >
              <div
                className={clsx(
                  'mb-[6px] flex h-[24px] items-center gap-[6px] rounded-[8px] px-[8px] transition',
                  'bg-[#f1f1f1] focus-within:bg-[#eeeeee] dark:bg-[#242424] dark:focus-within:bg-[#1f1f1f]',
                )}
              >
                <Search
                  className={clsx(
                    'h-[9px] w-[9px] shrink-0',
                    'text-[#8a8a8a] dark:text-[#9a9a9a]',
                  )}
                  strokeWidth={2}
                />

                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(
                      event.target.value,
                    );
                  }}
                  placeholder={localize('workspace.searchPlaceholder')}
                  className={clsx(
                    'h-full min-w-0 flex-1 select-text border-0 bg-transparent text-[8.5px] font-medium outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0',
                    'text-[#555] placeholder:text-[#9a9a9a] dark:text-[#e8e8e8] dark:placeholder:text-[#777]',
                  )}
                  autoFocus
                />
              </div>

              {error ? (
                <div
                  className={clsx(
                    'mb-[6px] rounded-[7px] px-[8px] py-[6px] text-[8.5px] leading-[14px]',
                    'bg-[#fff2f2] text-[#c25b5b] dark:bg-[#3a2424] dark:text-[#ff9b9b]',
                  )}
                >
                  {error}
                </div>
              ) : null}

              <div className="max-h-[154px] overflow-y-auto pb-[6px]">
                {filteredWorkspaces.length
                  ? filteredWorkspaces.map(
                    (workspace) => (
                      <WorkspaceItem
                        key={workspace.id}

                        workspace={
                          workspace
                        }
                        selected={
                          value?.id
                          === workspace.id
                        }
                        onClick={() => {
                          void select(
                            workspace,
                          );
                        }}
                        onRemove={() => {
                          void removeWorkspace(
                            workspace,
                          );
                        }}
                      />
                    ),
                  )
                  : (
                    <div
                      className={clsx(
                        'px-[8px] py-[14px] text-[9px]',
                        'text-[#888] dark:text-[#9a9a9a]',
                      )}
                    >
                      {loading
                        ? localize('common.loading')
                        : localize('workspace.empty')}
                    </div>
                  )}
              </div>

              <div>
                <button
                  type="button"
                  onMouseEnter={() => {
                    setNewProjectOpen(
                      true,
                    );
                  }}
                  onClick={() => {
                    setNewProjectOpen(
                      (next) => !next,
                    );
                  }}
                  className={clsx(
                    'flex h-[29px] w-full items-center gap-[8px] rounded-[7px] px-[8px] text-left transition',
                    itemClass,
                  )}
                >
                  <Plus
                    className={clsx(
                      'h-[13px] w-[13px] shrink-0',
                      'text-theme-caption ',
                    )}
                    strokeWidth={2}
                  />

                  <span
                    className={clsx(
                      'min-w-0 flex-1 text-[10px] font-medium',
                      'text-theme-primary-soft ',
                    )}
                  >
                    {localize('workspace.newProject')}
                  </span>

                  <ChevronRight
                    className={clsx(
                      'h-[13px] w-[13px] shrink-0',
                      'text-[#999] dark:text-[#9a9a9a]',
                    )}
                    strokeWidth={2}
                  />
                </button>

                <button
                  type="button"
                  onClick={
                    clearWorkspace
                  }
                  className={clsx(
                    'flex h-[29px] w-full items-center gap-[8px] rounded-[7px] px-[8px] text-left transition',
                    itemClass,
                  )}
                >
                  <X
                    className={clsx(
                      'h-[13px] w-[13px] shrink-0',
                      'text-theme-caption ',
                    )}
                    strokeWidth={2}
                  />

                  <span
                    className={clsx(
                      'text-[10px] font-medium',
                      'text-theme-primary-soft ',
                    )}
                  >
                    {localize('workspace.none')}
                  </span>
                </button>
              </div>
            </div>

            {newProjectOpen ? (
              <div
                ref={submenuRef}
                style={{
                  left:
                    floatingRect.left
                    + 190,
                  bottom:
                    floatingRect.bottom,
                }}
                className={clsx(
                  'fixed z-[10000] w-[154px] select-none overflow-hidden rounded-[13px] border p-[7px] shadow-[7px_7px_21px_rgba(0,0,0,0.1)] [&_button]:!select-none [&_button_*]:!select-none',
                  'border-edge-control bg-surface-menu  ',
                )}
                onMouseEnter={() => {
                  setNewProjectOpen(
                    true,
                  );
                }}
                onMouseLeave={() => {
                  setNewProjectOpen(
                    false,
                  );
                }}
              >
                <button
                  type="button"
                  onClick={
                    openCreateDialog
                  }
                  className={clsx(
                    'flex h-[31px] w-full items-center gap-[8px] rounded-[7px] px-[8px] text-left transition',
                    itemClass,
                  )}
                >
                  <Plus
                    className={clsx(
                      'h-[13px] w-[13px] shrink-0',
                      'text-theme-caption ',
                    )}
                    strokeWidth={2}
                  />

                  <span
                    className={clsx(
                      'text-[10px] font-semibold',
                      'text-theme-primary-soft ',
                    )}
                  >
                    {localize('workspace.createBlank')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void openExistingFolder();
                  }}
                  disabled={loading}
                  className={clsx(
                    'flex h-[31px] w-full items-center gap-[8px] rounded-[7px] px-[8px] text-left transition',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    itemClass,
                  )}
                >
                  <Folder
                    className={clsx(
                      'h-[13px] w-[13px] shrink-0',
                      'text-theme-caption ',
                    )}
                    strokeWidth={2}
                  />

                  <span
                    className={clsx(
                      'text-[10px] font-semibold',
                      'text-theme-primary-soft ',
                    )}
                  >
                    {localize('workspace.useExistingFolder')}
                  </span>
                </button>
              </div>
            ) : null}
          </>,
          document.body,
        )
      : null;

  return (
    <div
      ref={rootRef}
      className="relative"
    >
      <button
        type="button"
        onClick={() => {
          setOpen(
            (next) => !next,
          );
        }}
        className={clsx(
          'inline-flex h-[21px] min-w-[44px] select-none items-center justify-center whitespace-nowrap rounded-full px-[8px] text-[9px] transition',
          'bg-surface-hover text-neutral-800 hover:bg-[#dddddd]  dark:text-[#f2f2f2] dark:hover:bg-[#1f1f1f]',
        )}
        title={
          value?.rootPathMasked
          ?? buttonText
        }
      >
        <span>
          {buttonText}
        </span>
      </button>

      {menu}

      <WorkspaceCreateDialog

        open={createOpen}
        anchorRect={floatingRect}
        onClose={() => {
          setCreateOpen(false);
        }}
        onCreated={(workspace) => {
          setWorkspaces(
            (previous) => [
              workspace,
              ...previous.filter(
                (item) =>
                  item.id
                  !== workspace.id,
              ),
            ],
          );

          onChange?.(workspace);

          setOpen(false);
          setNewProjectOpen(false);
        }}
      />
    </div>
  );
}