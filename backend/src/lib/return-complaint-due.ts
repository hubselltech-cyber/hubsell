// ============================================================
// HẠN KHIẾU NẠI ĐƠN HOÀN (23/11/2026) — docs/HAN-KHIEU-NAI-DON-HOAN.md
// HÀM THUẦN: không gọi database, không gọi mạng, không đọc đồng hồ.
//
// Anh Trung: "thời gian khiếu nại bắt đầu khi nào, kết thúc khi nào là điều quan trọng nhất
// để nhắc khách". Hai nguồn hạn, theo thứ tự tin cậy:
//
//   1. HẠN SÀN TRẢ nguyên văn — lưu ở Order.returnComplaintDueAt, lượt đồng bộ yêu cầu hoàn
//      ghi (0 call sàn thêm):
//        · Shopee `return_seller_due_date` của get_return_list. Payload thật 23/11 (66 yêu cầu
//          của một gian): khách chưa gửi → 0; kiện trên đường → hạn TẠM, 11 / 11 rơi vào
//          23:59:59 giờ VN (sàn tính theo ngày nhận hàng hoàn dự kiến); kiện đã về → đúng
//          update_time + 48,0 giờ (13 / 13) và giữ nguyên sau khi yêu cầu đóng.
//        · TikTok hạn SELLER_RESPOND_RECEIVE_PACKAGE khi kiện đã về shop = update_time + 48 giờ
//          (6 / 6 mẫu, tiktok/returns-sync.ts). Kiện còn trên đường thì hạn đó là "khách gửi +
//          14 ngày" — KHÔNG phải hạn khiếu nại, không lưu.
//   2. TÍNH THEO LUẬT khi sàn không cho hạn (Lazada, kiện giao thất bại, đơn có từ trước
//      23/11): mốc kiện về + số giờ trong COMPLAINT_WINDOW_HOURS. Mốc kiện về là mốc sàn báo
//      ("rule") hoặc, thiếu thì lùi về giờ kho quét ("estimate") — giờ kho quét luôn MUỘN hơn
//      giờ kiện về thật nên hạn ước tính muộn hơn hạn sàn: giao diện phải ghi rõ chữ "ước tính".
//
// Số giờ của bảng luật = quy định đọc trên trang chính thức ngày 23/11/2026 (mục 1 tài liệu):
// kiện khách trả về tới shop cả 3 sàn 2 ngày; kiện giao thất bại Shopee 7 ngày, Lazada 7 ngày,
// TikTok tối đa 40 ngày. Lazada không ghi ngày lịch hay ngày làm việc → tính ngày lịch (hạn sớm
// hơn = an toàn hơn). Sàn đổi quy định → sửa MỘT chỗ này.
// ============================================================

import { ReturnStatus } from "@prisma/client";
import { returnShippingOf } from "./return-shipping";

const HOUR_MS = 3_600_000;
const VN_OFFSET_SEC = 7 * 3600;

/** Số GIỜ được khiếu nại kể từ lúc kiện về tới shop, theo sàn và loại hoàn. */
export const COMPLAINT_WINDOW_HOURS: Record<string, { buyerReturn: number; failedDelivery: number }> = {
  SHOPEE: { buyerReturn: 48, failedDelivery: 7 * 24 },
  TIKTOK: { buyerReturn: 48, failedDelivery: 40 * 24 },
  LAZADA: { buyerReturn: 48, failedDelivery: 7 * 24 },
};

/** Mốc (giây) rơi đúng 23:59:59 giờ Việt Nam — dấu hiệu hạn TẠM của Shopee. */
export function isEndOfDayVn(sec: number): boolean {
  return Number.isFinite(sec) && sec > 0 && (Math.floor(sec) + VN_OFFSET_SEC) % 86_400 === 86_399;
}

/** Hạn sàn trả đang lưu trên đơn. */
export interface StoredComplaintDue {
  returnComplaintDueAt: Date | null;
  returnComplaintDueProvisional: boolean;
}

/** Phần cần GHI vào Order — rỗng khi không có gì đổi (idempotent). */
export interface ComplaintDuePatch {
  returnComplaintDueAt?: Date | null;
  returnComplaintDueProvisional?: boolean;
}

/**
 * So hạn mới đọc từ sàn với hạn đang lưu, trả về đúng phần phải ghi.
 *   next = { dueAt, provisional } → ghi nếu khác;
 *   next = null                    → XÓA hạn (yêu cầu hoàn đã hủy / khách giữ hàng);
 *   next = "keep"                  → sàn lượt này không cho hạn, giữ cái đang lưu.
 */
export function complaintDuePatch(
  next: { dueAt: Date; provisional: boolean } | null | "keep",
  stored: Partial<StoredComplaintDue>
): ComplaintDuePatch {
  if (next === "keep") return {};
  const storedAt = stored.returnComplaintDueAt ?? null;
  const storedProvisional = stored.returnComplaintDueProvisional ?? false;
  const patch: ComplaintDuePatch = {};
  if (next === null) {
    if (storedAt !== null) patch.returnComplaintDueAt = null;
    if (storedProvisional) patch.returnComplaintDueProvisional = false;
    return patch;
  }
  if (storedAt?.getTime() !== next.dueAt.getTime()) patch.returnComplaintDueAt = next.dueAt;
  if (storedProvisional !== next.provisional) patch.returnComplaintDueProvisional = next.provisional;
  return patch;
}

