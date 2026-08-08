"use client";

import type { PnlDetailRow } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatDateTime } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
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
  ReturnBadge,
  RowCheckTd,
  SelectAllTh,
  ShipDiff,
  type PnlSelection,
} from "./cells";

/**
 * BẢNG LÃI/LỖ — CỘT CỐT LÕI DÙNG CHUNG (Tổng quan & các sàn chưa có layout riêng
 * như Lazada). Gộp phí sàn về một cột để nhìn nhanh; chi tiết từng loại phí xem
 * ở tab sàn tương ứng.
 *
 * Mạch cột theo tư duy tài chính (chốt 30/07): Giá trị đơn hàng → các cột Phí &
 * Thuế bóc tách → Doanh thu thực tế (= Giá trị đơn hàng − Voucher Shop) →
 * Giá vốn → LỢI NHUẬN THỰC TẾ (= DT thực tế − phí − thuế − giá vốn).
 */
export function GenericProfitTable({
  rows,
  selectedIds,
  allSelected,
  someSelected,
  onToggle,
  onToggleAll,
}: { rows: PnlDetailRow[] } & PnlSelection) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1480px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <SelectAllTh
              allSelected={allSelected}
              someSelected={someSelected}
              onToggle={onToggleAll}
            />
            <th className={cn(HEADER_GROUP, "text-center")} colSpan={5}>
              Thông tin đơn &amp; Sản phẩm
            </th>
            <th className={cn(HEADER_GROUP, "text-center text-emerald-700")} colSpan={3}>
              Doanh thu
            </th>
            <th className={cn(HEADER_GROUP, "text-center text-rose-700")} colSpan={3}>
              Phí &amp; Thuế sàn
            </th>
            <th className={cn(HEADER_GROUP, "text-center")} colSpan={3}>
              Kết quả
            </th>
          </tr>
          <tr>
            {[
              ["Mã đơn", "left"],
              ["Trạng thái", "left"],
              ["Shop", "left"],
              ["Ngày tạo", "left"],
              ["Chi tiết sản phẩm", "left"],
              ["Giá trị đơn hàng", "right"],
              ["Voucher Shop", "right"],
              ["Tiền hoàn trả", "right"],
              ["Tổng phí sàn", "right"],
              ["Chênh lệch VC", "right"],
              ["Thuế sàn", "right"],
              ["Doanh thu thực tế", "right"],
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
              <tr
                key={b.id}
                className={cn(
                  "transition-colors hover:bg-primary/[0.04]",
                  selectedIds.has(b.id) && "bg-primary/[0.07] font-semibold"
                )}
              >
                <RowCheckTd
                  checked={selectedIds.has(b.id)}
                  onToggle={() => onToggle(b)}
                  label={`Chọn đơn ${b.orderCode}`}
                />
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
                    <span className="block text-[11px] text-emerald-500">đã đối soát</span>
                  )}
                  <ReturnBadge row={b} />
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
                <td className={cn(cell, BLOCK.revenue, "text-right")}>
                  <Deduction value={b.refundedAmount} tone="text-red-500" />
                  {b.refundEstimated && b.refundedAmount > 0 && (
                    <span className="block text-[10px] text-slate-400">tạm tính</span>
                  )}
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={totalFee} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <ShipDiff value={b.shippingFeeDiff} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={b.platformTax} />
                </td>
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  {/* Fallback tự tính khi API cũ chưa trả actualRevenue */}
                  <Amount
                    value={b.actualRevenue ?? b.revenueGross - b.sellerVoucher}
                    tone="font-medium text-slate-800"
                  />
                </td>
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  <Deduction value={b.costSnapshot} tone="text-slate-600" />
                  {b.recoveredCost > 0 && (
                    <span className="block text-[10px] text-emerald-600">
                      đã thu hồi vốn hàng về kho
                    </span>
                  )}
                </td>
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  <ProfitCell value={b.profitAfterTax} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={cn(TEXT_SUB, "px-3 py-2")}>
        <b>Doanh thu thực tế</b> = Giá trị đơn hàng − Voucher Shop.{" "}
        <b>LỢI NHUẬN THỰC TẾ</b> = Doanh thu thực tế − Tiền hoàn trả − Tổng phí
        sàn − Chênh lệch VC − Thuế sàn − Giá vốn (cộng lại trợ giá từ sàn nếu
        có). Thuế sàn: số thật với đơn đã đối soát, ước tính % với đơn chưa.
        Đơn hoàn/trả: tiền hoàn là số thật từ sàn hoặc <b>tạm tính toàn bộ</b>{" "}
        khi sàn chưa chốt; <b>Giá vốn</b> đã trừ phần hàng trả nhập lại kho
        nguyên vẹn.
      </p>
    </div>
  );
}
