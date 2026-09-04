"use client";

import { useEffect, useRef } from "react";

import { Money } from "@/components/ui/money";
import type { PnlDetailRow, PnlItemLine, PnlReturnType } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Nhãn + màu badge cho 4 hình thức hoàn tiền/trả hàng (chấm màu + chữ gọn). */
const RETURN_TYPE_META: Record<
  PnlReturnType,
  { label: string; className: string; dotClassName: string }
> = {
  REFUND_ONLY: {
    label: "Hoàn tiền 100%",
    className: "border-red-200 bg-red-50 text-red-600",
    dotClassName: "bg-red-500",
  },
  PARTIAL_REFUND: {
    label: "Hoàn 1 phần",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    dotClassName: "bg-amber-500",
  },
  PARTIAL_RETURN: {
    label: "Trả 1 phần SP",
    className: "border-orange-200 bg-orange-50 text-orange-700",
    dotClassName: "bg-orange-500",
  },
  FULL_RETURN: {
    label: "Hoàn toàn bộ",
    className: "border-purple-200 bg-purple-50 text-purple-700",
    dotClassName: "bg-purple-500",
  },
};

/**
 * BADGE HOÀN/TRẢ trên dòng đơn — phân loại 4 kịch bản; PARTIAL_RETURN kèm số
 * lượng "x/y"; số hoàn đang TẠM TÍNH (sàn chưa chốt) chú thích rõ để không
 * đọc nhầm thành số thật. Đơn bán bình thường (returnType null) không render.
 * whitespace-nowrap toàn bộ: badge quyết định độ rộng cột Trạng thái, tuyệt
 * đối không để pill gãy chữ xuống dòng.
 */
export function ReturnBadge({ row }: { row: PnlDetailRow }) {
  if (!row.returnType) return null;
  const meta = RETURN_TYPE_META[row.returnType];
  return (
    <span className="mt-1 block">
      <span
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
          meta.className
        )}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", meta.dotClassName)} />
        {meta.label}
        {row.returnType === "PARTIAL_RETURN" && (
          <> ({row.returnedQuantity}/{row.totalQuantity})</>
        )}
      </span>
      {/* Nguồn số hoàn (19/08 "không bịa giá"): sàn báo trên yêu cầu hoàn
          (chờ sao kê) / tạm tính (Lazada chưa nối Reverse API). Số sao kê
          thật thì không chú thích. Kèm "hàng đã về" khi sàn/kho xác nhận
          kiện về tay → người đọc hiểu vì sao giá vốn không còn tính. */}
      {row.refundSource === "platform" && (
        <span className="block whitespace-nowrap text-[10px] text-slate-400">
          sàn báo · chờ sao kê
          {row.platformReturnStatus ? ` (${row.platformReturnStatus})` : ""}
        </span>
      )}
      {row.refundSource === null && row.platformReturnStatus && (
        <span className="block whitespace-nowrap text-[10px] text-slate-400">
          yêu cầu {row.platformReturnStatus} · sàn chưa báo số
        </span>
      )}
      {row.refundSource === "estimate" && (
        <span className="block whitespace-nowrap text-[10px] text-slate-400">
          tạm tính, chưa có số sàn
        </span>
      )}
      {(row.returnType === "FULL_RETURN" || row.returnType === "PARTIAL_RETURN") &&
        (row.returnDeliveredAt || row.recoveredCost > 0) && (
          <span className="block whitespace-nowrap text-[10px] text-emerald-600">
            hàng đã về · vốn thu hồi
          </span>
        )}
    </span>
  );
}

/**
 * Ô & hằng dùng chung cho các bảng Lãi/Lỗ theo sàn (Shopee, TikTok…). Gom về một
 * chỗ để hai bảng nhất quán nền màu block, định dạng số và cách hiển thị dòng
 * sản phẩm.
 */

/** Nền nhẹ theo block cột — dùng cho ô DỮ LIỆU (giữ mã màu để quét theo cột). */
export const BLOCK = {
  info: "",
  revenue: "bg-emerald-50/60",
  ship: "bg-sky-50/60",
  fee: "bg-rose-50/50",
  result: "bg-slate-100/70",
} as const;

/**
 * Class cho VÙNG TIÊU ĐỀ bảng — đồng bộ 3 bảng (Shopee/TikTok/Generic).
 * Cả header dùng chung một nền xám nhạt để tách hẳn với vùng dữ liệu trắng bên
 * dưới; mã màu nhóm chuyển sang thể hiện bằng MÀU CHỮ của tầng trên.
 *
 * - HEADER_GROUP: tầng trên (tên nhóm) — in đậm, có border-bottom phân tách tầng.
 * - HEADER_COL:   tầng dưới (tên cột) — border-bottom đậm ngăn cách với dữ liệu.
 * Cả hai đệm dọc py-3 cho thoáng.
 */
export const HEADER_GROUP =
 "border-b border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold";
export const HEADER_COL =
  "border-b-2 border-slate-200 bg-slate-50 px-3 py-3 text-xs font-medium text-slate-500";

