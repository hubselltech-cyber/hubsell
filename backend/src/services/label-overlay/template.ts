// ============================================================
// MẪU CHÈN THÔNG TIN LÊN VẬN ĐƠN (19/11/2026, docs/MOBILE-CHUAN-BI-HANG-IN-PHIEU.md mục 5)
//
// Khách xin (ảnh chat 19/11, đang dùng ShipXanh): vận đơn TikTok đơn nhiều món bị in sang
// tờ thứ hai; muốn đổi tên sản phẩm thành SKU với hàng nhạy cảm; muốn có dòng nhắn / số
// điện thoại shop trên tờ đơn. Cách làm: GIỮ NGUYÊN phần vận chuyển của sàn (mã vạch, mã
// phân tuyến, địa chỉ — không vẽ lại), chỉ thay PHẦN DANH SÁCH SẢN PHẨM của sàn bằng một
// bảng gọn của Hubsell.
//
// Mỗi chủ shop một mẫu cho mỗi sàn, lưu ở User.labelTemplates (JSON theo tên sàn). Tệp này
// chỉ lo hình dạng + làm sạch dữ liệu; thuần hàm.
// ============================================================

import { ChannelName } from "@prisma/client";

export interface LabelTemplate {
  /** Bật thay bảng sản phẩm của sàn bằng bảng gọn của Hubsell. */
  enabled: boolean;
  /** Cột của bảng gọn. Ít nhất một cột bật — tắt hết thì coi như bật SKU. */
  showSku: boolean;
  showVariant: boolean;
  showName: boolean;
  /** Dòng nhắn của shop in trên đầu bảng (số điện thoại shop, "hàng dễ vỡ"…). Rỗng = không in. */
  note: string;
  /** Bỏ các trang tràn của bảng sản phẩm sàn — mỗi đơn đúng một tờ. */
  onePage: boolean;
  /**
   * Chiều cao vùng chèn tính từ ĐÁY tem (mm) dùng khi máy không tự dò được bảng sản phẩm
   * của sàn. null = không dò được thì để nguyên phiếu của sàn (mặc định, an toàn).
   */
  manualZoneMm: number | null;
}

export const NOTE_MAX = 80;
/** Biên của vùng chèn tự đặt — dưới 20 mm không đủ chỗ cho bảng, trên 70 mm là lấn mã vạch. */
export const MANUAL_ZONE_MIN_MM = 20;
export const MANUAL_ZONE_MAX_MM = 70;

export const DEFAULT_LABEL_TEMPLATE: LabelTemplate = {
  enabled: false,
  showSku: true,
  showVariant: true,
  showName: false,
  note: "",
  onePage: true,
  manualZoneMm: null,
};

/**
 * Sàn đã có luật dò vùng bảng sản phẩm. Shopee / Lazada CHƯA: vị trí ô "Nội dung hàng"
 * nằm giữa tem, sát dòng tiền thu hộ — phải đo trên phiếu thật trước
 * (scripts/label-shape-probe.ts), che nhầm là hãng vận chuyển từ chối kiện.
 */
export const OVERLAY_PLATFORMS: ChannelName[] = [ChannelName.TIKTOK];

export function overlaySupported(platform: ChannelName): boolean {
  return OVERLAY_PLATFORMS.includes(platform);
}

/** Bỏ ký tự điều khiển + gộp khoảng trắng; cắt theo số KÝ TỰ (không cắt giữa cặp thay thế). */
export function cleanNote(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...s].slice(0, NOTE_MAX).join("");
}

/** Dựng mẫu hợp lệ từ dữ liệu bất kỳ (body request / cột JSON cũ) — thiếu gì lấy mặc định. */
export function parseLabelTemplate(raw: unknown): LabelTemplate {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  let showSku = bool(o.showSku, DEFAULT_LABEL_TEMPLATE.showSku);
  const showVariant = bool(o.showVariant, DEFAULT_LABEL_TEMPLATE.showVariant);
  const showName = bool(o.showName, DEFAULT_LABEL_TEMPLATE.showName);
  if (!showSku && !showVariant && !showName) showSku = true;
  const mm = typeof o.manualZoneMm === "number" && Number.isFinite(o.manualZoneMm) ? o.manualZoneMm : null;
  return {
    enabled: bool(o.enabled, DEFAULT_LABEL_TEMPLATE.enabled),
    showSku,
    showVariant,
    showName,
    note: cleanNote(o.note),
    onePage: bool(o.onePage, DEFAULT_LABEL_TEMPLATE.onePage),
    manualZoneMm: mm === null ? null : Math.min(MANUAL_ZONE_MAX_MM, Math.max(MANUAL_ZONE_MIN_MM, Math.round(mm))),
  };
}

/** Đọc cột User.labelTemplates → mẫu của từng sàn đã có luật; sàn chưa lưu = mặc định (tắt). */
export function readLabelTemplates(raw: unknown): Partial<Record<ChannelName, LabelTemplate>> {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Partial<Record<ChannelName, LabelTemplate>> = {};
  for (const p of OVERLAY_PLATFORMS) out[p] = parseLabelTemplate(o[p]);
  return out;
}

/** Một dòng của bảng gọn. */
export interface OverlayRow {
  sku: string | null;
  variant: string | null;
  name: string;
  quantity: number;
}

/**
 * Chữ của một dòng theo các cột đang bật. Dòng không có mã người bán mà chỉ bật SKU thì
 * lùi về phân loại rồi tên — không bao giờ in dòng trống (kho không biết lấy món gì).
 */
export function rowText(row: OverlayRow, t: Pick<LabelTemplate, "showSku" | "showVariant" | "showName">) {
  const parts: { text: string; bold: boolean }[] = [];
  if (t.showSku && row.sku) parts.push({ text: row.sku, bold: true });
  if (t.showVariant && row.variant) parts.push({ text: row.variant, bold: parts.length === 0 });
  if (t.showName && row.name) parts.push({ text: row.name, bold: false });
  if (parts.length === 0) {
    const fallback = row.sku ?? row.variant ?? row.name;
    parts.push({ text: fallback || "(không có mã)", bold: true });
  }
  return parts;
}
