"use client";

import type { PnlDetailRow } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Amount,
  BLOCK,
  Deduction,
  HEADER_COL,
  HEADER_GROUP,
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
          <tr>
            <th className={cn(HEADER_GROUP, "text-center")} colSpan={5}>
              Thông tin đơn &amp; Sản phẩm
            </th>
            <th className={cn(HEADER_GROUP, "text-center text-emerald-700")} colSpan={2}>
              Doanh thu
            </th>
            <th className={cn(HEADER_GROUP, "text-center text-rose-700")} colSpan={2}>
              Phí sàn
            </th>
            <th className={cn(HEADER_GROUP, "text-center text-slate-600")} colSpan={1}>
              Vận hành
            </th>
            <th className={cn(HEADER_GROUP, "text-center")}>Kết quả</th>
          </tr>
          <tr>
            {[
              ["Mã đơn", "left"],
              ["Trạng thái", "left"],
              ["Shop", "left"],
              ["Ngày tạo", "left"],
              ["Chi tiết sản phẩm", "left"],
              ["Doanh thu gốc", "right"],
              ["Voucher Shop", "right"],
              ["Tổng phí sàn", "right"],
              ["Chênh lệch VC", "right"],
              ["Giá vốn", "right"],
              ["LỢI NHUẬN THỰC TẾ", "right"],
            ].map(([label, align], i) => (
              <th
                key={i}
                className={cn(
                  HEADER_COL,
                  align === "right" ? "text-right" : "text-left",
                  label === "LỢI NHUẬN THỰC TẾ" && "font-semibold text-slate-700"
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
