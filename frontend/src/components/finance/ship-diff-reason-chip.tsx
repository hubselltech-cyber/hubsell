import { SHIPPING_DIFF_REASON_META, type ShippingDiffReason } from "@/lib/shipping-diff-reason";
import { cn } from "@/lib/utils";

/**
 * Viên nhãn NGUYÊN NHÂN lệch phí vận chuyển — một kiểu cho trang Đối soát phí ship (kho) và bảng
 * Theo sản phẩm của Kiểm toán phí: xanh teal = ca khiếu nại được, xám = shop chịu theo chính sách sàn.
 * Cho xuống dòng (nhãn dài nhất 29 ký tự) để cột không ép bảng rộng ra ở màn 1280.
 */
export function ShipDiffReasonChip({ reason, className }: { reason: ShippingDiffReason; className?: string }) {
  const meta = SHIPPING_DIFF_REASON_META[reason];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-2xl border px-2.5 py-0.5 text-left text-xs font-medium leading-tight whitespace-normal",
        meta.claimable ? "border-teal-200 bg-teal-50 text-teal-800" : "border-slate-200 bg-slate-50 text-slate-600",
        className
      )}
    >
      {meta.label}
    </span>
  );
}
