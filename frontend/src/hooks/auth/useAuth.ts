import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ensureLocalSession } from '../../lib/http';
import {
  getAuthToken,
  setAuthToken,
  subscribeAuthToken,
} from '../../lib/auth-token';
import {
  getUserProfile,
  updateUserProfile as requestUserProfileUpdate,
  type AuthUserProfile,
  type UpdateUserProfileInput,
} from './user-profile.api';

export type LocalSessionState =
  | 'loading'
  | 'ready'
  | 'error';

type AuthContextValue = {
  token: string;
  isLoggedIn: boolean;
  authReady: boolean;
  sessionState: LocalSessionState;
  profile: AuthUserProfile | null;
  profileLoading: boolean;
  retrySession(): Promise<void>;
  refreshProfile(): Promise<AuthUserProfile | null>;
  updateProfile(
    input: UpdateUserProfileInput,
  ): Promise<AuthUserProfile>;
};

const AuthContext =
  createContext<AuthContextValue | null>(
    null,
  );

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [token, setToken] =
    useState(
      getAuthToken() ?? '',
    );

  const [
    sessionState,
    setSessionState,
  ] =
    useState<LocalSessionState>(
      'loading',
    );

  const [
    profile,
    setProfile,
  ] =
    useState<AuthUserProfile | null>(
      null,
    );

  const [
    profileLoading,
    setProfileLoading,
  ] = useState(false);

  const sessionAttemptRef =
    useRef(0);

  useEffect(
    () =>
      subscribeAuthToken(
        (next) =>
          setToken(next ?? ''),
      ),
    [],
  );

  const establishSession =
    useCallback(
      async () => {
        const attempt =
          ++sessionAttemptRef.current;

        setSessionState('loading');

        try {
          await ensureLocalSession();

          if (
            attempt
            !== sessionAttemptRef.current
          ) {
            return;
          }

          setSessionState('ready');
        } catch {
          if (
            attempt
            !== sessionAttemptRef.current
          ) {
            return;
          }

          setAuthToken(null);
          setSessionState('error');
        }
      },
      [],
    );

  useEffect(() => {
    void establishSession();

    return () => {
      sessionAttemptRef.current += 1;
    };
  }, [establishSession]);

  const refreshProfile =
    useCallback(
      async (): Promise<AuthUserProfile | null> => {
        if (!getAuthToken()) {
          setProfile(null);
          return null;
        }

        setProfileLoading(true);

        try {
          const nextProfile =
            await getUserProfile();

          setProfile(nextProfile);
          return nextProfile;
        } catch {
          setProfile(null);
          return null;
        } finally {
          setProfileLoading(false);
        }
      },
      [],
    );

  useEffect(() => {
    if (
      sessionState === 'ready'
      && !token
    ) {
      void establishSession();
    }
  }, [
    token,
    sessionState,
    establishSession,
  ]);

  useEffect(() => {
    if (!token) {
      setProfile(null);
      return;
    }

    void refreshProfile();
  }, [
    token,
    refreshProfile,
  ]);

  const updateProfile =
    useCallback(
      async (
        input: UpdateUserProfileInput,
      ): Promise<AuthUserProfile> => {
        const nextProfile =
          await requestUserProfileUpdate(
            input,
          );

        setProfile(nextProfile);
        return nextProfile;
      },
      [],
    );

  const value =
    useMemo<AuthContextValue>(
      () => ({
        token,
        isLoggedIn:
          Boolean(token),
        authReady:
          sessionState !== 'loading',
        sessionState,
        profile,
        profileLoading,
        retrySession:
          establishSession,
        refreshProfile,
        updateProfile,
      }),
      [
        token,
        sessionState,
        profile,
        profileLoading,
        establishSession,
        refreshProfile,
        updateProfile,
      ],
    );

  return createElement(
    AuthContext.Provider,
    { value },
    children,
  );
}

export function useAuth(): AuthContextValue {
  const context =
    useContext(AuthContext);

  if (!context) {
    throw new Error(
      'useAuth must be used inside AuthProvider',
    );
  }

  return context;
}
