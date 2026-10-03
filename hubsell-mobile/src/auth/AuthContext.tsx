import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { setAuthToken, setOnUnauthorized } from "../api/client";
import {
  login as apiLogin,
  register as apiRegister,
  fetchMe,
  type RegisterPayload,
} from "../api/auth";
import type { AuthUser, LoginResponse } from "../types/api";
import * as storage from "./storage";

const TOKEN_KEY = "hubsell.token";
const USER_KEY = "hubsell.user";

type AuthStatus = "loading" | "signedOut" | "signedIn";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (identifier: string, password: string) => Promise<AuthUser>;
  /** Đăng ký chủ shop mới — backend trả token ngay, vào app không cần đăng nhập lại. */
  signUp: (data: RegisterPayload) => Promise<AuthUser>;
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

  // Đăng nhập và đăng ký cùng nhận {token, user} → một chỗ lưu phiên.
  const persistSession = useCallback(async (res: LoginResponse) => {
    setAuthToken(res.token);
    setUser(res.user);
    setStatus("signedIn");
    await Promise.all([
      storage.setItem(TOKEN_KEY, res.token),
      storage.setItem(USER_KEY, JSON.stringify(res.user)),
    ]);
    return res.user;
  }, []);

  const signIn = useCallback(
    (identifier: string, password: string) =>
      apiLogin(identifier, password).then(persistSession),
    [persistSession]
  );

  const signUp = useCallback(
    (data: RegisterPayload) => apiRegister(data).then(persistSession),
    [persistSession]
  );

  const value = useMemo(
    () => ({ status, user, signIn, signUp, signOut }),
    [status, user, signIn, signUp, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải nằm trong <AuthProvider>");
  return ctx;
}
