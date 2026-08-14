import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Platform } from "react-native";
import { colorScheme as nwColorScheme } from "nativewind";
import * as SecureStore from "expo-secure-store";

/**
 * Giao diện Sáng/Tối — mặc định THEO HỆ THỐNG (chuẩn 2026: iOS/Android tự có
 * lịch chuyển sáng↔tối, app chỉ nghe theo), kèm ghi đè tay trong Cấu hình.
 * Tùy chọn lưu bền qua SecureStore (web-sim fallback localStorage).
 */

export type ThemePref = "light" | "dark" | "system";

const STORE_KEY = "hubsell.themePref";

function loadPref(): Promise<ThemePref | null> {
  if (Platform.OS === "web") {
    try {
      return Promise.resolve(
        (globalThis.localStorage?.getItem(STORE_KEY) as ThemePref) ?? null
      );
    } catch {
      return Promise.resolve(null);
    }
  }
  return SecureStore.getItemAsync(STORE_KEY) as Promise<ThemePref | null>;
}

function savePref(pref: ThemePref): void {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.setItem(STORE_KEY, pref);
    } catch {
      /* web-sim không có localStorage thì thôi — chỉ mất ghi nhớ */
    }
    return;
  }
  void SecureStore.setItemAsync(STORE_KEY, pref);
}

const ThemeContext = createContext<{
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
}>({ pref: "system", setPref: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>("system");

  // Nạp tùy chọn đã lưu 1 lần khi mở app rồi áp ngay cho NativeWind
  useEffect(() => {
    void loadPref().then((saved) => {
      if (saved === "light" || saved === "dark" || saved === "system") {
        setPrefState(saved);
        nwColorScheme.set(saved);
      }
    });
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    nwColorScheme.set(p);
    savePref(p);
  }, []);

  return (
    <ThemeContext.Provider value={{ pref, setPref }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemePref() {
  return useContext(ThemeContext);
}
