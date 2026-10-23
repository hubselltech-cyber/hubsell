import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { addBeforeSignOut, useAuth } from "@/auth/AuthContext";
import * as storage from "@/auth/storage";
import {
  fetchNotifications,
  markNotificationsRead,
  registerPushDevice,
  unregisterPushDevice,
} from "@/api/notifications";
import type { AppNotification } from "@/types/api";
import { hrefForNotificationLink } from "@/lib/notification-links";

/**
 * CHUÔNG THÔNG BÁO + PUSH của app (23/10/2026) — một nguồn cho cả khu chủ shop:
 *   · Danh sách + số chưa đọc từ /api/notifications (cùng bảng với chuông web).
 *     Không có SSE trên app: đọc lại khi mở màn / app về foreground / mỗi 60 s;
 *     tin mới tới NGAY qua push nên nhịp 60 s chỉ là lưới an toàn.
 *   · Push: xin quyền một lần sau khi đăng nhập, lấy Expo push token, gửi lên
 *     backend (POST /devices); đăng xuất thì gỡ (DELETE /devices) để máy không
 *     còn nhận tin của tài khoản cũ. Khách tắt công tắc "trên máy này" → nhớ
 *     trong SecureStore, lần mở sau không xin lại.
 *   · Bấm thông báo (app đang mở hay đóng) → đổi link web thành màn app.
 * Android: push cần Firebase (google-services.json + FCM V1 trên EAS). Bản dựng
 * chưa có thì getExpoPushTokenAsync ném lỗi → trạng thái "error", chuông vẫn
 * chạy bằng REST — app không vỡ.
 */

const PUSH_TOKEN_KEY = "hubsell.pushToken";
/** Khách tắt công tắc push trên máy này (giữ qua các lần mở app). */
const PUSH_OPT_OUT_KEY = "hubsell.pushOptOut";
const POLL_MS = 60_000;
const PAGE = 30;

export type PushStatus =
  | "unsupported" // web / máy ảo không có dịch vụ push
  | "off" // chưa bật (chưa xin quyền hoặc khách tắt trên máy này)
  | "denied" // hệ điều hành từ chối — phải mở Cài đặt điện thoại
  | "error" // không lấy được token (thiếu cấu hình Firebase…)
  | "on";

export interface PushState {
  status: PushStatus;
  error?: string;
  /** build = bản dựng thiếu Firebase (không sửa được tại chỗ); server = backend chưa nhận, gạt lại để thử. */
  errorKind?: "build" | "server";
}

