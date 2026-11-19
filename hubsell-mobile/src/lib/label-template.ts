// ============================================================
// MẪU CHÈN THÔNG TIN LÊN VẬN ĐƠN — phần thuần của màn "Tùy chỉnh phiếu in" (19/11/2026).
// Kiểu + luật ghép chữ CHÉP TAY từ backend/src/services/label-overlay/template.ts (rowText)
// để khung xem trước trên app ra đúng dòng chữ máy chủ sẽ in. Sửa bên kia phải sửa theo.
// ============================================================

export interface LabelTemplate {
  /** Thay bảng sản phẩm của sàn bằng bảng gọn của Hubsell. */
  enabled: boolean;
  showSku: boolean;
  showVariant: boolean;
  showName: boolean;
  /** Dòng nhắn của shop in trên đầu bảng; rỗng = không in. */
  note: string;
  /** Mỗi đơn đúng một tờ (bỏ trang tràn của bảng sản phẩm sàn). */
  onePage: boolean;
  /** Chiều cao vùng chèn tính từ đáy tem (mm) khi máy không tự dò được; null = tự dò. */
  manualZoneMm: number | null;
}

export type TemplatePlatform = "TIKTOK" | "SHOPEE" | "LAZADA";

export interface LabelTemplateSettings {
  /** Chỉ chủ shop đổi được mẫu; nhân viên chỉ xem. */
  canEdit: boolean;
  /**
   * Máy chủ có tự dò chỗ bảng sản phẩm trên từng vận đơn không. false → mẫu PHẢI có
   * `manualZoneMm` mới chèn được. Máy chủ cũ không trả → coi như true.
   */
  autoDetect?: boolean;
  limits: { noteMax: number; zoneMinMm: number; zoneMaxMm: number };
  platforms: { platform: TemplatePlatform; supported: boolean; template: LabelTemplate }[];
}

export interface PreviewRow {
  sku: string | null;
  variant: string | null;
  name: string;
  quantity: number;
}

/** Dòng hàng mẫu của khung xem trước — có đủ ca: nhiều món, không phân loại, không mã người bán. */
export const PREVIEW_ROWS: PreviewRow[] = [
  { sku: "AT01-DEN-L", variant: "Đen, L", name: "Áo thun nam cổ tròn cotton form rộng", quantity: 2 },
  { sku: "QS07-BE-30", variant: "Be, 30", name: "Quần short kaki túi hộp ống rộng", quantity: 1 },
  { sku: "TAT-C5", variant: null, name: "Tất cổ ngắn khử mùi (combo 5 đôi)", quantity: 3 },
  { sku: null, variant: "Nâu", name: "Thắt lưng da khóa tự động", quantity: 1 },
];

/**
 * Chữ của một dòng theo các cột đang bật. Dòng không có mã người bán mà chỉ bật SKU thì lùi
 * về phân loại rồi tên — không bao giờ ra dòng trống.
 */
export function rowParts(
  row: PreviewRow,
  t: Pick<LabelTemplate, "showSku" | "showVariant" | "showName">
): { text: string; bold: boolean }[] {
  const parts: { text: string; bold: boolean }[] = [];
  if (t.showSku && row.sku) parts.push({ text: row.sku, bold: true });
  if (t.showVariant && row.variant) parts.push({ text: row.variant, bold: parts.length === 0 });
  if (t.showName && row.name) parts.push({ text: row.name, bold: false });
  if (parts.length === 0) {
    parts.push({ text: row.sku ?? row.variant ?? (row.name || "(không có mã)"), bold: true });
  }
  return parts;
}

/**
 * Bật / tắt một cột. Không cho tắt cột CUỐI CÙNG đang bật (máy chủ cũng tự bật lại SKU) —
 * trả nguyên mẫu để công tắc trên màn đứng yên.
 */
export function toggleColumn(t: LabelTemplate, key: "showSku" | "showVariant" | "showName"): LabelTemplate {
  const next = { ...t, [key]: !t[key] };
  return next.showSku || next.showVariant || next.showName ? next : t;
}

/** Hai mẫu khác nhau chỗ nào không — để bật nút Lưu. Dòng nhắn so sau khi gọt khoảng trắng. */
export function sameTemplate(a: LabelTemplate, b: LabelTemplate): boolean {
  return (
    a.enabled === b.enabled &&
    a.showSku === b.showSku &&
    a.showVariant === b.showVariant &&
    a.showName === b.showName &&
    a.onePage === b.onePage &&
    a.manualZoneMm === b.manualZoneMm &&
    a.note.trim() === b.note.trim()
  );
}

/** Đổi chiều cao vùng tự đặt theo nấc 5 mm, kẹp trong giới hạn máy chủ cho. */
export function stepZone(mm: number, delta: number, limits: { zoneMinMm: number; zoneMaxMm: number }): number {
  return Math.min(limits.zoneMaxMm, Math.max(limits.zoneMinMm, mm + delta));
}
