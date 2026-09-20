import { api } from '../../../lib/http';
import type {
  AiSelectionRole,
  LlmCatalogResponse,
  UserLlmSettings,
  UserWebSearchSettings,
  WebSearchCatalogResponse,
} from './model-settings.types';

export const modelSettingsApi = {
  async catalog(): Promise<LlmCatalogResponse> {
    return (await api.get<LlmCatalogResponse>('/llm-settings/catalog')).data;
  },

  async current(): Promise<UserLlmSettings> {
    return (await api.get<UserLlmSettings>('/llm-settings/me')).data;
  },

  async save(input: {
    role: AiSelectionRole;
    providerKey: string;
    modelKey?: string;
    apiKey?: string;
  }): Promise<UserLlmSettings> {
    return (await api.put<UserLlmSettings>('/llm-settings/me', input)).data;
  },

  async clearRole(role: Exclude<AiSelectionRole, 'primary'>): Promise<UserLlmSettings> {
    return (
      await api.delete<UserLlmSettings>(
        `/llm-settings/me/roles/${encodeURIComponent(role)}`,
      )
    ).data;
  },

  async deleteCredential(providerKey: string): Promise<void> {
    await api.delete(`/llm-settings/me/credentials/${encodeURIComponent(providerKey)}`);
  },

  async webCatalog(): Promise<WebSearchCatalogResponse> {
    return (await api.get<WebSearchCatalogResponse>('/web-search-settings/catalog')).data;
  },

  async currentWebSearch(): Promise<UserWebSearchSettings> {
    return (await api.get<UserWebSearchSettings>('/web-search-settings/me')).data;
  },

  async saveWebSearch(input: { providerKey: string; apiKey?: string }): Promise<UserWebSearchSettings> {
    return (await api.put<UserWebSearchSettings>('/web-search-settings/me', input)).data;
  },

  async clearWebSearch(): Promise<UserWebSearchSettings> {
    return (await api.delete<UserWebSearchSettings>('/web-search-settings/me')).data;
  },
};
