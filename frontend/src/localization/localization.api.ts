import { api } from '../lib/api';
import type {
  UiLocale,
  UserLocalizationPreferences,
} from './locale.types';

export async function getUserLocalizationPreferences(): Promise<UserLocalizationPreferences> {
  const { data } = await api.get('/user/me');

  return {
    preferredLanguage:
      (data?.preferredLanguage ?? null) as UiLocale | null,
  };
}

export async function updateUserLocalizationPreferences(input: {
  preferredLanguage?: UiLocale | null;
}): Promise<UserLocalizationPreferences> {
  const { data } = await api.patch(
    '/user/preferences/localization',
    input,
  );

  return {
    preferredLanguage:
      (data?.preferredLanguage ?? null) as UiLocale | null,
  };
}
