"use client";

import type { PnlDetailRow } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Amount,
  BLOCK,
  Deduction,
  PNL_STATUS_LABEL,
  ProductLines,
  ProfitCell,
} from "./cells";

/**
 * BẢNG LÃI/LỖ — CỘT CỐT LÕI DÙNG CHUNG (Tổng quan & các sàn chưa có layout riêng
 * như Lazada). Gộp phí sàn về một cột để nhìn nhanh; chi tiết từng loại phí xem
 * ở tab sàn tương ứng.
 */
export function GenericProfitTable({ rows }: { rows: PnlDetailRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className={cn("px-3 pt-3 pb-1 text-left", BLOCK.info)} colSpan={5}>
              Thông tin đơn &amp; Sản phẩm
            </th>
            <th className={cn("px-3 pt-3 pb-1 text-right text-emerald-700", BLOCK.revenue)} colSpan={2}>
              Doanh thu
            </th>
            <th className={cn("px-3 pt-3 pb-1 text-right text-rose-700", BLOCK.fee)} colSpan={2}>
              Phí sàn
            </th>
            <th className={cn("px-3 pt-3 pb-1 text-right text-slate-600", BLOCK.ship)} colSpan={1}>
              Vận hành
            </th>
            <th className={cn("px-3 pt-3 pb-1 text-right", BLOCK.result)}>Kết quả</th>
          </tr>
          <tr className="text-xs text-slate-500">
            {[
              ["Mã đơn", "left", BLOCK.info],
              ["Trạng thái", "left", BLOCK.info],
              ["Shop", "left", BLOCK.info],
              ["Ngày tạo", "left", BLOCK.info],
              ["Chi tiết sản phẩm", "left", BLOCK.info],
              ["Doanh thu gốc", "right", BLOCK.revenue],
              ["Voucher Shop", "right", BLOCK.revenue],
              ["Tổng phí sàn", "right", BLOCK.fee],
              ["Chênh lệch VC", "right", BLOCK.fee],
              ["Giá vốn", "right", BLOCK.ship],
              ["LỢI NHUẬN THỰC TẾ", "right", BLOCK.result],
            ].map(([label, align, bg], i) => (
              <th
                key={i}
                className={cn(
                  "px-3 pb-2 font-medium",
                  align === "right" ? "text-right" : "text-left",
                  label === "LỢI NHUẬN THỰC TẾ" && "font-semibold text-slate-700",
                  bg
                )}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((b) => {
            const meta = CHANNEL_META[b.channelName];
            const cell = "border-t border-slate-100 px-3 py-2.5";
            const totalFee = b.feeFixedPayment + b.feeService + b.feeAffiliate;
            return (
              <tr key={b.id} className="transition-colors hover:bg-primary/[0.04]">
                <td className={cn(cell, BLOCK.info)}>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                        meta.className
                      )}
                    >
                      {meta.label}
                    </span>
                    <span className="font-medium text-slate-800">{b.orderCode}</span>
                  </div>
                  {b.missingCostPrice && (
                    <span className="mt-0.5 block text-[11px] text-amber-600">
                      Chưa nhập giá vốn
                    </span>
                  )}
                </td>
                <td className={cn(cell, BLOCK.info)}>
                  <span className="text-slate-700">
                    {PNL_STATUS_LABEL[b.shippingStatus] ?? b.shippingStatus}
                  </span>
                  {b.isSettled && (
                    <span className="block text-[11px] text-emerald-600">đã đối soát</span>
                  )}
                </td>
                <td className={cn(cell, BLOCK.info, "text-slate-600")}>{b.shopName}</td>
                <td className={cn(cell, BLOCK.info, "text-slate-700")}>
                  {formatDateTime(b.createdAt)}
                </td>
                <td className={cn(cell, BLOCK.info)}>
                  <ProductLines items={b.items} />
                </td>
                <td className={cn(cell, BLOCK.revenue, "text-right")}>
                  <Amount value={b.revenueGross} tone="font-medium text-slate-800" />
                </td>
                <td className={cn(cell, BLOCK.revenue, "text-right")}>
                  <Deduction value={b.sellerVoucher} tone="text-emerald-700" />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={totalFee} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={b.shippingFeeDiff} />
                </td>
                <td className={cn(cell, BLOCK.ship, "text-right")}>
                  <Deduction value={b.costSnapshot} tone="text-slate-600" />
                </td>
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  <ProfitCell value={b.profit} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
