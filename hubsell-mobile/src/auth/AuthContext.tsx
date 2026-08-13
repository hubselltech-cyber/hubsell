import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { setAuthToken, setOnUnauthorized } from "../api/client";
import { login as apiLogin, fetchMe } from "../api/auth";
import type { AuthUser } from "../types/api";
import * as storage from "./storage";

const TOKEN_KEY = "hubsell.token";
const USER_KEY = "hubsell.user";

type AuthStatus = "loading" | "signedOut" | "signedIn";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (identifier: string, password: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const signOut = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    setStatus("signedOut");
    await Promise.all([storage.deleteItem(TOKEN_KEY), storage.deleteItem(USER_KEY)]);
  }, []);

  // Token hết hạn giữa chừng (401) → về màn đăng nhập thay vì mỗi màn tự lo.
  useEffect(() => {
    setOnUnauthorized(() => {
      void signOut();
    });
    return () => setOnUnauthorized(null);
  }, [signOut]);

  // Khôi phục phiên: hiện ngay bằng user đã cache, rồi refresh /me nền —
  // kho mở app phải vào thẳng màn quét, không bắt chờ mạng.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [token, rawUser] = await Promise.all([
        storage.getItem(TOKEN_KEY),
        storage.getItem(USER_KEY),
      ]);
      if (cancelled) return;
      if (!token || !rawUser) {
        setStatus("signedOut");
        return;
      }
      setAuthToken(token);
      try {
        setUser(JSON.parse(rawUser) as AuthUser);
        setStatus("signedIn");
      } catch {
        setStatus("signedOut");
        return;
      }
      try {
        const me = await fetchMe();
        if (!cancelled) {
          setUser(me.user);
          await storage.setItem(USER_KEY, JSON.stringify(me.user));
        }
      } catch {
        // offline hoặc 401 — 401 đã được onUnauthorized xử lý, offline thì
        // cứ chạy tiếp bằng user cache.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const res = await apiLogin(identifier, password);
    setAuthToken(res.token);
    setUser(res.user);
    setStatus("signedIn");
    await Promise.all([
      storage.setItem(TOKEN_KEY, res.token),
      storage.setItem(USER_KEY, JSON.stringify(res.user)),
    ]);
    return res.user;
  }, []);

  const value = useMemo(
    () => ({ status, user, signIn, signOut }),
    [status, user, signIn, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải nằm trong <AuthProvider>");
  return ctx;
}
