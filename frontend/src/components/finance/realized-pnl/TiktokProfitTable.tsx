"use client";

import type { PnlDetailRow } from "@/lib/api";
import { toTiktokRow } from "@/lib/pnl-mappers";
import { carrierShort } from "@/lib/carrier-meta";
import { formatDateTime } from "@/lib/format";
import { formatDayVN } from "@/lib/date-range";
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
} from "./cells";

/**
 * BẢNG LÃI/LỖ THỰC HIỆN — TAB TIKTOK SHOP
 *
 * Cột chuẩn theo cấu trúc phí TikTok Shop: tách chiết khấu sàn/người bán, chi
 * tiết phí vận chuyển trước/sau chiết khấu, và các nhóm phí đặc thù (SFP, Flash
 * Sale, SFR, VAT). Nhóm cột tô nền: thông tin (trắng), doanh thu & giảm giá
 * (xanh), phí VC (lam), phí & thuế (đỏ), hiệu quả (xám). Cột chưa có dữ liệu
 * thật (chiết khấu PVC, Flash Sale, SFR, VAT) hiện GIỮ CHỖ 0đ.
 */
export function TiktokProfitTable({ rows }: { rows: PnlDetailRow[] }) {
  const data = rows.map(toTiktokRow);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[2280px] border-separate border-spacing-0 text-sm">
        <thead>
          {/* Tầng nhóm block */}
          <tr>
            <th className={cn(HEADER_GROUP, "text-left")} colSpan={8}>
              Thông tin đơn &amp; Sản phẩm
            </th>
            <th className={cn(HEADER_GROUP, "text-right text-emerald-700")} colSpan={4}>
              Doanh thu &amp; Giảm giá
            </th>
            <th className={cn(HEADER_GROUP, "text-right text-sky-700")} colSpan={6}>
              Chi tiết phí vận chuyển
            </th>
            <th className={cn(HEADER_GROUP, "text-right text-rose-700")} colSpan={6}>
              Phí &amp; Thuế TikTok
            </th>
            <th className={cn(HEADER_GROUP, "text-right")} colSpan={3}>
              Hiệu quả kinh doanh
            </th>
          </tr>
          {/* Tầng tên cột — căn lề khớp dữ liệu bên dưới */}
          <tr>
            {[
              ["Mã đơn", "left"],
              ["Trạng thái", "left"],
              ["Shop", "left"],
              ["Ngày tạo", "left"],
              ["ĐVVC", "left"],
              ["Ngày gửi ĐVVC", "left"],
              ["Khách hàng", "left"],
              ["Chi tiết sản phẩm", "left"],
              ["Tổng giá trị SP", "right"],
              ["Chiết khấu của sàn", "right"],
              ["Chiết khấu người bán", "right"],
              ["Tổng SP sau chiết khấu", "right"],
              ["PVC trước chiết khấu", "right"],
              ["CK PVC bởi sàn", "right"],
              ["CK PVC bởi người bán", "right"],
              ["PVC sau chiết khấu", "right"],
              ["PVC thực tế", "right"],
              ["Chênh lệch PVC", "right"],
              ["Phí cố định & GD", "right"],
              ["Phí dịch vụ SFP & Xtra", "right"],
              ["Phí Flash Sale", "right"],
              ["Phí Tiếp thị LK", "right"],
              ["Phí xử lý đơn & SFR", "right"],
              ["Thuế & VAT", "right"],
              ["Doanh thu ước tính", "right"],
              ["Chi phí giá vốn", "right"],
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
          {data.map((r) => {
            const b = r.base;
            const cell = "border-t border-slate-100 px-3 py-2.5";
            return (
              <tr key={b.id} className="transition-colors hover:bg-primary/[0.04]">
                {/* Thông tin đơn */}
                <td className={cn(cell, BLOCK.info)}>
                  <span className="font-medium text-slate-800">{b.orderCode}</span>
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
                <td className={cn(cell, BLOCK.info)}>
                  <span className="text-slate-700">{formatDateTime(b.createdAt)}</span>
                </td>
                <td className={cn(cell, BLOCK.info, "text-slate-600")}>
                  {b.carrier ? carrierShort(b.carrier) : "—"}
                </td>
                <td className={cn(cell, BLOCK.info, "text-slate-600")}>
                  {b.shippedAt ? formatDayVN(new Date(b.shippedAt)) : "—"}
                </td>
                <td className={cn(cell, BLOCK.info, "text-slate-600")}>
                  {b.customerName}
                </td>
                <td className={cn(cell, BLOCK.info)}>
                  <ProductLines items={b.items} />
                </td>

                {/* Doanh thu & giảm giá */}
                <td className={cn(cell, BLOCK.revenue, "text-right")}>
                  <Amount value={r.revenueGross} tone="font-medium text-slate-800" />
                </td>
                <td className={cn(cell, BLOCK.revenue, "text-right")}>
                  <Amount value={r.platformDiscount} tone="text-emerald-700" />
                </td>
                <td className={cn(cell, BLOCK.revenue, "text-right")}>
                  <Deduction value={r.sellerDiscount} tone="text-emerald-700" />
                </td>
                <td className={cn(cell, BLOCK.revenue, "text-right font-medium text-slate-800")}>
                  <Amount value={r.revenueAfterDiscount} />
                </td>

                {/* Phí vận chuyển */}
                <td className={cn(cell, BLOCK.ship, "text-right text-slate-600")}>
                  <Amount value={r.shipBeforeDiscount} />
                </td>
                <td className={cn(cell, BLOCK.ship, "text-right")}>
                  <Deduction value={r.shipDiscountPlatform} tone="text-sky-700" />
                </td>
                <td className={cn(cell, BLOCK.ship, "text-right")}>
                  <Deduction value={r.shipDiscountSeller} tone="text-sky-700" />
                </td>
                <td className={cn(cell, BLOCK.ship, "text-right text-slate-600")}>
                  <Amount value={r.shipAfterDiscount} />
                </td>
                <td className={cn(cell, BLOCK.ship, "text-right text-slate-600")}>
                  <Amount value={r.shipActual} />
                </td>
                <td className={cn(cell, BLOCK.ship, "text-right")}>
                  <Deduction value={r.shipDiff} tone="text-rose-600" />
                </td>

                {/* Phí & thuế (âm) */}
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.feeFixedTransaction} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.feeServiceSfpXtra} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.feeFlashSale} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.feeAffiliate} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.feeOrderProcessingSfr} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.taxVat} />
                </td>

                {/* Hiệu quả kinh doanh */}
                <td className={cn(cell, BLOCK.result, "text-right font-medium text-slate-800")}>
                  <Amount value={r.estRevenue} />
                </td>
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  <Deduction value={r.costSnapshot} tone="text-slate-600" />
                </td>
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  <ProfitCell value={r.profit} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={cn(TEXT_SUB, "px-3 py-2")}>
        Cột chiết khấu PVC, Flash Sale, xử lý đơn &amp; SFR, Thuế &amp; VAT đang{" "}
        <b>giữ chỗ (0₫)</b> — sẽ cắm số thật khi có luồng đồng bộ đối soát TikTok
        Shop.
      </p>
    </div>
  );
}
