// ============================================================
// SKU KHO CÓ PHÂN LOẠI + KHÓA GOM CHA–CON (22/10/2026)
//
// Khách (shop váy, 302 SKU Shopee) phàn nàn: 6 phân loại kéo về cùng một tên
// "Chân Váy Dáng A…", chỉ khác dãy id sàn → không kiểm kho được. Khảo sát
// Salework / BigSeller / Sapo / Ginee: ai cũng để MỖI PHÂN LOẠI MỘT DÒNG, tên
// kèm phân loại, và bảng gom cha–con theo mẫu hàng (như bảng Giá vốn Hubsell).
//
// Thiết kế: Product.productName = tên MẪU (item_name), Product.variantName =
// phân loại ("Đen, M"), Product.groupKey = khóa gom các phân loại cùng mẫu.
// Hàm ở đây là NƠI DUY NHẤT tính groupKey — mọi chỗ ghi tên/phân loại phải gọi.
// ============================================================

/** Khóa gom cha–con: chỉ SKU CÓ phân loại mới gom; sản phẩm đơn đứng một mình (NULL). */
export function productGroupKey(
  productName: string,
  variantName: string | null | undefined
): string | null {
  const variant = (variantName ?? "").trim();
  if (!variant) return null;
  return productName.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Phân loại đã làm sạch để ghi DB: "" → null, gọn khoảng trắng, "Đen,M" → "Đen, M". */
export function cleanVariantName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const parts = raw
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Tên đầy đủ để in ở nơi chỉ có MỘT dòng chữ (đơn hàng, Excel, chọn SKU): "Tên (Đen, M)". */
export function productDisplayName(p: {
  productName: string;
  variantName?: string | null;
}): string {
  return p.variantName ? `${p.productName} (${p.variantName})` : p.productName;
}

/**
 * Đuôi mã SKU kho sinh từ tên phân loại khi khách gõ MÃ GỐC trong hộp Nối SKU
 * nhanh (cách Salework "mã gốc + mã model"): "Đen, M" → "DEN-M"; "3-5kg" → "3-5KG".
 * Bỏ dấu tiếng Việt, chữ hoa, ký tự lạ thành "-".
 */
export function variantSkuSuffix(variantName: string | null | undefined): string {
  if (!variantName) return "";
  return variantName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Mã SKU kho từ mã gốc khách gõ + phân loại: "VAY01" + "Đen, M" → "VAY01-DEN-M". */
export function skuFromRoot(root: string, variantName: string | null | undefined): string {
  const base = root.trim().toUpperCase().replace(/\s+/g, "-");
  const suffix = variantSkuSuffix(variantName);
  return suffix ? `${base}-${suffix}` : base;
}