interface NotificationsValue {
  items: AppNotification[];
  unread: number;
  loading: boolean;
  hasMore: boolean;
  /** Tải lại từ đầu; silent = không bật cờ loading (poll nền). */
  refresh: (silent?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  /** Mở màn Thông báo = đã liếc toàn bộ (như chuông web): badge về 0 ngay. */
  markAllRead: () => void;
  /** Bấm một dòng: điều hướng tới màn tương ứng (nếu có). Trả false khi không có màn. */
  open: (n: AppNotification) => boolean;
  push: PushState;
  enablePush: () => Promise<void>;
  disablePush: () => Promise<void>;
}

const Ctx = createContext<NotificationsValue | null>(null);

// Cách hệ điều hành hiện tin khi app ĐANG MỞ: vẫn hiện banner + tiếng (chủ shop
// đang xem Tài chính mà có đơn hỏa tốc thì phải thấy). Chỉ native.
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

function permissionGranted(p: Notifications.NotificationPermissionsStatus): boolean {
  if (p.granted) return true;
  const ios = p.ios?.status;
  return (
    ios === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    ios === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  // Android 13+: phải có kênh TRƯỚC khi xin quyền, không thì hộp xin quyền không hiện.
  await Notifications.setNotificationChannelAsync("default", {
    name: "Thông báo Hubsell",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#10b981",
  });
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user, status: authStatus } = useAuth();
  const router = useRouter();
  const isOwner = authStatus === "signedIn" && user?.role === "ADMIN";

  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [push, setPush] = useState<PushState>({
    status: Platform.OS === "web" ? "unsupported" : "off",
  });
  const tokenRef = useRef<string | null>(null);
  const reqSeq = useRef(0);

  // ───────────── danh sách ─────────────
  const refresh = useCallback(
    async (silent = false) => {
      if (!isOwner) return;
      const seq = ++reqSeq.current;
      if (!silent) setLoading(true);
      try {
        const res = await fetchNotifications();
        if (seq !== reqSeq.current) return;
        setItems(res.items);
        setUnread(res.unread);
        setHasMore(res.hasMore);
        if (Platform.OS === "ios") void Notifications.setBadgeCountAsync(res.unread).catch(() => {});
      } catch {
        // poll nền hỏng thì giữ danh sách cũ; lần sau tự đúng lại
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    },
    [isOwner]
  );

  const loadMore = useCallback(async () => {
    if (!isOwner || !hasMore || items.length === 0) return;
    const last = items[items.length - 1];
    try {
      const res = await fetchNotifications(last.createdAt);
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...res.items.filter((n) => !seen.has(n.id))];
      });
      setHasMore(res.items.length === PAGE);
    } catch {
      // cuộn tiếp lỗi: để nguyên, kéo lại sau
    }
  }, [isOwner, hasMore, items]);

  const markAllRead = useCallback(() => {
    if (unread === 0) return;
    setUnread(0);
    if (Platform.OS === "ios") void Notifications.setBadgeCountAsync(0).catch(() => {});
    markNotificationsRead().catch(() => {
      // lỗi mạng: badge tự đúng lại ở lần refresh sau
    });
  }, [unread]);

  const open = useCallback(
    (n: AppNotification): boolean => {
      if (!n.readAt) {
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
        markNotificationsRead([n.id]).catch(() => {});
      }
      const href = hrefForNotificationLink(n.link);
      if (!href) return false;
      router.navigate(href);
      return true;
    },
    [router]
  );

  // Nạp lần đầu + về foreground + 60 s một lần (chỉ khi app đang mở).
  useEffect(() => {
    if (!isOwner) {
      setItems([]);
      setUnread(0);
      return;
    }
    void refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh(true);
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh(true);
    }, POLL_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [isOwner, refresh]);

  // ───────────── push ─────────────
  const registerToken = useCallback(async () => {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await registerPushDevice({
      token,
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version ?? undefined,
      deviceName: Device.modelName,
    });
    tokenRef.current = token;
    await storage.setItem(PUSH_TOKEN_KEY, token);
    setPush({ status: "on" });
  }, []);

  /** interactive = được phép hiện hộp xin quyền của hệ điều hành. */
  const ensurePush = useCallback(
    async (interactive: boolean) => {
      if (Platform.OS === "web" || !Device.isDevice) {
        setPush({ status: "unsupported" });
        return;
      }
      try {
        await ensureAndroidChannel();
        let perm = await Notifications.getPermissionsAsync();
        if (!permissionGranted(perm)) {
          if (!interactive) {
            setPush({ status: perm.canAskAgain === false ? "denied" : "off" });
            return;
          }
          perm = await Notifications.requestPermissionsAsync();
          if (!permissionGranted(perm)) {
            setPush({ status: perm.canAskAgain === false ? "denied" : "off" });
            return;
          }
        }
        await registerToken();
      } catch (err) {
        // Thiếu Firebase trên Android (lỗi "FirebaseApp") / backend chưa có route
        // hoặc rớt mạng lúc đăng ký — chuông REST vẫn chạy; lỗi máy chủ cho gạt lại.
        const msg = err instanceof Error ? err.message : String(err);
        const build = /firebase|fcm|google-services/i.test(msg);
        setPush({ status: "error", error: msg, errorKind: build ? "build" : "server" });
      }
    },
    [registerToken]
  );

  // Sau khi đăng nhập: xin quyền một lần (trừ khi khách đã tắt trên máy này).
  useEffect(() => {
    if (!isOwner || Platform.OS === "web") return;
    let cancelled = false;
    (async () => {
      const optOut = await storage.getItem(PUSH_OPT_OUT_KEY);
      if (cancelled) return;
      if (optOut === "1") {
        setPush({ status: "off" });
        return;
      }
      await ensurePush(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, ensurePush]);

  const enablePush = useCallback(async () => {
    await storage.deleteItem(PUSH_OPT_OUT_KEY);
    await ensurePush(true);
  }, [ensurePush]);

  const disablePush = useCallback(async () => {
    await storage.setItem(PUSH_OPT_OUT_KEY, "1");
    const token = tokenRef.current ?? (await storage.getItem(PUSH_TOKEN_KEY));
    tokenRef.current = null;
    await storage.deleteItem(PUSH_TOKEN_KEY);
    if (token) await unregisterPushDevice(token).catch(() => {});
    setPush({ status: "off" });
  }, []);

  // Đăng xuất: gỡ token TRƯỚC khi phiên bị xóa (còn Bearer để gọi DELETE).
  useEffect(() => {
    return addBeforeSignOut(async () => {
      const token = tokenRef.current ?? (await storage.getItem(PUSH_TOKEN_KEY));
      tokenRef.current = null;
      await storage.deleteItem(PUSH_TOKEN_KEY);
      if (token) await unregisterPushDevice(token).catch(() => {});
    });
  }, []);

  // Tin tới khi app đang mở → làm tươi danh sách (badge chuông nhảy ngay).
  useEffect(() => {
    if (Platform.OS === "web" || !isOwner) return;
    const sub = Notifications.addNotificationReceivedListener(() => void refresh(true));
    return () => sub.remove();
  }, [isOwner, refresh]);

  // Bấm vào thông báo (app đang mở, ở nền, hay mở từ đầu) → tới màn tương ứng.
  // Dùng listener + getLastNotificationResponseAsync thay hook useLastNotificationResponse
  // (hook không có trên web → giả lập web vỡ ngay lúc mount).
  const handledResponse = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS === "web" || !isOwner) return;
    const handle = (resp: Notifications.NotificationResponse) => {
      const id = resp.notification.request.identifier;
      if (handledResponse.current === id) return;
      handledResponse.current = id;
      const data = resp.notification.request.content.data as { link?: string | null } | null;
      const href = hrefForNotificationLink(data?.link ?? null);
      void refresh(true);
      if (href) router.navigate(href);
      else router.navigate("/notifications");
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    // Mở app từ thông báo khi app đang đóng hẳn.
    void Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (r) handle(r);
      })
      .catch(() => {});
    return () => sub.remove();
  }, [isOwner, router, refresh]);

  const value = useMemo<NotificationsValue>(
    () => ({ items, unread, loading, hasMore, refresh, loadMore, markAllRead, open, push, enablePush, disablePush }),
    [items, unread, loading, hasMore, refresh, loadMore, markAllRead, open, push, enablePush, disablePush]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications(): NotificationsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNotifications phải nằm trong NotificationsProvider");
  return v;
}
