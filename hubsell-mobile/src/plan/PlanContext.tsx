import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { setOnPlanLocked } from "@/api/client";
import { fetchMyPlan } from "@/api/subscription";
import { useAuth } from "@/auth/AuthContext";
import type { MyPlanResponse } from "@/types/api";

/**
 * TRẠNG THÁI GÓI dùng chung toàn app (08/10) — một nguồn cho dải nhắc gia hạn
 * ở Trang chủ, dòng gói ở Tài khoản và thẻ khóa của các màn tầng nâng cao;
 * cùng vai với qk.mySubscription (React Query) trên web.
 *
 * Khối BỊ ĐỘNG: lỗi mạng / 403 thì giữ dữ liệu cũ hoặc null — không bao giờ
 * kéo cả app sang màn lỗi. Tải lại khi: đăng nhập, app quay lại foreground,
 * mỗi 5 phút, và NGAY khi có API trả 403 PLAN_LOCKED (client.ts bắn tín hiệu).
 */
const REFRESH_MS = 5 * 60 * 1000;

interface PlanContextValue {
  plan: MyPlanResponse | null;
  /** Tải lại ngay (sau khi khách bấm "Đã gia hạn, tải lại"). */
  refresh: () => Promise<void>;
}

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const [plan, setPlan] = useState<MyPlanResponse | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    try {
      const res = await fetchMyPlan();
      if (my === seq.current) setPlan(res);
    } catch {
      // giữ bản cũ — dải nhắc có thể trễ một nhịp, không được che màn
    }
  }, []);

  useEffect(() => {
    if (status !== "signedIn") {
      seq.current++; // lượt tải đang bay của phiên cũ không được ghi vào phiên mới
      return;
    }
    // Tải lần đầu khi vừa đăng nhập — cùng mẫu load("first") của các màn (baseline lint).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, REFRESH_MS);
    setOnPlanLocked(() => void refresh());
    return () => {
      sub.remove();
      clearInterval(timer);
      setOnPlanLocked(null);
    };
  }, [status, refresh]);

  // Đăng xuất → coi như chưa có gói (không setState trong effect — react-compiler).
  const visible = status === "signedIn" ? plan : null;
  const value = useMemo(() => ({ plan: visible, refresh }), [visible, refresh]);
  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlan phải nằm trong <PlanProvider>");
  return ctx;
}
