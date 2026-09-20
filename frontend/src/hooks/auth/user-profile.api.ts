import { api } from '../../lib/http';

export interface AuthUserProfile {
  id: string;
  phone?: string | null;
  username: string;
  nickname?: string | null;
  email: string;
  role: string;
  plan: string;
  preferredLanguage?: string | null;
  avatarKey?: string | null;
  avatarUpdatedAt?: string | null;
  avatarUrl?: string | null;
  createdAt: string;
}

export interface UpdateUserProfileInput {
  username?: string;
  avatarFile?: File | null;
}

export async function getUserProfile(): Promise<AuthUserProfile> {
  const { data } = await api.get<AuthUserProfile>('/user/me');
  return data;
}

export async function updateUserProfile(
  input: UpdateUserProfileInput,
): Promise<AuthUserProfile> {
  const form = new FormData();

  if (input.username !== undefined) {
    form.append('username', input.username);
  }

  if (input.avatarFile) {
    form.append('avatarFile', input.avatarFile);
  }

  const { data } = await api.patch<AuthUserProfile>(
    '/user/profile',
    form,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    },
  );

  return data;
}