/**
 * Bộ props tích chọn đơn dùng chung cho 3 bảng. State thật nằm ở trang cha; bảng
 * chỉ render checkbox và gọi callback.
 */
export interface PnlSelection {
  selectedIds: Set<string>;
  /** Toàn bộ đơn TRANG HIỆN TẠI đã chọn hết chưa. */
  allSelected: boolean;
  /** Có chọn một phần (để hiện trạng thái indeterminate ở ô "chọn tất cả"). */
  someSelected: boolean;
  onToggle: (row: PnlDetailRow) => void;
  onToggleAll: () => void;
}

/** Ô header "chọn tất cả" — chiếm cả 2 tầng header (rowSpan) ở cột đầu. */
export function SelectAllTh({
  allSelected,
  someSelected,
  onToggle,
}: {
  allSelected: boolean;
  someSelected: boolean;
  /** Bật/tắt chọn toàn bộ đơn của trang hiện tại. */
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);
  return (
    <th
      rowSpan={2}
      className="w-10 border-b-2 border-slate-200 bg-slate-50 px-3 py-3 text-center align-middle"
    >
      <input
        ref={ref}
        type="checkbox"
        aria-label="Chọn tất cả đơn trên trang"
        checked={allSelected}
        onChange={onToggle}
        className="size-4 cursor-pointer align-middle accent-primary"
      />
    </th>
  );
}

/** Ô checkbox của một hàng dữ liệu (căn giữa cột). */
export function RowCheckTd({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <td className="border-t border-slate-100 px-3 py-3 text-center align-middle">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={onToggle}
        className="size-4 cursor-pointer align-middle accent-primary"
      />
    </td>
  );
}

export const PNL_STATUS_LABEL: Record<string, string> = {
  PENDING: "Chờ xử lý",
  // PROCESSED = người bán đã đóng gói/chuẩn bị xong, ĐVVC CHƯA lấy hàng
  // (Lazada: packed/ready_to_ship; Shopee/TikTok tương đương). Hiển thị đúng
  // ngôn ngữ sàn thay cho "Đã xử lý" mơ hồ — mapper backend giữ nguyên.
  PROCESSED: "Chờ lấy hàng",
  SHIPPING: "Đang giao",
  DELIVERED: "Đã giao",
  CANCELLED: "Đã hủy",
};

/** Ô phí/khấu trừ (âm): hiện dấu trừ khi > 0, gạch mờ khi = 0. */
export function Deduction({
  value,
  tone = "text-red-500",
}: {
  value: number;
  tone?: string;
}) {
  if (!value) return <span className="text-slate-300">—</span>;
  return <Money value={value} negative className={tone} />;
}

/**
 * Ô CHÊNH LỆCH PHÍ VC — khoản HAI CHIỀU duy nhất trong các cột phí.
 * Quy ước dữ liệu: dương = sàn trừ THÊM của shop (xấu → đỏ, dấu −);
 * âm = sàn HOÀN LẠI cho shop (tốt → xanh, dấu +). Không dùng Deduction ở đây:
 * Deduction giả định phí luôn dương, gặp số âm sẽ in "− -5.500" (trừ kép).
 */
export function ShipDiff({ value }: { value: number }) {
  if (!value) return <span className="text-slate-300">—</span>;
  if (value > 0) return <Money value={value} negative className="text-red-500" />;
  return (
    <span className="whitespace-nowrap text-emerald-700">
      + <Money value={Math.abs(value)} className="text-emerald-700" />
    </span>
  );
}

/** Ô số dương (doanh thu). */
export function Amount({ value, tone }: { value: number; tone?: string }) {
  if (!value) return <span className="text-slate-300">—</span>;
  return <Money value={value} className={tone} />;
}

/** Ô LỢI NHUẬN THỰC TẾ: xanh đậm nếu > 0, đỏ đậm (có dấu −) nếu < 0. */
export function ProfitCell({ value }: { value: number }) {
  if (value === 0)
    return <span className="font-bold text-slate-400">0 ₫</span>;
  const positive = value > 0;
  return (
    <Money
      value={Math.abs(value)}
      negative={!positive}
      className={cn("font-bold", positive ? "text-emerald-500" : "text-red-500")}
    />
  );
}

/**
 * Cột "Chi tiết sản phẩm" — mini-list gọn: chỉ Mã SKU (hoặc mã phân loại) × SL,
 * xếp chồng dọc từng dòng. BỎ tên sản phẩm cho bảng gọn nhất.
 */
export function ProductLines({ items }: { items: PnlItemLine[] }) {
  if (items.length === 0) return <span className="text-slate-300">—</span>;
  return (
    <div className="space-y-0.5">
      {items.map((it, i) => (
        <div key={`${it.sku}-${i}`} className="whitespace-nowrap leading-tight">
          <span className="font-mono text-[11px] text-slate-600">
            {it.variation || it.sku}
          </span>
          <span className="text-slate-400"> × {it.quantity}</span>
        </div>
      ))}
    </div>
  );
}
