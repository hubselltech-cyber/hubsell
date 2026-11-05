// ============================================================
// KẾ HOẠCH MỘT LƯỢT KÉO DANH MỤC: TOÀN BỘ hay TĂNG DẦN (lát 3.9 GĐ3, 05/11/2026)
//
// Anh Trung 03/11: "Lúc khách liên kết shop thì đã kéo sản phẩm và đơn hàng về rồi. Nếu
// như mỗi lần kéo lại phải kéo lại hết thì đúng là quá gãy thật." (Hy Korea Official,
// Shopee: 38.889 dòng, +0 mới, 38.889 cập nhật, khoảng 19 phút mỗi lượt.)
//
// Phần THUẦN — không đụng DB, không gọi sàn. Luật:
//   · Gian chưa có mốc (mới nối, hoặc nối trước khi có cột) → kéo toàn bộ.
//   · Có mốc → lượt tăng dần đọc sản phẩm sàn báo đổi từ (mốc − CATALOG_OVERLAP_MS).
//   · Mốc = thời điểm BẮT ĐẦU của lượt đọc đủ gần nhất; chỉ tiến khi lượt đó đọc đủ
//     (`nextCatalogMarks`). Lượt cắt giữa chừng / lỗi giữ nguyên mốc → lượt sau đọc lại.
//   · Lượt kéo toàn bộ thưa: quá `fullSyncIntervalMs` (7–9 ngày theo gian) thì lượt ĐÊM kéo
//     toàn bộ — chỉ lượt đó (và đọc đủ) mới được đánh DELISTED sản phẩm vắng mặt. Nút bấm
//     của khách luôn tăng dần cho nhanh, trừ khi đã quá 2 nhịp chưa có lượt toàn bộ nào.
//
// Mở dần (khẩu vị 18/10 "mã mới chạy bóng theo cờ gian, so khớp rồi mới mở"):
//   PRODUCT_SYNC_INCREMENTAL = off | shadow (mặc định) | on
//   PRODUCT_SYNC_INCREMENTAL_CHANNELS = id gian, cách nhau dấu phẩy → riêng các gian đó "on"
//   · shadow: vẫn kéo toàn bộ như cũ (đã chỉ ghi dòng khác biệt), nhưng ĐO xem lượt tăng dần
//     nếu chạy thì sót dòng nào (dòng đổi mà sàn không báo đổi trong cửa sổ) → log đối chiếu.
//   · on: chạy tăng dần thật; lượt toàn bộ định kỳ vẫn đo đối chiếu y như shadow.
// ============================================================

/**
 * Khoảng chồng lấn lùi từ mốc. SỐ TỰ CHỌN: gấp đôi 30 phút của mốc nước đơn (lát 3.2) vì
 * chưa đo độ trễ chỉ mục tìm sản phẩm của sàn; lệch đồng hồ máy ta ↔ sàn cũng nằm trong đây.
 * Đọc thừa một giờ sản phẩm đổi gần như không tốn gì.
 */
export const CATALOG_OVERLAP_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Nhịp kéo toàn bộ. SỐ TỰ CHỌN (chưa có số đo tần suất khách gỡ sản phẩm); chỉnh bằng PRODUCT_FULL_SYNC_DAYS. */
export const FULL_SYNC_DAYS_DEFAULT = 7;
/** Rải thêm 0–2 ngày theo id gian để các gian không dồn lượt toàn bộ vào cùng một đêm. */
const FULL_SYNC_JITTER_MS = 2 * DAY_MS;

export type IncrementalSetting = "off" | "shadow" | "on";

type Env = Record<string, string | undefined>;

