import type { CopyListingJobStatus, CopyListingTargetStatus } from "@/lib/api";

/** Nhãn tiếng Việt của mã "còn thiếu" — khớp MISSING_LABELS backend (marketplace/listing/rules.ts). */
const MISSING_LABELS: Record<string, string> = {
  category: "Chưa chọn danh mục",
  brand: "Thiếu thương hiệu",
  weight: "Thiếu cân nặng",
  dimensions: "Thiếu kích thước kiện",
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
