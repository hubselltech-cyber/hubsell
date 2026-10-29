import type { CopyListingJobStatus, CopyListingTargetStatus } from "@/lib/api";

/** Nhãn tiếng Việt của mã "còn thiếu" — khớp MISSING_LABELS backend (marketplace/listing/rules.ts). */
const MISSING_LABELS: Record<string, string> = {
  category: "Chưa chọn danh mục",
  brand: "Thiếu thương hiệu",
  weight: "Thiếu cân nặng",
  dimensions: "Kích thước kiện chưa đủ 3 số (Dài × Rộng × Cao)",
  logistics: "Chưa bật kênh vận chuyển",
  title_short: "Tên quá ngắn",
  title_long: "Tên quá dài",
  description: "Mô tả quá ngắn",
  images: "Chưa có ảnh",
  too_many_images: "Quá số ảnh cho phép",
  too_many_options: "Quá số nhóm phân loại",
  too_many_variants: "Quá số phân loại",
  sku: "Phân loại thiếu SKU",
  sku_exists: "SKU đã có trên gian đích",
  price: "Giá phải lớn hơn 0",
};

export function missingLabel(code: string, attrName?: (id: string) => string | undefined): string {
  if (code.startsWith("attr:")) {
    const id = code.slice(5);
    return `Thiếu ${attrName?.(id) ?? "thuộc tính"}`;
  }
  return MISSING_LABELS[code] ?? code;
}

/**
 * target.error do backend ghi: dòng 1 = câu tiếng Việt cho người bán, dòng 2 = nguyên văn sàn
 * (marketplace/listing/error-text.ts). Lỗi ghi trước 29/10 chỉ có một dòng tiếng Anh → text.
 */
export function splitListingError(stored: string | null): { text: string; detail: string | null } {
  if (!stored) return { text: "", detail: null };
  const idx = stored.indexOf("\n");
  if (idx < 0) return { text: stored, detail: null };
  return { text: stored.slice(0, idx), detail: stored.slice(idx + 1).trim() || null };
}

/** "No Brand" (Shopee id 0 / Lazada) là giá trị sàn đòi — chỉ đổi chữ hiện cho khách. */
export function brandLabel(name: string): string {
  return /^no ?brand$/i.test(name.trim()) ? "Không có thương hiệu (No Brand)" : name;
}

export const TARGET_STATUS: Record<CopyListingTargetStatus, { label: string; className: string }> = {
  PENDING: { label: "Chờ đăng", className: "bg-slate-50 text-slate-700 border-slate-200" },
  QUEUED: { label: "Đang xếp hàng", className: "bg-sky-50 text-sky-700 border-sky-200" },
  RUNNING: { label: "Đang đăng", className: "bg-sky-50 text-sky-700 border-sky-200" },
  LISTED: { label: "Đã đăng", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  PENDING_REVIEW: { label: "Chờ sàn duyệt", className: "bg-amber-50 text-amber-700 border-amber-200" },
  FAILED: { label: "Lỗi", className: "bg-rose-50 text-red-500 border-rose-200" },
};

export const JOB_STATUS: Record<CopyListingJobStatus, { label: string; className: string }> = {
  DRAFT: { label: "Nháp", className: "bg-slate-50 text-slate-700 border-slate-200" },
  SUBMITTED: { label: "Đang đăng", className: "bg-sky-50 text-sky-700 border-sky-200" },
  DONE: { label: "Xong", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  PARTIAL: { label: "Xong một phần", className: "bg-amber-50 text-amber-700 border-amber-200" },
  FAILED: { label: "Thất bại", className: "bg-rose-50 text-red-500 border-rose-200" },
};
