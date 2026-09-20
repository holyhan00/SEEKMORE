                                                                

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import AudioGenerationProviderSection from './AudioGenerationProviderSection';
import VideoGenerationProviderSection, {
  type VideoGenerationSelection,
} from './VideoGenerationProviderSection';

import ModelRoleSection, {
  type ModelRoleSelection,
} from './ModelRoleSection';

import WebSearchSection from './WebSearchSection';

import {
  modelSettingsApi,
} from './model-settings.api';

import type {
  AiSelectionRole,
  AudioGenerationCatalogProvider,
  LlmCatalogProvider,
  LlmModelRole,
  UserLlmSettings,
  VideoGenerationCatalogProvider,
  UserWebSearchSettings,
  WebSearchCatalogProvider,
} from './model-settings.types';

import {
  localizeApiError,
} from '../../../localization/localizeApiError';

import {
  useLocalize,
} from '../../../localization/useLocalize';

import {
  confirm,
} from '../../../lib/confirm';

const EMPTY_CREDENTIAL = {
  configured: false,
  keyHint: null,
  status: null,
  verifiedAt: null,
  lastValidationCode: null,
};

const EMPTY_SETTINGS: UserLlmSettings = {
  primary: {
    providerKey: null,
    modelKey: null,
    capabilities: null,
    credential: EMPTY_CREDENTIAL,
  },
  vision: {
    providerKey: null,
    modelKey: null,
    capabilities: null,
    credential: EMPTY_CREDENTIAL,
  },
  imageGeneration: {
    providerKey: null,
    modelKey: null,
    capabilities: null,
    credential: EMPTY_CREDENTIAL,
  },
  videoGeneration: {
    providerKey: null,
    modelKey: null,
    capabilities: null,
    credential: EMPTY_CREDENTIAL,
  },
  audioGeneration: {
    providerKey: null,
    capabilities: null,
    speechModelKey: null,
    musicModelKey: null,
    credential: EMPTY_CREDENTIAL,
  },
  primarySupportsImageInput: false,
  credentials: [],
};

const EMPTY_WEB_SETTINGS:
  UserWebSearchSettings = {
    providerKey: null,
    credential: EMPTY_CREDENTIAL,
  };

interface PanelMessage {
  kind: 'ok' | 'error' | 'info';
  text: string;
}

interface RoleSelections {
  primary: ModelRoleSelection;
  vision: ModelRoleSelection;
  image_generation: ModelRoleSelection;
}

const EMPTY_SELECTION:
  ModelRoleSelection = {
    providerKey: '',
    modelKey: '',
  };

