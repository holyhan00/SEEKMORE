import { resolveAssetUrl } from '../../../utils/asset-url';
                                                   
import { useAppearance } from '../../../theme/useAppearance';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import McpCard from './McpCard';
import McpDefinitionDialog from './McpDefinitionDialog';
import McpImportDialog from './McpImportDialog';
import McpCredentialDialog from './McpCredentialDialog';
import McpDetailPanel from './McpDetailPanel';
import { resolveMcpRequestError } from '../../../lib/mcp-request-error';
import { useLocalize } from '../../../localization/useLocalize';
import {
  commitMcpImport,
  configureMcpCredential,
  connectMcpInstallation,
  createMcpDefinition,
  deleteMcpDefinition,
  getMcpDefinition,
  installMcpDefinition,
  initiateMcpOAuth,
  getMcpOAuthStatus,
  listMcpDefinitions,
  listMcpInstallations,
  listMcpTools,
  previewMcpImport,
  reconnectMcpInstallation,
  revokeMcpOAuth,
  refreshMcpTools,
  setMcpInstallationEnabled,
  uninstallMcpInstallation,
  updateMcpDefinition,
} from './mcp.api';
import type {
  McpDefinitionDetail,
  McpDefinitionDraft,
  McpInstallationItem,
  McpManagementRequest,
  McpToolItem,
} from './mcp.types';

async function openExternalUrl(
  url: string,
): Promise<void> {
  try {
    const result =
      await window.seekmoreDesktop?.web
        ?.openExternal?.(url);

    if (result?.opened) return;
  } catch {
                                      
  }

  window.open(
    url,
    '_blank',
    'noopener,noreferrer',
  );
}

function delay(
  ms: number,
): Promise<void> {
  return new Promise((resolve) =>
    window.setTimeout(resolve, ms),
  );
}

