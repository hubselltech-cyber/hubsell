import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useAuth } from "./AuthContext";
import * as storage from "./storage";

/**
 * KHÓA APP BẰNG SINH TRẮC HỌC (Face ID / vân tay) — bật trong Cấu hình.
 * App chứa số liệu tiền bạc nên khóa kiểu app ngân hàng: mở app hoặc quay lại
 * từ nền là phải xác thực; token vẫn nằm yên trong SecureStore, đây là lớp
 * chắn HIỂN THỊ chứ không thay thế đăng nhập.
 * Web-sim không có sinh trắc học — gate tự tắt.
 */

const BIO_LOCK_KEY = "hubsell.bioLock";

const BioContext = createContext<{
  /** null = máy không hỗ trợ hoặc chưa đăng ký sinh trắc học. */
  supported: boolean;
  enabled: boolean;
  setEnabled: (on: boolean) => Promise<boolean>;
}>({ supported: false, enabled: false, setEnabled: async () => false });

export function useBiometricLock() {
  return useContext(BioContext);
}

async function checkSupported(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const [hw, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hw && enrolled;
  } catch {
    return false;
  }
}

async function authenticate(): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: "Mở khóa Hubsell",
      cancelLabel: "Hủy",
    });
    return res.success;
  } catch {
    return false;
  }
}

export function BiometricGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const authing = useRef(false);

  useEffect(() => {
    void (async () => {
      const [sup, flag] = await Promise.all([
        checkSupported(),
        storage.getItem(BIO_LOCK_KEY),
      ]);
      setSupported(sup);
      const on = sup && flag === "1";
      setEnabledState(on);
      setLocked(on);
      setReady(true);
    })();
  }, []);

  // Ra nền là khóa lại — quay vào phải xác thực như app ngân hàng
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") setLocked(true);
    });
    return () => sub.remove();
  }, [enabled]);

  const tryUnlock = useCallback(async () => {
    if (authing.current) return;
    authing.current = true;
    const ok = await authenticate();
    authing.current = false;
    if (ok) setLocked(false);
  }, []);

  // Đang khóa + đã đăng nhập → tự bật prompt ngay, khỏi bắt bấm thêm nút
  useEffect(() => {
    if (ready && locked && enabled && status === "signedIn") void tryUnlock();
  }, [ready, locked, enabled, status, tryUnlock]);

  const setEnabled = useCallback(async (on: boolean): Promise<boolean> => {
    // Bật/tắt đều phải xác thực đã — chống người khác cầm máy tự tắt khóa
    const ok = await authenticate();
    if (!ok) return false;
    setEnabledState(on);
    if (on) await storage.setItem(BIO_LOCK_KEY, "1");
    else await storage.deleteItem(BIO_LOCK_KEY);
    return true;
  }, []);

  const showLock = ready && enabled && locked && status === "signedIn";

  return (
    <BioContext.Provider value={{ supported, enabled, setEnabled }}>
      {children}
      {showLock ? (
        <View className="absolute inset-0 items-center justify-center bg-slate-50 dark:bg-slate-950">
          {/* Bo góc + viền mảnh kiểu app icon — PNG nền trắng vuông */}
          <Image
            source={require("@/assets/images/logo-hubsell.png")}
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: "#e2e8f0",
            }}
            contentFit="contain"
          />
          <Text className="mt-4 text-base font-bold text-slate-900 dark:text-slate-100">
            Hubsell đang khóa
          </Text>
          <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Xác thực để xem số liệu bán hàng của bạn
          </Text>
          <Pressable
            className="mt-6 flex-row items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 active:opacity-80 dark:bg-slate-700"
            onPress={() => void tryUnlock()}
          >
            <Ionicons name="finger-print" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white">Mở khóa</Text>
          </Pressable>
        </View>
      ) : null}
    </BioContext.Provider>
  );
}