export default function ModelSettingsPanel({
  }: {

}) {
  const localize = useLocalize();

  const [
    providers,
    setProviders,
  ] = useState<LlmCatalogProvider[]>([]);

  const [
    videoProviders,
    setVideoProviders,
  ] = useState<
    VideoGenerationCatalogProvider[]
  >([]);

  const [
    audioProviders,
    setAudioProviders,
  ] = useState<
    AudioGenerationCatalogProvider[]
  >([]);

  const [
    settings,
    setSettings,
  ] = useState<UserLlmSettings>(
    EMPTY_SETTINGS,
  );

  const [
    webProviders,
    setWebProviders,
  ] = useState<
    WebSearchCatalogProvider[]
  >([]);

  const [
    webSettings,
    setWebSettings,
  ] = useState<UserWebSearchSettings>(
    EMPTY_WEB_SETTINGS,
  );

  const [
    videoSelection,
    setVideoSelection,
  ] = useState<VideoGenerationSelection>({
    providerKey: '',
    modelKey: '',
  });

  const [
    audioProviderKey,
    setAudioProviderKey,
  ] = useState('');

  const [
    selections,
    setSelections,
  ] = useState<RoleSelections>({
    primary: EMPTY_SELECTION,
    vision: EMPTY_SELECTION,
    image_generation:
      EMPTY_SELECTION,
  });

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState<PanelMessage | null>(
    null,
  );

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      setMessage(null);

      try {
        const [
          catalog,
          current,
          searchCatalog,
          currentSearch,
        ] = await Promise.all([
          modelSettingsApi.catalog(),
          modelSettingsApi.current(),
          modelSettingsApi.webCatalog(),
          modelSettingsApi.currentWebSearch(),
        ]);

        if (!alive) return;

        const normalizedProviders =
          normalizeProviders(
            catalog.providers,
          );

        const normalizedVideoProviders =
          catalog.videoProviders
            .filter(
              (item) => item.enabled,
            )
            .map((item) => ({
              ...item,
              models: item.models.filter(
                (model) => model.enabled,
              ),
            }))
            .filter(
              (item) => item.models.length > 0,
            )
            .sort(
              (left, right) =>
                left.sortOrder -
                right.sortOrder,
            );

        const normalizedAudioProviders =
          catalog.audioProviders
            .filter(
              (item) =>
                item.enabled,
            )
            .sort(
              (left, right) =>
                left.sortOrder -
                right.sortOrder,
            );

        setProviders(
          normalizedProviders,
        );

        setVideoProviders(
          normalizedVideoProviders,
        );

        setAudioProviders(
          normalizedAudioProviders,
        );

        setSettings(current);

        setVideoSelection(
          resolveVideoSelection(
            normalizedVideoProviders,
            current.videoGeneration
              .providerKey,
            current.videoGeneration
              .modelKey,
          ),
        );

        setAudioProviderKey(
          current.audioGeneration
            .providerKey ?? '',
        );

        setWebProviders(
          searchCatalog.providers.filter(
            (item) =>
              item.enabled,
          ),
        );

        setWebSettings(
          currentSearch,
        );

        setSelections({
          primary:
            resolveSelection(
              normalizedProviders,
              'primary',
              current.primary
                .providerKey,
              current.primary
                .modelKey,
              true,
            ),

          vision:
            resolveSelection(
              normalizedProviders,
              'vision',
              current.vision
                .providerKey,
              current.vision
                .modelKey,
              false,
            ),

          image_generation:
            resolveSelection(
              normalizedProviders,
              'image_generation',
              current.imageGeneration
                .providerKey,
              current.imageGeneration
                .modelKey,
              false,
            ),
        });
      } catch (error) {
        if (!alive) return;

        setProviders([]);
        setVideoProviders([]);
        setAudioProviders([]);

        setSettings(
          EMPTY_SETTINGS,
        );

        setVideoSelection({
          providerKey: '',
          modelKey: '',
        });

        setAudioProviderKey('');

        setWebProviders([]);

        setWebSettings(
          EMPTY_WEB_SETTINGS,
        );

        setMessage({
          kind: 'error',
          text:
            errorMessage(error),
        });
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      alive = false;
    };
  }, []);

  const primaryModel =
    useMemo(
      () =>
        findModel(
          providers,
          selections.primary
            .providerKey,
          selections.primary
            .modelKey,
        ),
      [
        providers,
        selections.primary,
      ],
    );

  const primaryLabel =
    useMemo(() => {
      const provider =
        providers.find(
          (item) =>
            item.providerKey ===
            selections.primary
              .providerKey,
        );

      return (
        primaryModel &&
        provider
          ? `${provider.displayName} · ${primaryModel.displayName}`
          : localize(
              'settings.model.currentPrimary',
            )
      );
    }, [
      localize,
      primaryModel,
      providers,
      selections.primary
        .providerKey,
    ]);

  const excludedPrimary =
    selections.primary
      .providerKey &&
    selections.primary.modelKey
      ? selections.primary
      : null;

  const visionHint =
    primaryModel
      ?.capabilities
      .imageInput
      ? localize(
          'settings.model.primarySupportsVision',
          {
            model:
              primaryLabel,
          },
        )
      : undefined;

  const imageHint =
    primaryModel
      ?.capabilities
      .imageOutput
      ? localize(
          'settings.model.primarySupportsImageGeneration',
          {
            model:
              primaryLabel,
          },
        )
      : undefined;

  const audioCapabilities = [
    primaryModel
      ?.capabilities
      .speechGeneration
      ? localize(
          'settings.model.capability.speechGeneration',
        )
      : '',
    primaryModel
      ?.capabilities
      .voiceCloning
      ? localize(
          'settings.model.capability.voiceCloning',
        )
      : '',
    primaryModel
      ?.capabilities
      .musicGeneration
      ? localize(
          'settings.model.capability.musicGeneration',
        )
      : '',
  ].filter(Boolean);

  const audioHint =
    audioCapabilities.length >
    0
      ? localize(
          'settings.model.primarySupportsAudio',
          {
            model:
              primaryLabel,
            capabilities:
              audioCapabilities.join(
                localize(
                  'common.listSeparator',
                ),
              ),
          },
        )
      : undefined;

  const confirmClearSettings =
    async () =>
      confirm({
        title: localize(
          'settings.model.clearConfirmTitle',
        ),
        description: localize(
          'settings.model.clearConfirmDescription',
        ),
        confirmText: localize(
          'common.actions.clear',
        ),
        cancelText: localize(
          'common.actions.cancel',
        ),
        danger: true,
      });

  const saveRole = async (
    role: LlmModelRole,
    input:
      ModelRoleSelection & {
        apiKey?: string;
      },
  ) => {
    setSaving(true);

    setMessage({
      kind: 'info',
      text: localize(
        'settings.model.validatingAndSaving',
      ),
    });

    try {
      const next =
        await modelSettingsApi.save({
          role,
          ...input,
        });

      setSettings(next);

      setSelections(
        (current) => ({
          ...current,
          [role]: input,
        }),
      );

      setMessage({
        kind: 'ok',
        text: localize(
          'settings.model.saved',
        ),
      });
    } catch (error) {
      setMessage({
        kind: 'error',
        text:
          errorMessage(error),
      });

      throw error;
    } finally {
      setSaving(false);
    }
  };

  const clearRole = async (
    role: Exclude<
      AiSelectionRole,
      'primary'
    >,
  ) => {
    const confirmed =
      await confirmClearSettings();

    if (!confirmed) {
      return;
    }

    setSaving(true);

    setMessage({
      kind: 'info',
      text: localize(
        'settings.model.clearing',
      ),
    });

    try {
      const next =
        await modelSettingsApi.clearRole(
          role,
        );

      setSettings(next);

      if (
        role ===
        'audio_generation'
      ) {
        setAudioProviderKey('');
      } else if (
        role ===
        'video_generation'
      ) {
        setVideoSelection({
          providerKey: '',
          modelKey: '',
        });
      } else {
        setSelections(
          (current) => ({
            ...current,
            [role]:
              EMPTY_SELECTION,
          }),
        );
      }

      setMessage({
        kind: 'ok',
        text: localize(
          'settings.model.cleared',
        ),
      });
    } catch (error) {
      setMessage({
        kind: 'error',
        text:
          errorMessage(error),
      });

      throw error;
    } finally {
      setSaving(false);
    }
  };

  const contentClass =
    'bg-surface-settings text-theme-primary  ';

  return (
    <div
      className={[
        contentClass,
        'box-border h-full w-full min-w-0 overflow-x-hidden overflow-y-auto px-[10px] pb-[24px] [&::-webkit-scrollbar]:hidden [scrollbar-width:none]',
      ].join(' ')}
    >
      <div className="mb-[10px]">
        <div className="mt-[18px] select-none text-[18px] font-semibold">
          {localize(
            'settings.model.title',
          )}
        </div>

        <div
          className={[
            'text-[11px]',
            'text-theme-faint ',
          ].join(' ')}
        >
          {localize(
            'settings.model.description',
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-[12px] opacity-60">
          {localize(
            'settings.model.loadingCatalog',
          )}
        </div>
      ) : (
        <div className="space-y-[12px]">
          {message && (
            <div
              className={[
                'rounded-[10px] px-3 py-2 text-[11px]',
                messageClassName(
                  message.kind,
                ),
              ].join(' ')}
            >
              {message.text}
            </div>
          )}

          <ModelRoleSection
            title={localize(
              'settings.model.primary.title',
            )}
            description={localize(
              'settings.model.primary.description',
            )}
            role="primary"
            providers={providers}
            selection={
              selections.primary
            }
            savedSelection={{
              providerKey:
                settings.primary
                  .providerKey ??
                '',
              modelKey:
                settings.primary
                  .modelKey ?? '',
            }}
            credentials={
              settings.credentials
            }
            saving={saving}

            onSelectionChange={(
              selection,
            ) => {
              setSelections(
                (current) => ({
                  ...current,
                  primary:
                    selection,
                }),
              );

              setMessage(null);
            }}
            onSave={(input) =>
              saveRole(
                'primary',
                input,
              )
            }
          />

          <ModelRoleSection
            title={localize(
              'settings.model.vision.title',
            )}
            description={localize(
              'settings.model.vision.description',
            )}
            role="vision"
            providers={providers}
            selection={
              selections.vision
            }
            savedSelection={{
              providerKey:
                settings.vision
                  .providerKey ??
                '',
              modelKey:
                settings.vision
                  .modelKey ?? '',
            }}
            credentials={
              settings.credentials
            }
            excludedSelection={
              excludedPrimary
            }
            hint={visionHint}
            optional
            saving={saving}

            onSelectionChange={(
              selection,
            ) => {
              setSelections(
                (current) => ({
                  ...current,
                  vision:
                    selection,
                }),
              );

              setMessage(null);
            }}
            onSave={(input) =>
              saveRole(
                'vision',
                input,
              )
            }
            onClear={() =>
              clearRole('vision')
            }
          />

          <ModelRoleSection
            title={localize(
              'settings.model.image.title',
            )}
            description={localize(
              'settings.model.image.description',
            )}
            role="image_generation"
            providers={providers}
            selection={
              selections.image_generation
            }
            savedSelection={{
              providerKey:
                settings
                  .imageGeneration
                  .providerKey ??
                '',
              modelKey:
                settings
                  .imageGeneration
                  .modelKey ??
                '',
            }}
            credentials={
              settings.credentials
            }
            excludedSelection={
              excludedPrimary
            }
            hint={imageHint}
            optional
            saving={saving}

            onSelectionChange={(
              selection,
            ) => {
              setSelections(
                (current) => ({
                  ...current,
                  image_generation:
                    selection,
                }),
              );

              setMessage(null);
            }}
            onSave={(input) =>
              saveRole(
                'image_generation',
                input,
              )
            }
            onClear={() =>
              clearRole(
                'image_generation',
              )
            }
          />

          <VideoGenerationProviderSection
            providers={
              videoProviders
            }
            selection={
              videoSelection
            }
            savedSelection={{
              providerKey:
                settings
                  .videoGeneration
                  .providerKey ?? '',
              modelKey:
                settings
                  .videoGeneration
                  .modelKey ?? '',
            }}
            credentials={
              settings.credentials
            }
            saving={saving}

            onSelectionChange={(
              selection,
            ) => {
              setVideoSelection(
                selection,
              );

              setMessage(null);
            }}
            onSave={async (
              input,
            ) => {
              setSaving(true);

              setMessage({
                kind: 'info',
                text: localize(
                  'settings.model.validatingAndSaving',
                ),
              });

              try {
                const next =
                  await modelSettingsApi.save({
                    role: 'video_generation',
                    providerKey:
                      input.providerKey,
                    modelKey:
                      input.modelKey,
                    ...(input.apiKey
                      ? {
                          apiKey:
                            input.apiKey,
                        }
                      : {}),
                  });

                setSettings(next);

                setVideoSelection({
                  providerKey:
                    input.providerKey,
                  modelKey:
                    input.modelKey,
                });

                setMessage({
                  kind: 'ok',
                  text: localize(
                    'settings.model.saved',
                  ),
                });
              } catch (error) {
                setMessage({
                  kind: 'error',
                  text:
                    errorMessage(
                      error,
                    ),
                });

                throw error;
              } finally {
                setSaving(false);
              }
            }}
            onClear={() =>
              clearRole(
                'video_generation',
              )
            }
          />

          <AudioGenerationProviderSection
            providers={
              audioProviders
            }
            providerKey={
              audioProviderKey
            }
            savedProviderKey={
              settings
                .audioGeneration
                .providerKey ?? ''
            }
            credentials={
              settings.credentials
            }
            saving={saving}

            hint={audioHint}
            onProviderChange={(
              providerKey,
            ) => {
              setAudioProviderKey(
                providerKey,
              );

              setMessage(null);
            }}
            onSave={async (
              input,
            ) => {
              setSaving(true);

              setMessage({
                kind: 'info',
                text: localize(
                  'common.saving',
                ),
              });

              try {
                const next =
                  await modelSettingsApi.save({
                    role: 'audio_generation',
                    providerKey:
                      input.providerKey,
                    ...(input.apiKey
                      ? {
                          apiKey:
                            input.apiKey,
                        }
                      : {}),
                  });

                setSettings(next);

                setAudioProviderKey(
                  input.providerKey,
                );

                setMessage({
                  kind: 'ok',
                  text: localize(
                    'settings.model.saved',
                  ),
                });
              } catch (error) {
                setMessage({
                  kind: 'error',
                  text:
                    errorMessage(
                      error,
                    ),
                });

                throw error;
              } finally {
                setSaving(false);
              }
            }}
            onClear={() =>
              clearRole(
                'audio_generation',
              )
            }
          />

          <WebSearchSection
            key={`${webSettings.providerKey ?? 'none'}:${webSettings.credential.keyHint ?? ''}`}
            providers={
              webProviders
            }
            settings={
              webSettings
            }
            disabled={saving}

            onSave={async (
              input,
            ) => {
              setSaving(true);

              setMessage({
                kind: 'info',
                text: localize(
                  'settings.model.validatingAndSaving',
                ),
              });

              try {
                const next =
                  await modelSettingsApi.saveWebSearch(
                    input,
                  );

                setWebSettings(
                  next,
                );

                setMessage({
                  kind: 'ok',
                  text: localize(
                    'settings.model.saved',
                  ),
                });
              } catch (error) {
                setMessage({
                  kind: 'error',
                  text:
                    errorMessage(
                      error,
                    ),
                });

                throw error;
              } finally {
                setSaving(false);
              }
            }}
            onClear={async () => {
              const confirmed =
                await confirmClearSettings();

              if (!confirmed) {
                return;
              }

              setSaving(true);

              setMessage({
                kind: 'info',
                text: localize(
                  'settings.model.clearing',
                ),
              });

              try {
                const next =
                  await modelSettingsApi.clearWebSearch();

                setWebSettings(
                  next,
                );

                setMessage({
                  kind: 'ok',
                  text: localize(
                    'settings.model.cleared',
                  ),
                });
              } catch (error) {
                setMessage({
                  kind: 'error',
                  text:
                    errorMessage(
                      error,
                    ),
                });

                throw error;
              } finally {
                setSaving(false);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

function normalizeProviders(
  providers:
    LlmCatalogProvider[],
): LlmCatalogProvider[] {
  return providers
    .filter(
      (provider) =>
        provider.enabled,
    )
    .map((provider) => ({
      ...provider,
      models:
        provider.models.filter(
          (model) =>
            model.enabled,
        ),
    }))
    .filter(
      (provider) =>
        provider.models.length >
        0,
    )
    .sort(
      (left, right) =>
        left.sortOrder -
        right.sortOrder,
    );
}

function resolveSelection(
  providers:
    LlmCatalogProvider[],
  role: LlmModelRole,
  providerKey: string | null,
  modelKey: string | null,
  fallbackToFirst: boolean,
): ModelRoleSelection {
  const selected =
    findModel(
      providers,
      providerKey ?? '',
      modelKey ?? '',
    );

  if (
    selected?.roles.includes(role)
  ) {
    return {
      providerKey:
        providerKey ?? '',
      modelKey:
        modelKey ?? '',
    };
  }

  if (!fallbackToFirst) {
    return EMPTY_SELECTION;
  }

  for (const provider of providers) {
    const model =
      provider.models.find(
        (item) =>
          item.roles.includes(
            role,
          ),
      );

    if (model) {
      return {
        providerKey:
          provider.providerKey,
        modelKey:
          model.modelKey,
      };
    }
  }

  return EMPTY_SELECTION;
}

function resolveVideoSelection(
  providers:
    VideoGenerationCatalogProvider[],
  providerKey: string | null,
  modelKey: string | null,
): VideoGenerationSelection {
  const provider =
    providers.find(
      (item) =>
        item.providerKey ===
        providerKey,
    );
  const model =
    provider?.models.find(
      (item) =>
        item.modelKey ===
        modelKey,
    );

  if (!provider || !model) {
    return {
      providerKey: '',
      modelKey: '',
    };
  }

  return {
    providerKey:
      provider.providerKey,
    modelKey:
      model.modelKey,
  };
}

function findModel(
  providers:
    LlmCatalogProvider[],
  providerKey: string,
  modelKey: string,
) {
  return (
    providers
      .find(
        (provider) =>
          provider.providerKey ===
          providerKey,
      )
      ?.models.find(
        (model) =>
          model.modelKey ===
          modelKey,
      ) ?? null
  );
}

function messageClassName(
  _kind: PanelMessage['kind'],
): string {
  return 'bg-[#000000]/5 text-theme-secondary-65 dark:bg-[#ffffff]/5 ';
}

function errorMessage(
  error: unknown,
): string {
  return localizeApiError(
    error,
    'errors.operationFailed',
  );
}