/**
 * Hạn khiếu nại từ `return_seller_due_date` (giây) của MỘT yêu cầu trả hàng Shopee còn sống.
 * Sàn trả 0 / trống (khách chưa gửi hàng): hạn TẠM đang lưu thì xóa, hạn đã chốt thì giữ.
 */
export function shopeeSellerDue(
  sellerDueSec: unknown,
  stored: Partial<StoredComplaintDue>
): { dueAt: Date; provisional: boolean } | null | "keep" {
  const sec = Number(sellerDueSec ?? 0);
  if (!(sec > 0)) {
    return stored.returnComplaintDueAt && stored.returnComplaintDueProvisional ? null : "keep";
  }
  return { dueAt: new Date(sec * 1000), provisional: isEndOfDayVn(sec) };
}

// ───────── Hạn để HIỆN (lát giao diện đọc) ─────────

export type ComplaintDueSource =
  /** Sàn trả, đã chốt (kiện đã về). */
  | "platform"
  /** Sàn trả, hạn tạm theo ngày nhận hàng hoàn dự kiến (Shopee, kiện còn trên đường). */
  | "platform_provisional"
  /** Tính theo luật từ mốc SÀN báo kiện về. */
  | "rule"
  /** Tính theo luật từ giờ KHO quét — hạn sàn có thể sớm hơn. */
  | "estimate";

export type ComplaintDue =
  /** Không phải đơn hoàn, hoặc ca đã đóng (nhập kho nguyên vẹn / đã đền bù / đã xóa sổ). */
  | { state: "NOT_NEEDED" }
  /** Kiện chưa về và sàn chưa cho hạn — hạn chưa bắt đầu tính. */
  | { state: "NOT_STARTED"; failedDelivery: boolean }
  /** Không đủ căn cứ (sàn không có luật, hoặc kiện đã về mà không có mốc giờ nào). */
  | { state: "UNKNOWN"; failedDelivery: boolean }
  | {
      state: "DUE";
      dueAt: Date;
      source: ComplaintDueSource;
      failedDelivery: boolean;
      /** Số giờ của luật đã dùng — null khi hạn do sàn trả. */
      windowHours: number | null;
    };

export interface ComplaintDueOrder extends StoredComplaintDue {
  /** Tên sàn của gian (Channel.channelName). */
  platform: string;
  returnStatus: ReturnStatus;
  returnedAt: Date | null;
  returnDeliveredAt: Date | null;
  platformReturnStatus: string | null;
  returnTrackingCode: string | null;
}

/** Ca hoàn đã đóng — không còn gì để khiếu nại. */
function caseClosed(status: ReturnStatus): boolean {
  return (
    status === ReturnStatus.NONE ||
    status === ReturnStatus.RECEIVED_INTACT ||
    status === ReturnStatus.CLAIM_SETTLED ||
    status === ReturnStatus.WRITTEN_OFF
  );
}

/** Hạn khiếu nại của một đơn hoàn: hạn sàn trả trước, thiếu thì tính theo luật. */
export function complaintDueOf(order: ComplaintDueOrder): ComplaintDue {
  if (caseClosed(order.returnStatus)) return { state: "NOT_NEEDED" };

  const ship = returnShippingOf(order);
  const failedDelivery = ship.failedDelivery;

  if (order.returnComplaintDueAt) {
    return {
      state: "DUE",
      dueAt: order.returnComplaintDueAt,
      source: order.returnComplaintDueProvisional ? "platform_provisional" : "platform",
      failedDelivery,
      windowHours: null,
    };
  }

  if (ship.state !== "RETURNED") return { state: "NOT_STARTED", failedDelivery };

  const rule = COMPLAINT_WINDOW_HOURS[(order.platform ?? "").toUpperCase()];
  if (!rule || !ship.at) return { state: "UNKNOWN", failedDelivery };
  const windowHours = failedDelivery ? rule.failedDelivery : rule.buyerReturn;
  return {
    state: "DUE",
    dueAt: new Date(ship.at.getTime() + windowHours * HOUR_MS),
    source: ship.source === "platform" ? "rule" : "estimate",
    failedDelivery,
    windowHours,
  };
}

// ───────── Dạng gửi giao diện + mốc "sắp hết hạn" (dùng chung: tab Đơn hoàn + Đối soát đơn hoàn) ─────────

/**
 * "Sắp hết hạn khiếu nại" = còn hạn và còn ≤ 24 giờ — cùng mốc tô đỏ của ô hạn, cùng mốc chuông lát 3.
 * Mặc định tự chọn (chưa tới một ngày làm việc của kho), chưa có số đo.
 */
export const COMPLAINT_DUE_SOON_HOURS = 24;

/** Hạn khiếu nại gửi giao diện — `complaintDueOf` dạng JSON. */
export type ComplaintDueView =
  | { state: "NOT_NEEDED" | "NOT_STARTED" | "UNKNOWN"; failedDelivery: boolean }
  | {
      state: "DUE";
      dueAt: string;
      source: ComplaintDueSource;
      failedDelivery: boolean;
      windowHours: number | null;
    };

export function complaintDueView(d: ComplaintDue): ComplaintDueView {
  if (d.state === "DUE") {
    return {
      state: "DUE",
      dueAt: d.dueAt.toISOString(),
      source: d.source,
      failedDelivery: d.failedDelivery,
      windowHours: d.windowHours,
    };
  }
  return { state: d.state, failedDelivery: d.state === "NOT_NEEDED" ? false : d.failedDelivery };
}
