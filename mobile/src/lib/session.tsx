// Who is signed in, to which server. The token is kept in the phone's secure storage,
// so the app stays signed in between launches; the password is never stored.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError, DEFAULT_API, createApi, type Api } from './api';
import { storage } from './storage';

type Session = { server: string; token: string; email: string };

type SessionContext = {
  ready: boolean;
  session: Session | null;
  server: string;
  setServer: (url: string) => void;
  api: Api;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Wraps an API call: an expired session signs out instead of showing an error. */
  guard: <T>(call: () => Promise<T>) => Promise<T>;
};

const Ctx = createContext<SessionContext | null>(null);
const KEY = 'room-sentinel-session';
const SERVER_KEY = 'room-sentinel-server';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [server, setServerState] = useState(DEFAULT_API);
  const token = session?.token ?? null;
  const api = useMemo(() => createApi(session?.server ?? server, () => token), [session?.server, server, token]);

  useEffect(() => {
    (async () => {
      try {
        const savedServer = await storage.get(SERVER_KEY);
        if (savedServer) setServerState(savedServer);
        const raw = await storage.get(KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Session;
          // still valid? an expired token just means signing in again
          await createApi(saved.server, () => saved.token).me(saved.token);
          setSession(saved);
        }
      } catch {
        await storage.remove(KEY).catch(() => undefined);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const setServer = useCallback((url: string) => {
    setServerState(url);
    storage.set(SERVER_KEY, url).catch(() => undefined);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const client = createApi(server, () => null);
    const token = await client.signIn(email, password);
    const user = await client.me(token);
    const next = { server: client.base, token, email: user.email };
    await storage.set(KEY, JSON.stringify(next));
    setSession(next);
  }, [server]);

  const register = useCallback(async (email: string, password: string) => {
    await createApi(server, () => null).register(email, password);
  }, [server]);

  const signOut = useCallback(async () => {
    await storage.remove(KEY).catch(() => undefined);
    setSession(null);
  }, []);

  const guard = useCallback(async <T,>(call: () => Promise<T>) => {
    try {
      return await call();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await signOut();
      throw e;
    }
  }, [signOut]);

  const value = useMemo(() => ({ ready, session, server, setServer, api, signIn, register, signOut, guard }),
    [ready, session, server, setServer, api, signIn, register, signOut, guard]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