/** Cờ mở tăng dần cho một gian — đọc env mỗi lần gọi (đổi env + khởi động lại là áp). */
export function incrementalSettingFor(channelId: string, env: Env = process.env): IncrementalSetting {
  const listed = (env.PRODUCT_SYNC_INCREMENTAL_CHANNELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (listed.includes(channelId)) return "on";
  const raw = (env.PRODUCT_SYNC_INCREMENTAL ?? "").trim().toLowerCase();
  if (raw === "on" || raw === "off") return raw;
  return "shadow";
}

/** Băm chuỗi ổn định (FNV-1a 32 bit) — chỉ để rải nhịp, không phải bảo mật. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Nhịp kéo toàn bộ của một gian: N ngày + 0–2 ngày rải theo id gian. */
export function fullSyncIntervalMs(channelId: string, env: Env = process.env): number {
  const days = Number(env.PRODUCT_FULL_SYNC_DAYS);
  const base = (Number.isFinite(days) && days >= 1 ? days : FULL_SYNC_DAYS_DEFAULT) * DAY_MS;
  return base + (hash32(channelId) % FULL_SYNC_JITTER_MS);
}

export interface CatalogPlanInput {
  channelId: string;
  /** Adapter của gian có đọc tăng dần được không (mock / sàn chưa hỗ trợ = false). */
  supportsIncremental: boolean;
  setting: IncrementalSetting;
  watermark: Date | null;
  fullSyncAt: Date | null;
  /** true = khách bấm nút (Channel.productSyncRequestedAt khác null lúc nhận việc). */
  requested: boolean;
  now: Date;
  /** Nhịp kéo toàn bộ (ms) — mặc định `fullSyncIntervalMs(channelId)`. */
  fullIntervalMs?: number;
}

export type CatalogPlan =
  | {
      mode: "full";
      reason: "khong-ho-tro" | "chua-co-moc" | "tat" | "chay-bong" | "den-han-toan-bo";
      /** Khác null = đo đối chiếu: lượt tăng dần từ mốc này sẽ thấy / sót những dòng nào. */
      shadowSince: Date | null;
    }
  | { mode: "incremental"; since: Date };

export function planCatalogSync(i: CatalogPlanInput): CatalogPlan {
  if (!i.supportsIncremental) return { mode: "full", reason: "khong-ho-tro", shadowSince: null };
  // Mốc ở tương lai (đồng hồ lệch / dữ liệu hỏng) coi như không có mốc.
  if (!i.watermark || !i.fullSyncAt || i.watermark.getTime() > i.now.getTime()) {
    return { mode: "full", reason: "chua-co-moc", shadowSince: null };
  }
  if (i.setting === "off") return { mode: "full", reason: "tat", shadowSince: null };

  const since = new Date(i.watermark.getTime() - CATALOG_OVERLAP_MS);
  if (i.setting === "shadow") return { mode: "full", reason: "chay-bong", shadowSince: since };

  const interval = i.fullIntervalMs ?? fullSyncIntervalMs(i.channelId);
  const age = i.now.getTime() - i.fullSyncAt.getTime();
  // Lượt đêm đến hạn → toàn bộ. Nút bấm chỉ bị ép toàn bộ khi đã quá 2 nhịp (lượt đêm hỏng mãi).
  if (age >= (i.requested ? 2 * interval : interval)) {
    return { mode: "full", reason: "den-han-toan-bo", shadowSince: since };
  }
  return { mode: "incremental", since };
}

export interface CatalogMarks {
  productSyncWatermark?: Date;
  productFullSyncAt?: Date;
}

/**
 * Mốc ghi sau một lượt kéo THÀNH CÔNG. Đọc chưa đủ (`complete = false`) → không ghi gì (mốc đứng
 * yên, lượt sau đọc lại từ mốc cũ). Lượt toàn bộ đủ → tiến cả hai mốc; tăng dần đủ → chỉ mốc nước.
 */
export function nextCatalogMarks(r: {
  mode: "full" | "incremental";
  complete: boolean;
  startedAt: Date;
}): CatalogMarks {
  if (!r.complete) return {};
  return r.mode === "full"
    ? { productSyncWatermark: r.startedAt, productFullSyncAt: r.startedAt }
    : { productSyncWatermark: r.startedAt };
}

export const CATALOG_PLAN_REASON_LABEL: Record<Extract<CatalogPlan, { mode: "full" }>["reason"], string> = {
  "khong-ho-tro": "sàn chưa đọc tăng dần được",
  "chua-co-moc": "gian chưa có mốc",
  tat: "tăng dần đang tắt",
  "chay-bong": "chạy bóng",
  "den-han-toan-bo": "đến hạn kéo toàn bộ",
};
