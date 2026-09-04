"use client";

import type { PnlDetailRow } from "@/lib/api";
import { toShopeeRow } from "@/lib/pnl-mappers";
import { carrierShort } from "@/lib/carrier-meta";
import { formatDateTime } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { HintIcon } from "@/components/finance/hint-icon";
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
 * BẢNG LÃI/LỖ THỰC HIỆN — TAB SHOPEE
 *
 * Cột thiết kế riêng theo cấu trúc phí Shopee (tham chiếu file quyết toán
 * Salework). Nhóm cột tô nền: thông tin đơn (trắng), doanh thu (xanh), phí vận
 * chuyển (lam), phí sàn & thuế (đỏ), hiệu quả kinh doanh (xám). Cột "Người mua
 * trả" chưa có dữ liệu thật, hiện GIỮ CHỖ 0đ.
 */
export function ShopeeProfitTable({
  rows,
  selectedIds,
  allSelected,
  someSelected,
  onToggle,
  onToggleAll,
}: { rows: PnlDetailRow[] } & PnlSelection) {
  const data = rows.map(toShopeeRow);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1940px] border-separate border-spacing-0 text-sm">
        <thead>
          {/* Tầng nhóm block — tiêu đề nhóm căn giữa trên các cột con */}
          <tr>
            <SelectAllTh
              allSelected={allSelected}
              someSelected={someSelected}
              onToggle={onToggleAll}
            />
            <th className={cn(HEADER_GROUP, "text-center")} colSpan={6}>
              Thông tin đơn &amp; Sản phẩm
            </th>
            <th className={cn(HEADER_GROUP, "text-center text-emerald-700")} colSpan={2}>
              Doanh thu &amp; Trợ giá
            </th>
            <th className={cn(HEADER_GROUP, "text-center text-sky-700")} colSpan={6}>
              Phí vận chuyển
            </th>
            <th className={cn(HEADER_GROUP, "text-center text-rose-700")} colSpan={7}>
              Phí sàn &amp; Thuế
            </th>
            <th className={cn(HEADER_GROUP, "text-center")} colSpan={4}>
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
              ["Chi tiết sản phẩm", "left"],
              ["Tổng giá trị SP", "right"],
              ["Trợ giá Shopee", "right"],
              ["Phí VC Dự kiến", "right"],
              ["Phí VC Thực tế", "right"],
              ["Trợ giá VC Shopee", "right"],
              ["Trợ giá VC Shop", "right"],
              ["Người mua trả", "right"],
              ["Chênh lệch phí VC", "right"],
              ["Phí sàn (CĐ+TT)", "right"],
              ["Phí TTLK (Affiliate)", "right"],
              ["Phí DV (Xtra)", "right"],
              ["PiShip", "right"],
              ["Nạp ví quảng cáo", "right"],
              ["Trợ giá người bán", "right"],
              ["Thuế", "right"],
              [
                "Doanh thu ước tính",
                "right",
                "= Giá trị sản phẩm − toàn bộ phí & thuế sàn đã ghi nhận (+ Trợ giá Shopee bù thật). Dùng để ĐỐI SOÁT: đơn đã đối soát, con số này phải khớp chằn chặn với 'Doanh thu từ Shopee' — lệch tức là sót/phân loại thiếu phí, hoặc đơn bị hoàn.",
              ],
              [
                "Doanh thu từ Shopee",
                "right",
                "'Doanh Thu Đơn Hàng' Shopee báo (escrow_amount): tiền sàn trả về ví sau khi cấn trừ hết phí/thuế. Đơn chưa giải ngân: hiển thị số ƯỚC TÍNH của chính Shopee (khớp màn Chi tiết doanh thu trên Seller Center), nhãn 'chờ đối soát'.",
              ],
              ["Chi phí giá vốn", "right"],
              ["LỢI NHUẬN THỰC TẾ", "right"],
            ].map(([label, align, hint], i) => (
              <th
                key={i}
                className={cn(
                  HEADER_COL,
                  align === "right" ? "text-right" : "text-left",
                  label === "LỢI NHUẬN THỰC TẾ" && "font-semibold text-slate-700"
                )}
              >
                {hint ? (
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <HintIcon hint={hint} />
                  </span>
                ) : (
                  label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {data.map((r) => {
            const b = r.base;
            const cell = "border-t border-slate-100 px-3 py-2.5";
            return (
              <tr
                key={b.id}
                className={cn(
                  "transition-colors hover:bg-primary/[0.04]",
                  // Đơn đang tích chọn: tô nền + đậm cả dòng cho dễ theo dõi.
                  selectedIds.has(b.id) && "bg-primary/[0.07] font-semibold"
                )}
              >
                <RowCheckTd
                  checked={selectedIds.has(b.id)}
                  onToggle={() => onToggle(b)}
                  label={`Chọn đơn ${b.orderCode}`}
                />
                {/* Thông tin đơn */}
                <td className={cn(cell, BLOCK.info)}>
                  <span className="text-slate-900">{b.orderCode}</span>
                  {b.missingCostPrice && (
                    <span className="mt-0.5 block text-[11px] text-amber-600">
                      Chưa nhập giá vốn
                    </span>
                  )}
                </td>
                <td className={cn(cell, BLOCK.info)}>
                  <span className="whitespace-nowrap text-slate-700">
                    {PNL_STATUS_LABEL[b.shippingStatus] ?? b.shippingStatus}
                  </span>
                  {b.isSettled && (
                    <span className="block text-[11px] text-emerald-500">đã đối soát</span>
                  )}
                  <ReturnBadge row={b} />
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
                  <Amount value={r.revenueGross} tone="text-slate-900" />
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
                  <ShipDiff value={r.shipDiff} />
                </td>

                {/* Phí sàn & thuế (âm) */}
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.feePlatform} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.feeAffiliate} />
                </td>
                <td className={cn(cell, BLOCK.fee, "text-right")}>
                  <Deduction value={r.feeServiceXtra} />
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

                {/* Hiệu quả kinh doanh — 2 cột doanh thu XANH, giá vốn ĐỎ
                    (đồng bộ quy ước màu với tab Lazada). */}
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  <Amount value={r.estRevenue} tone="font-medium text-emerald-700" />
                </td>
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  <Amount value={r.revenueFromShopee} tone="font-medium text-emerald-700" />
                </td>
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  <Amount value={r.costSnapshot} tone="text-rose-600" />
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
        Đơn <b>đã đối soát</b> nhận số thật từ Escrow API (Đồng bộ đối soát) —
        mỗi loại phí về đúng cột của nó. Riêng cột{" "}
        <b>Người mua trả, Trợ giá VC Shop, Nạp ví quảng cáo</b> escrow không có
        nguồn — giữ chỗ 0₫. &quot;Doanh thu từ Shopee&quot; = tiền thực về ví
        (escrow_amount), là gốc tính lợi nhuận.
      </p>
    </div>
  );
}
