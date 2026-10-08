import { Platform } from "react-native";
import type { MyPlanResponse } from "@/types/api";

/**
 * LUẬT STORE (docs/DUA-APP-LEN-CH-PLAY-APP-STORE.md + client.ts 06/10): app
 * KHÔNG bán gói, KHÔNG có nút/link dẫn ra nơi thanh toán, KHÔNG kêu gọi "gia
 * hạn / nâng gói". Apple còn từ chối 3.1.1 (06/10) chỉ vì màn Tài khoản hiện
 * "gói · dùng thử · còn N ngày" → iOS giấu hẳn mọi thông tin gói (cùng cờ với
 * dòng gói ở Tài khoản). Android: dải nhắc chỉ NÊU SỰ KIỆN (hết hạn ngày nào,
 * tính năng nâng cao tạm khóa từ ngày nào, đơn vẫn đồng bộ) — như dòng
 * "Hết hạn dd/mm · còn N ngày" đã có ở Tài khoản, không thêm lời mời mua.
 */
export const PLAN_INFO_VISIBLE = Platform.OS !== "ios";

/**
 * Nội dung dải nhắc gói — chép luật ưu tiên của bannerContentOf trên web
 * (plan-quota-guard.tsx): khóa > hết hạn > vượt trần > 80% > sắp hết hạn.
 * Mức đỏ KHÔNG tắt được (chủ đích); mức vàng tắt được theo khóa (nhớ trên máy).
 */
export interface PlanBannerContent {
  key: string;
  tone: "red" | "amber";
  lead: string;
  detail: string;
  dismissible: boolean;
}

const nf = new Intl.NumberFormat("vi-VN");

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function monthKeyNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const STILL_SYNCING = "Đơn hàng và tồn kho vẫn được đồng bộ đầy đủ.";

export function planBannerOf(data: MyPlanResponse | null): PlanBannerContent | null {
  if (!data || !data.hasSubscription || data.exempt || !data.plan) return null;
  const month = monthKeyNow();
  const planName = data.plan.name;
  const { orders, subscription, expiry } = data;
  const usedOfLimit =
    orders.limit != null ? ` (${nf.format(orders.used)}/${nf.format(orders.limit)} đơn)` : "";

  if (data.locked && data.lockedReason === "EXPIRED") {
    return {
      key: `${month}:locked-expired`,
      tone: "red",
      lead: `Gói ${planName} đã hết hạn — tính năng nâng cao đang tạm khóa`,
      detail: STILL_SYNCING,
      dismissible: false,
    };
  }
  if (data.locked) {
    return {
      key: `${month}:locked-orders`,
      tone: "red",
      lead: `Đã vượt trần đơn của gói ${planName}${usedOfLimit} — tính năng nâng cao tạm khóa`,
      detail: STILL_SYNCING,
      dismissible: false,
    };
  }
  if (expiry.expired) {
    return {
      key: `${month}:expired`,
      tone: "red",
      lead: `Gói ${planName}${subscription?.isTrial ? " (dùng thử)" : ""} đã hết hạn`,
      detail: expiry.lockDeadline
        ? `Tính năng nâng cao sẽ tạm khóa từ ngày ${fmtDate(expiry.lockDeadline)}. ${STILL_SYNCING}`
        : STILL_SYNCING,
      dismissible: false,
    };
  }
  if (orders.state === "over") {
    return {
      key: `${month}:over`,
      tone: "red",
      lead: `Đã vượt trần đơn tháng này của gói ${planName}${usedOfLimit}`,
      detail: orders.graceDeadline
        ? `Tính năng nâng cao sẽ tạm khóa từ ngày ${fmtDate(orders.graceDeadline)}. ${STILL_SYNCING}`
        : STILL_SYNCING,
      dismissible: false,
    };
  }
  if (orders.state === "warn") {
    return {
      key: `${month}:warn`,
      tone: "amber",
      lead: `Đã dùng ${Math.floor((orders.ratio ?? 0) * 100)}% trần đơn tháng này${usedOfLimit}`,
      detail: `Vượt trần thì tính năng nâng cao tạm khóa sau 7 ngày ân hạn. ${STILL_SYNCING}`,
      dismissible: true,
    };
  }
  if (
    subscription &&
    subscription.status === "ACTIVE" &&
    subscription.daysLeft !== null &&
    subscription.daysLeft <= 3 &&
    subscription.currentPeriodEnd
  ) {
    return {
      key: `expiring:${subscription.currentPeriodEnd}`,
      tone: "amber",
      lead: `Gói ${planName}${subscription.isTrial ? " (dùng thử)" : ""} hết hạn ngày ${fmtDate(subscription.currentPeriodEnd)}`,
      detail: `Sau đó tính năng nâng cao tạm khóa sau 7 ngày ân hạn. ${STILL_SYNCING}`,
      dismissible: true,
    };
  }
  return null;
}
