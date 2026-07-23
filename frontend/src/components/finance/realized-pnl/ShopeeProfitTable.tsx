"use client";

import type { PnlDetailRow } from "@/lib/api";
import { toShopeeRow } from "@/lib/pnl-mappers";
import { carrierShort } from "@/lib/carrier-meta";
import { formatDateTime } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
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
 * BẢNG LÃI/LỖ THỰC HIỆN — TAB SHOPEE
 *
 * Cột thiết kế riêng theo cấu trúc phí Shopee (tham chiếu file quyết toán
 * Salework). Nhóm cột tô nền: thông tin đơn (trắng), doanh thu (xanh), phí vận
 * chuyển (lam), phí sàn & thuế (đỏ), hiệu quả kinh doanh (xám). Các cột phí chưa
 * có dữ liệu thật (trợ giá VC, người mua trả, nạp ví QC, thuế) hiện GIỮ CHỖ 0đ.
 */
export function ShopeeProfitTable({ rows }: { rows: PnlDetailRow[] }) {
  const data = rows.map(toShopeeRow);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1900px] border-separate border-spacing-0 text-sm">
        <thead>
          {/* Hàng nhóm block */}
          <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className={cn("px-3 pt-3 pb-1 text-left", BLOCK.info)} colSpan={6}>
              Thông tin đơn &amp; Sản phẩm
            </th>
            <th className={cn("px-3 pt-3 pb-1 text-right text-emerald-700", BLOCK.revenue)} colSpan={2}>
              Doanh thu &amp; Trợ giá
            </th>
            <th className={cn("px-3 pt-3 pb-1 text-right text-sky-700", BLOCK.ship)} colSpan={6}>
              Phí vận chuyển
            </th>
            <th className={cn("px-3 pt-3 pb-1 text-right text-rose-700", BLOCK.fee)} colSpan={6}>
              Phí sàn &amp; Thuế
            </th>
            <th className={cn("px-3 pt-3 pb-1 text-right", BLOCK.result)} colSpan={4}>
              Hiệu quả kinh doanh
            </th>
          </tr>
          {/* Hàng tên cột */}
          <tr className="text-xs text-slate-500">
            {[
              ["Mã đơn", "left", BLOCK.info],
              ["Trạng thái", "left", BLOCK.info],
              ["Shop", "left", BLOCK.info],
              ["Ngày tạo", "left", BLOCK.info],
              ["ĐVVC", "left", BLOCK.info],
              ["Chi tiết sản phẩm", "left", BLOCK.info],
              ["Tổng giá trị SP", "right", BLOCK.revenue],
              ["Trợ giá Shopee", "right", BLOCK.revenue],
              ["Phí VC Dự kiến", "right", BLOCK.ship],
              ["Phí VC Thực tế", "right", BLOCK.ship],
              ["Trợ giá VC Shopee", "right", BLOCK.ship],
              ["Trợ giá VC Shop", "right", BLOCK.ship],
              ["Người mua trả", "right", BLOCK.ship],
              ["Chênh lệch phí VC", "right", BLOCK.ship],
              ["Phí sàn (CĐ+TT)", "right", BLOCK.fee],
              ["Phí TTLK (Affiliate)", "right", BLOCK.fee],
              ["PiShip (Xtra)", "right", BLOCK.fee],
              ["Nạp ví quảng cáo", "right", BLOCK.fee],
              ["Trợ giá người bán", "right", BLOCK.fee],
              ["Thuế", "right", BLOCK.fee],
              ["Doanh thu ước tính", "right", BLOCK.result],
              ["Doanh thu từ Shopee", "right", BLOCK.result],
              ["Chi phí giá vốn", "right", BLOCK.result],
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
                <td className={cn(cell, BLOCK.info)}>
                  <ProductLines items={b.items} />
                </td>

                {/* Doanh thu & trợ giá */}
                <td className={cn(cell, BLOCK.revenue, "text-right")}>
                  <Amount value={r.revenueGross} tone="font-medium text-slate-800" />
                </td>
                <td className={cn(cell, BLOCK.revenue, "text-right")}>
                  <Amount value={r.shopeeSubsidy} tone="text-emerald-700" />
                </td>

                {/* Phí vận chuyển */}
                <td className={cn(cell, BLOCK.ship, "text-right text-slate-600")}>
                  <Amount value={r.shipQuoted} />
                </td>
                <td className={cn(cell, BLOCK.ship, "text-right text-slate-600")}>
                  <Amount value={r.shipActual} />
                </td>
                <td className={cn(cell, BLOCK.ship, "text-right")}>
                  <Amount value={r.shipSubsidyShopee} tone="text-emerald-700" />
                </td>
                <td className={cn(cell, BLOCK.ship, "text-right")}>
                  <Amount value={r.shipSubsidyShop} tone="text-emerald-700" />
                </td>
                <td className={cn(cell, BLOCK.ship, "text-right text-slate-600")}>
                  <Amount value={r.buyerPaidShip} />
                </td>
                <td className={cn(cell, BLOCK.ship, "text-right")}>
                  <Deduction value={r.shipDiff} tone="text-rose-600" />
                </td>

                {/* Phí sàn & thuế (âm) */}
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.feePlatform} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.feeAffiliate} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.feePiship} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.adWallet} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.sellerSubsidy} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.tax} />
                </td>

                {/* Hiệu quả kinh doanh */}
                <td className={cn(cell, BLOCK.result, "text-right text-slate-700")}>
                  <Amount value={r.estRevenue} />
                </td>
                <td className={cn(cell, BLOCK.result, "text-right font-medium text-slate-800")}>
                  <Amount value={r.revenueFromShopee} />
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
        Cột trợ giá VC, người mua trả, nạp ví quảng cáo, thuế đang{" "}
        <b>giữ chỗ (0₫)</b> — sẽ cắm số thật khi có luồng đồng bộ file quyết toán
        Shopee.
      </p>
    </div>
  );
}
