import type { MyPlanResponse } from "@/types/api";

/**
 * MỘT BẢN DỰNG, HAI NỀN TẢNG CÙNG HÀNH VI (anh Trung 08/10) — lấy luật khắt
 * khe hơn làm chuẩn chung, không rẽ nhánh theo Platform:
 * - Apple 3.1.3(f): app miễn phí đi kèm công cụ web trả phí được miễn IAP với
 *   điều kiện không mua trong app và KHÔNG có lời mời mua ở ngoài; Apple đã
 *   từ chối 06/10 chỉ vì thấy "gói · dùng thử · còn N ngày".
 * - Google Play Payments mục 4: không dẫn tới cách thanh toán khác qua link /
 *   nút / chữ / luồng UI.
 * → App KHÔNG nhắc gói, dùng thử, giá, gia hạn, nâng gói, nơi mua. Dải nhắc
 *   chỉ nêu SỰ KIỆN kỹ thuật: tính năng nâng cao tạm khóa từ ngày nào, đơn vẫn
 *   đồng bộ, liên hệ quản trị viên shop. Nhắc "sắp hết hạn" chỉ cho thuê bao
 *   ĐÃ TRẢ TIỀN (khách mua trên web rồi); tài khoản dùng thử không nhắc trước —
 *   người duyệt store luôn dùng tài khoản dùng thử.
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
const CONTACT_ADMIN = "Liên hệ quản trị viên shop để được hỗ trợ.";

export function planBannerOf(data: MyPlanResponse | null): PlanBannerContent | null {
  if (!data || !data.hasSubscription || data.exempt || !data.plan) return null;
  const month = monthKeyNow();
  const { orders, subscription, expiry } = data;
  const usedOfLimit =
    orders.limit != null ? ` (${nf.format(orders.used)}/${nf.format(orders.limit)} đơn)` : "";

  // Ưu tiên theo độ nặng (chép bannerContentOf web): khóa > hết hạn > vượt trần > 80% > sắp hết hạn.
  if (data.locked) {
    return {
      key: `${month}:locked`,
      tone: "red",
      lead: "Một số tính năng nâng cao đang tạm khóa",
      detail: `${STILL_SYNCING} ${CONTACT_ADMIN}`,
      dismissible: false,
    };
  }
  if (expiry.expired) {
    return {
      key: `${month}:expired`,
      tone: "red",
      lead: expiry.lockDeadline
        ? `Tính năng nâng cao sẽ tạm khóa từ ngày ${fmtDate(expiry.lockDeadline)}`
        : "Tính năng nâng cao sắp tạm khóa",
      detail: `${STILL_SYNCING} ${CONTACT_ADMIN}`,
      dismissible: false,
    };
  }
  if (orders.state === "over") {
    return {
      key: `${month}:over`,
      tone: "red",
      lead: `Đã vượt hạn mức đơn tháng này${usedOfLimit}`,
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
      lead: `Đã dùng ${Math.floor((orders.ratio ?? 0) * 100)}% hạn mức đơn tháng này${usedOfLimit}`,
      detail: `Vượt hạn mức thì tính năng nâng cao tạm khóa sau 7 ngày. ${STILL_SYNCING}`,
      dismissible: true,
    };
  }
  if (
    subscription &&
    !subscription.isTrial &&
    subscription.status === "ACTIVE" &&
    subscription.daysLeft !== null &&
    subscription.daysLeft <= 3 &&
    subscription.currentPeriodEnd
  ) {
    return {
      key: `expiring:${subscription.currentPeriodEnd}`,
      tone: "amber",
      lead: `Kỳ dịch vụ hiện tại kết thúc ngày ${fmtDate(subscription.currentPeriodEnd)}`,
      detail: `Sau đó tính năng nâng cao tạm khóa sau 7 ngày. ${STILL_SYNCING}`,
      dismissible: true,
    };
  }
  return null;
}
