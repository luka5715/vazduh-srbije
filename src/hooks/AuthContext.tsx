import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { AuthConfigState, AuthUser, IAuthService } from '@/services/IAuthService';

export interface AuthContextValue {
  user: AuthUser | null;
  /** Dok traje tiho razrešavanje sesije pri startu. */
  loading: boolean;
  /** Greška poslednje interaktivne prijave ili tihog razrešavanja. */
  error: string | null;
  isAuthenticated: boolean;
  mode: 'rayfin' | 'demo';
  config: AuthConfigState;
  canSignIn: boolean;
  signIn: () => Promise<AuthUser>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
  authService: IAuthService;
}

/**
 * Jednom pri montiranju tiho razrešava sesiju; posle toga prati promene sesije
 * (odjava, istek) i nudi interaktivnu prijavu/odjavu.
 */
export function AuthProvider({ children, authService }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authService
      .resolveSession()
      .then((resolved) => {
        if (!cancelled) setUser(resolved);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setUser(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authService]);

  useEffect(() => {
    if (!user || !authService.onSessionChange) return;
    return authService.onSessionChange((next) => setUser(next));
  }, [authService, user]);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      const signedIn = await authService.signIn();
      setUser(signedIn);
      return signedIn;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prijava nije uspela.');
      throw err;
    }
  }, [authService]);

  const signOut = useCallback(async () => {
    try {
      await authService.signOut();
    } finally {
      setUser(null);
    }
  }, [authService]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      isAuthenticated: user !== null,
      mode: authService.mode,
      config: authService.config,
      canSignIn: authService.canSignIn,
      signIn,
      signOut,
    }),
    [user, loading, error, signIn, signOut, authService],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook i provider dele fajl (šablon Rayfin-a)
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth se koristi samo unutar AuthProvider-a');
  }
  return context;
}