export default function McpPanel({
  managementRequest = null,
}: {
  managementRequest?:
    | McpManagementRequest
    | null;
}) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();

  const [
    definitions,
    setDefinitions,
  ] = useState<
    McpDefinitionDetail[]
  >([]);

  const [
    installations,
    setInstallations,
  ] = useState<
    McpInstallationItem[]
  >([]);

  const [
    selectedInstallationId,
    setSelectedInstallationId,
  ] = useState<string | null>(
    null,
  );

  const [
    tools,
    setTools,
  ] = useState<McpToolItem[]>(
    [],
  );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    busyKey,
    setBusyKey,
  ] = useState<string | null>(
    null,
  );

  const [
    error,
    setError,
  ] = useState<string | null>(
    null,
  );

  const [
    dialogOpen,
    setDialogOpen,
  ] = useState(false);

  const [
    editing,
    setEditing,
  ] = useState<
    McpDefinitionDetail | null
  >(null);

  const [
    importOpen,
    setImportOpen,
  ] = useState(false);

  const [
    importPreview,
    setImportPreview,
  ] = useState<
    Array<Record<string, unknown>>
  >([]);

  const [
    credentialInstallation,
    setCredentialInstallation,
  ] = useState<
    McpInstallationItem | null
  >(null);

  const handledManagementRequestId =
    useRef<number | null>(null);

  const [
    authorizingInstallationId,
    setAuthorizingInstallationId,
  ] = useState<string | null>(
    null,
  );

  const selectedInstallation =
    useMemo(
      () =>
        installations.find(
          (item) =>
            item.id ===
            selectedInstallationId,
        ) ?? null,
      [
        installations,
        selectedInstallationId,
      ],
    );

  const applyInstallations =
    useCallback(
      (
        nextInstallations:
          McpInstallationItem[],
      ) => {
        setInstallations(
          nextInstallations,
        );

        setSelectedInstallationId(
          (current) =>
            current &&
            nextInstallations.some(
              (item) =>
                item.id === current,
            )
              ? current
              : nextInstallations[0]
                  ?.id ?? null,
        );
      },
      [],
    );

  const refreshInstallations =
    useCallback(async () => {
      const nextInstallations =
        await listMcpInstallations();

      applyInstallations(
        nextInstallations,
      );

      return nextInstallations;
    }, [applyInstallations]);

  const load = useCallback(
    async () => {
      setLoading(true);
      setError(null);

      try {
        const [
          nextDefinitions,
          nextInstallations,
        ] = await Promise.all([
          listMcpDefinitions(),
          listMcpInstallations(),
        ]);

        setDefinitions(
          nextDefinitions,
        );

        applyInstallations(
          nextInstallations,
        );
      } catch (cause) {
        setError(
          resolveMcpRequestError(
            cause,
            'errors.mcp.loadFailed',
          ),
        );
      } finally {
        setLoading(false);
      }
    },
    [applyInstallations],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const openCredentialConfiguration =
    useCallback(
      (
        item:
          McpInstallationItem,
      ) => {
        setSelectedInstallationId(
          item.id,
        );

        setCredentialInstallation(
          item,
        );
      },
      [],
    );

  useEffect(() => {
    if (
      !managementRequest ||
      loading ||
      handledManagementRequestId
        .current ===
        managementRequest.requestId
    ) {
      return;
    }

    const installation =
      installations.find(
        (item) =>
          item.id ===
          managementRequest.installationId,
      );

    if (!installation) return;

    handledManagementRequestId.current =
      managementRequest.requestId;

    setSelectedInstallationId(
      installation.id,
    );

    if (
      installation.authKind !==
        'none' &&
      installation.authKind !==
        'oauth2'
    ) {
      openCredentialConfiguration(
        installation,
      );
    }
  }, [
    installations,
    loading,
    managementRequest,
    openCredentialConfiguration,
  ]);

  const connectingIds =
    useMemo(
      () =>
        installations
          .filter(
            (item) =>
              item.connectionStatus ===
              'connecting',
          )
          .map((item) => item.id)
          .sort()
          .join(','),
      [installations],
    );

  useEffect(() => {
    if (!connectingIds) {
      return undefined;
    }

    const timer =
      window.setInterval(() => {
        void refreshInstallations()
          .then(
            (
              nextInstallations,
            ) => {
              const failed =
                nextInstallations.find(
                  (item) =>
                    connectingIds
                      .split(',')
                      .includes(
                        item.id,
                      ) &&
                    item.connectionStatus ===
                      'failed',
                );

              if (failed) {
                setError(
                  failed.connectionFailureMessage ||
                    failed.connectionFailureCode ||
                    localize(
                      'mcp.connectionFailed',
                      {
                        name:
                          failed.displayName,
                      },
                    ),
                );
              }
            },
          )
          .catch((cause) => {
            setError(
              resolveMcpRequestError(
                cause,
                'errors.mcp.refreshFailed',
              ),
            );
          });
      }, 1_000);

    return () =>
      window.clearInterval(timer);
  }, [
    connectingIds,
    refreshInstallations,
  ]);

  useEffect(() => {
    if (
      !selectedInstallationId ||
      selectedInstallation
        ?.connectionStatus !==
        'connected'
    ) {
      setTools([]);
      return;
    }

    void listMcpTools(
      selectedInstallationId,
    )
      .then(setTools)
      .catch(() => setTools([]));
  }, [
    selectedInstallation
      ?.connectionStatus,
    selectedInstallationId,
  ]);

  const run = async (
    key: string,
    task: () => Promise<unknown>,
  ) => {
    setBusyKey(key);
    setError(null);

    try {
      await task();
      await load();

      window.dispatchEvent(
        new CustomEvent(
          'mcp:state-changed',
        ),
      );

      if (selectedInstallationId) {
        setTools(
          await listMcpTools(
            selectedInstallationId,
          ).catch(() => []),
        );
      }
    } catch (cause) {
      setError(
        resolveMcpRequestError(
          cause,
          'errors.operationFailed',
        ),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const startConnection =
    async (
      item:
        McpInstallationItem,
    ) => {
      setBusyKey(
        `connect:${item.id}`,
      );

      setError(null);

      try {
        if (
          item.connectionStatus ===
          'failed'
        ) {
          await reconnectMcpInstallation(
            item.id,
          );
        } else {
          await connectMcpInstallation(
            item.id,
          );
        }

        setInstallations(
          (current) =>
            current.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    connectionStatus:
                      'connecting',
                    actionState:
                      'CONNECTING',
                  }
                : entry,
            ),
        );

        await refreshInstallations();
      } catch (cause) {
        setError(
          resolveMcpRequestError(
            cause,
            'errors.mcp.connectStartFailed',
          ),
        );
      } finally {
        setBusyKey(null);
      }
    };

  const authorizeInstallation =
    async (
      item:
        McpInstallationItem,
    ) => {
      setAuthorizingInstallationId(
        item.id,
      );

      setError(null);

      try {
        const started =
          await initiateMcpOAuth(
            item.id,
          );

        await openExternalUrl(
          started.authorizationUrl,
        );

        for (
          let attempt = 0;
          attempt < 300;
          attempt += 1
        ) {
          await delay(1_000);

          const status =
            await getMcpOAuthStatus(
              item.id,
            );

          if (
            status.status ===
            'authorized'
          ) {
            await refreshInstallations();
            return;
          }

          if (
            status.status ===
            'revoked'
          ) {
            throw new Error(
              'MCP_OAUTH_REVOKED',
            );
          }
        }

        throw new Error(
          'MCP_OAUTH_PENDING',
        );
      } catch (cause) {
        setError(
          resolveMcpRequestError(
            cause,
            'errors.mcp.oauthFailed',
          ),
        );
      } finally {
        setAuthorizingInstallationId(
          null,
        );
      }
    };

  const revokeAuthorization =
    async (
      item:
        McpInstallationItem,
    ) => {
      await run(
        `oauth-revoke:${item.id}`,
        async () => {
          await revokeMcpOAuth(
            item.id,
          );
        },
      );
    };

  const openEdit = async (
    definition:
      McpDefinitionDetail,
  ) => {
    const detail =
      await getMcpDefinition(
        definition.id,
      );

    setEditing(detail);
    setDialogOpen(true);
  };

  const saveDefinition = (
    draft:
      McpDefinitionDraft,
  ) =>
    run(
      'save-definition',
      async () => {
        if (editing) {
          await updateMcpDefinition(
            editing.id,
            draft,
          );
        } else {
          await createMcpDefinition(
            draft,
          );
        }

        setDialogOpen(false);
        setEditing(null);
      },
    );

                                             
  const handleImport =
    useCallback(
      async (
        text: string,
      ) => {
        await run(
          'import-mcp',
          async () => {
            const parsed =
              JSON.parse(text);

            const preview =
              await previewMcpImport(
                parsed,
              );

            setImportPreview(
              preview,
            );

            await commitMcpImport(
              parsed,
            );

            setImportOpen(false);
            setImportPreview([]);
          },
        );
      },
      [],
    );

  const subtleButton = `
    box-border
    inline-flex
    h-[30px]
    select-none
    items-center
    justify-center
    rounded-[10px]
    border-0
    px-[10px]
    text-[9px]
    font-medium
    outline-none
    transition-all
    ${
      'bg-surface-card text-theme-subtle hover:bg-surface-card-hover hover:text-[#000000]/70    dark:hover:text-[#ffffff]/70'
    }
  `;

  const headerButtonClass = `
    relative
    bottom-[16px]
    z-10
    flex
    h-10
    shrink-0
    select-none
    items-center
    justify-center
    rounded-[11px]
    bg-action-primary
    px-5
    py-0
    text-[12px]
    font-medium
    text-[#ffffff]
    shadow-[0_10px_24px_rgba(12,92,251,0.2)]
    transition
    hover:bg-action-primary-hover
    hover:!text-[#ffffff]
    active:translate-y-px
  `;

  const userDefinitions =
    definitions.filter(
      (item) =>
        item.source === 'USER',
    );

  return (
    <div
      className={`
        flex
        h-full
        min-h-0
        flex-col
        overflow-hidden
        pb-[8px]
        [&_button]:!select-none
        [&_button_*]:!select-none
        ${
          'bg-surface-page text-theme-title  '
        }
      `}
    >
      <div
        className="
          mx-auto
          flex
          h-full
          min-h-0
          w-[95%]
          flex-col
        "
      >
        <header
          className="
            relative
            flex
            min-h-[132px]
            flex-none
            items-end
            justify-between
            overflow-hidden
            rounded-[18px]
            bg-cover
            bg-center
            bg-no-repeat
            px-[22px]
          "
          style={{
            backgroundImage: `url("${
              isDarkTheme
                ? resolveAssetUrl('/backgrounds/agent-card-dark.jpg')
                : resolveAssetUrl('/backgrounds/agent-card-light.jpg')
            }")`,
          }}
          onCopy={(event) =>
            event.preventDefault()
          }
        >
          <div
            className={`
              pointer-events-none
              absolute
              inset-0
              ${
                'bg-surface-inverse-soft '
              }
            `}
          />

          <div
            className="
              relative
              bottom-[16px]
              z-10
              flex
              min-w-0
              max-w-[560px]
              select-none
              flex-col
              gap-0
            "
          >
            <h1
              className={`
                m-0
                select-none
                text-[27px]
                font-semibold
                leading-[50px]
                tracking-[-0.035em]
                ${
                  'text-theme-title '
                }
              `}
            >
              MCP
            </h1>

            <p
              className={`
                m-0
                select-none
                text-[12px]
                leading-[10px]
                ${
                  'text-theme-subtle '
                }
              `}
            >
              {localize(
                'mcp.panel.description',
              )}
            </p>
          </div>

          <div
            className="
              relative
              z-10
              flex
              shrink-0
              items-center
              gap-[8px]
            "
          >
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              className={
                headerButtonClass
              }
            >
              {localize(
                'mcp.panel.create',
              )}
            </button>

            <button
              type="button"
              onClick={() =>
                setImportOpen(true)
              }
              className={
                headerButtonClass
              }
            >
              {localize(
                'mcp.panel.import',
              )}
            </button>
          </div>
        </header>

        {error && (
          <div
            className="
              mt-[10px]
              rounded-[10px]
              bg-red-500/10
              px-[12px]
              py-[9px]
              text-[10px]
              text-red-500
            "
          >
            {error}
          </div>
        )}

        <div
          className={`
            mt-[12px]
            select-none
            text-[10px]
            ${
              'text-theme-dim '
            }
          `}
        >
          {localize(
            'mcp.panel.installedCount',
            {
              count:
                installations.length,
            },
          )}
        </div>

        <div
          className="
            mt-[4px]
            grid
            min-h-0
            min-w-[680px]
            flex-1
            grid-cols-[minmax(0,1fr)_minmax(320px,0.68fr)]
            items-stretch
            gap-[16px]
            overflow-hidden
          "
        >
          <section
            className="
              min-h-0
              min-w-0
              overflow-y-auto
              px-[10px]
              pt-[10px]
              [&::-webkit-scrollbar]:hidden
              [scrollbar-width:none]
            "
          >
            {loading ? (
              <div
                className={`
                  flex
                  h-[30px]
                  items-center
                  justify-center
                  rounded-[10px]
                  py-20
                  text-[12px]
                  ${
                    'border-[#000000]/[0.09] text-theme-faint dark:border-[#ffffff]/[0.08] '
                  }
                `}
              >
                {localize(
                  'mcp.panel.loading',
                )}
              </div>
            ) : installations.length ===
              0 ? (
              <div
                className={`
                  flex
                  h-[30px]
                  items-center
                  justify-center
                  rounded-[10px]
                  py-20
                  text-[12px]
                  ${
                    'border-edge-alpha-07 text-theme-faint  '
                  }
                `}
              >
                {localize(
                  'mcp.panel.emptyInstalled',
                )}
              </div>
            ) : (
              <div
                className="
                  grid
                  w-full
                  min-w-0
                  items-start
                  gap-[16px]
                "
                style={{
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(220px, 1fr))',
                }}
              >
                {installations.map(
                  (item) => (
                    <McpCard
                      key={
                        item.id
                      }
                      item={
                        item
                      }
                      selected={
                        selectedInstallationId ===
                        item.id
                      }
                      busyKey={
                        busyKey
                      }
                      authorizing={
                        authorizingInstallationId ===
                        item.id
                      }
                      onClick={() =>
                        setSelectedInstallationId(
                          item.id,
                        )
                      }
                      onEnable={() => {
                        void run(
                          `enable:${item.id}`,
                          () =>
                            setMcpInstallationEnabled(
                              item.id,
                              true,
                            ),
                        );
                      }}
                      onAuthorize={() => {
                        void authorizeInstallation(
                          item,
                        );
                      }}
                      onConfigure={() =>
                        openCredentialConfiguration(
                          item,
                        )
                      }
                      onConnect={() => {
                        void startConnection(
                          item,
                        );
                      }}
                      onDisable={() => {
                        void run(
                          `disable:${item.id}`,
                          () =>
                            setMcpInstallationEnabled(
                              item.id,
                              false,
                            ),
                        );
                      }}
                      onRefreshTools={() => {
                        void run(
                          `refresh:${item.id}`,
                          () =>
                            refreshMcpTools(
                              item.id,
                            ),
                        );
                      }}
                      onUpdateConfiguration={() =>
                        openCredentialConfiguration(
                          item,
                        )
                      }
                      onReauthorize={() => {
                        void authorizeInstallation(
                          item,
                        );
                      }}
                      onRevokeAuthorization={() => {
                        if (
                          window.confirm(
                            localize(
                              'mcp.confirm.revokeAuthorization',
                              {
                                name:
                                  item.displayName,
                              },
                            ),
                          )
                        ) {
                          void revokeAuthorization(
                            item,
                          );
                        }
                      }}
                      onUninstall={() => {
                        if (
                          window.confirm(
                            localize(
                              'mcp.confirm.uninstall',
                              {
                                name:
                                  item.displayName,
                              },
                            ),
                          )
                        ) {
                          void run(
                            `uninstall:${item.id}`,
                            () =>
                              uninstallMcpInstallation(
                                item.id,
                              ),
                          );
                        }
                      }}
                    />
                  ),
                )}
              </div>
            )}

            <div
              className={`
                mt-[18px]
                select-none
                text-[10px]
                ${
                  'text-theme-dim '
                }
              `}
            >
              {localize(
                'mcp.panel.userDefinitionsCount',
                {
                  count:
                    userDefinitions.length,
                },
              )}
            </div>

            {userDefinitions.length >
            0 ? (
              <div
                className="
                  mt-[10px]
                  grid
                  w-full
                  min-w-0
                  items-start
                  gap-[16px]
                "
                style={{
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(220px, 1fr))',
                }}
              >
                {userDefinitions.map(
                  (
                    definition,
                  ) => {
                    const installed =
                      installations.some(
                        (
                          item,
                        ) =>
                          item.serverId ===
                          definition.id,
                      );

                    return (
                      <article
                        key={
                          definition.id
                        }
                        className={`
                          box-border
                          flex
                          min-h-[150px]
                          w-full
                          min-w-[180px]
                          flex-col
                          rounded-[10px]
                          p-[10px]
                          transition-all
                          duration-200
                          hover:-translate-y-[2px]
                          hover:shadow-[0_18px_40px_rgba(12,92,251,0.14)]
                          ${
                            'border-[#000000]/[0.055] bg-surface-control-alt dark:border-[#ffffff]/[0.06]  dark:hover:bg-[#272728]'
                          }
                        `}
                      >
                        <div
                          className="
                            flex
                            min-w-0
                            items-start
                            justify-between
                            gap-[12px]
                          "
                        >
                          <h2
                            className={`
                              relative
                              -top-[2px]
                              m-0
                              min-w-0
                              flex-1
                              truncate
                              text-[18px]
                              font-semibold
                              leading-[18px]
                              tracking-[-0.025em]
                              ${
                                'text-theme-primary-alt '
                              }
                            `}
                            title={
                              definition.displayName
                            }
                          >
                            {
                              definition.displayName
                            }
                          </h2>

                          <span
                            className={`
                              inline-flex
                              h-[16px]
                              shrink-0
                              items-center
                              justify-center
                              rounded-[8px]
                              px-[10px]
                              text-[8px]
                              font-medium
                              ${
                                'bg-[#e5e7eb] text-[#5b616b] dark:bg-[#ffffff]/[0.09] dark:text-[#ffffff]/[0.55]'
                              }
                            `}
                          >
                            {localize(
                              'mcp.panel.custom',
                            )}
                          </span>
                        </div>

                        <p
                          className={`
                            mt-[8px]
                            text-[10px]
                            ${
                              'text-[#000000]/48 dark:text-[#ffffff]/42'
                            }
                          `}
                        >
                          {definition.transport ===
                          'stdio'
                            ? localize(
                                'mcp.transport.localStdio',
                              )
                            : 'Streamable HTTP'}
                        </p>

                        <div
                          className="
                            mt-auto
                            flex
                            flex-wrap
                            gap-[8px]
                            pt-[18px]
                          "
                        >
                          <button
                            type="button"
                            className={
                              subtleButton
                            }
                            onClick={() => {
                              void openEdit(
                                definition,
                              );
                            }}
                          >
                            {localize(
                              'common.actions.edit',
                            )}
                          </button>

                          {!installed && (
                            <button
                              type="button"
                              className="
                                box-border
                                inline-flex
                                h-[30px]
                                items-center
                                justify-center
                                rounded-[10px]
                                bg-action-primary
                                px-[12px]
                                text-[9px]
                                font-medium
                                text-[#ffffff]
                                transition-all
                                hover:bg-action-primary-hover
                              "
                              onClick={() => {
                                void run(
                                  `install:${definition.id}`,
                                  () =>
                                    installMcpDefinition(
                                      definition.id,
                                    ),
                                );
                              }}
                            >
                              {localize(
                                'mcp.actions.install',
                              )}
                            </button>
                          )}

                          <button
                            type="button"
                            className={`${subtleButton} text-red-500`}
                            onClick={() => {
                              if (
                                window.confirm(
                                  localize(
                                    'mcp.confirm.deleteDefinition',
                                    {
                                      name:
                                        definition.displayName,
                                    },
                                  ),
                                )
                              ) {
                                void run(
                                  `delete:${definition.id}`,
                                  () =>
                                    deleteMcpDefinition(
                                      definition.id,
                                    ),
                                );
                              }
                            }}
                          >
                            {localize(
                              'common.actions.delete',
                            )}
                          </button>
                        </div>
                      </article>
                    );
                  },
                )}
              </div>
            ) : (
              <div
                className={`
                  mt-[10px]
                  flex
                  h-[30px]
                  items-center
                  justify-center
                  rounded-[10px]
                  py-16
                  text-[11px]
                  ${
                    'text-theme-dim '
                  }
                `}
              >
                {localize(
                  'mcp.panel.emptyDefinitions',
                )}
              </div>
            )}
          </section>

          <div
            className="
              flex
              min-h-0
              min-w-0
              flex-col
              overflow-hidden
              pt-[10px]
              pb-[10px]
            "
          >
            <McpDetailPanel
              selectedInstallation={
                selectedInstallation
              }
              tools={tools}
              definitions={
                definitions
              }
              onEditDefinition={(
                definition,
              ) =>
                void openEdit(
                  definition,
                )
              }
            />
          </div>
        </div>
      </div>

      <McpDefinitionDialog
        open={dialogOpen}
        definition={editing}
        busy={
          busyKey ===
          'save-definition'
        }
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSave={(draft) =>
          void saveDefinition(
            draft,
          )
        }
      />

      <McpImportDialog
        open={importOpen}
        busy={
          busyKey ===
          'import-mcp'
        }
        importPreview={
          importPreview
        }
        error={error}
        onClose={() => {
          setImportOpen(false);
          setImportPreview([]);
          setError(null);
        }}
        onImport={
          handleImport
        }
      />

      {credentialInstallation && (
        <McpCredentialDialog
          installation={
            credentialInstallation
          }
          busy={
            busyKey ===
            `credential:${credentialInstallation.id}`
          }
          error={error}
          onClose={() => {
            setCredentialInstallation(
              null,
            );
          }}
          onSave={async (
            values,
          ) => {
            await configureMcpCredential(
              credentialInstallation.id,
              values,
            );

            setCredentialInstallation(
              null,
            );
          }}
        />
      )}
    </div>
  );
}