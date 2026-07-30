"use client";

import type { LazadaSettlementDetail, PnlDetailRow } from "@/lib/api";
import { carrierShort } from "@/lib/carrier-meta";
import { formatDateTime, formatVND } from "@/lib/format";
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
  RowCheckTd,
  SelectAllTh,
  type PnlSelection,
} from "./cells";

/**
 * BẢNG LÃI/LỖ THỰC HIỆN — TAB LAZADA
 *
 * 100% SỐ THẬT từ sao kê Finance API (/finance/transaction/details/get), hiển
 * thị NGUYÊN DẤU như Lazada ghi nhận: âm (đỏ) = sàn trừ, dương (lục) = ghi có.
 * Đơn CHƯA đối soát để trống toàn bộ cột phí — tuyệt đối không % tạm tính.
 * Lợi nhuận thực tế = Tiền thực về ví − Giá vốn (khớp Báo cáo dòng tiền).
 */

/** Ô số CÓ DẤU nguyên bản sao kê: âm đỏ, dương lục, 0/null hiện "—". */
function Signed({ value }: { value: number | null | undefined }) {
  if (!value) return <span className="text-slate-300">—</span>;
  return (
    <span className={value < 0 ? "text-rose-600" : "text-emerald-600"}>
      {value > 0 ? "+" : "−"}
      {formatVND(Math.abs(value))}
    </span>
  );
}

/** Nhóm cột: [nhãn, hàm lấy giá trị từ sao kê chi tiết]. */
type Col = [string, (d: LazadaSettlementDetail) => number];

const SHIP_COLS: Col[] = [
  ["Phí vận chuyển", (d) => d.shipFee],
  ["Khách trả", (d) => d.shipFeeCustomer],
  ["Giảm giá nền tảng", (d) => d.shipDiscountPlatform],
  ["Giảm giá người bán", (d) => d.shipDiscountSeller],
  ["Phí VC hoàn", (d) => d.shipFeeReturn],
  [
    // Phần ship SHOP THỰC CHỊU = cước gốc − nền tảng bù − người bán giảm −
    // khách trả (+ hoàn/điều chỉnh nếu có). 0 = khách + sàn đã gánh đủ cước.
    "Chênh lệch",
    (d) =>
      -(d.shipFee + d.shipDiscountPlatform + d.shipDiscountSeller - d.shipFeeCustomer) +
      d.shipFeeReturn +
      d.shipFeeAdjustment,
  ],
];

const PLATFORM_COLS: Col[] = [
  ["Phí cố định", (d) => d.feeFixed],
  ["Phí xử lý đơn hàng", (d) => d.feeOrderProcessing],
  ["Phí thanh toán", (d) => d.feePayment],
  ["Phí hoa hồng", (d) => d.feeCommission],
  ["Phí VC người bán trả", (d) => d.feeShipSeller],
  ["Trợ giá VC (người bán)", (d) => d.shipSubsidySeller],
  ["Phí Freeship Max", (d) => d.feeFreeshipMax],
  ["Phí Cashback Max", (d) => d.feeCashbackMax],
  ["Phí Discovery tài trợ", (d) => d.feeSponsoredDiscovery],
  ["Phí Lazada Bonus", (d) => d.feeLazadaBonus],
  ["LZD đồng tài trợ", (d) => d.bonusLzdCofund],
  ["Phí đánh giá người mua", (d) => d.feeBuyerReview],
  ["Hoa hồng Lazpick/LazTop", (d) => d.feeLazpick],
  ["Điều chỉnh phí VC", (d) => d.shipFeeAdjustment],
  ["Phí chiến dịch", (d) => d.feeCampaign],
  ["Phí tiếp thị liên kết", (d) => d.feeAffiliate],
  ["Phí hạ tầng", (d) => d.feeInfrastructure],
  ["Phí khác", (d) => d.feeOther],
  ["Trợ giá từ sàn", (d) => d.subsidyOther],
];

const TAX_COLS: Col[] = [
  ["Voucher người bán", (d) => d.sellerVoucher],
  ["Thuế GTGT", (d) => d.vatFee],
  ["Thuế TNCN", (d) => d.incomeTaxFee],
];

export function LazadaProfitTable({
  rows,
  selectedIds,
  allSelected,
  someSelected,
  onToggle,
  onToggleAll,
}: { rows: PnlDetailRow[] } & PnlSelection) {
  const minWidth = 900 + (SHIP_COLS.length + PLATFORM_COLS.length + TAX_COLS.length + 4) * 118;
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-separate border-spacing-0 text-sm"
        style={{ minWidth }}
      >
        <thead>
          {/* Tầng nhóm block */}
          <tr>
            <SelectAllTh
              allSelected={allSelected}
              someSelected={someSelected}
              onToggle={onToggleAll}
            />
            <th className={cn(HEADER_GROUP, "text-center")} colSpan={5}>
              Thông tin đơn &amp; Sản phẩm
            </th>
            <th className={cn(HEADER_GROUP, "text-center text-emerald-700")} colSpan={1}>
              Doanh thu
            </th>
            <th className={cn(HEADER_GROUP, "text-center text-sky-700")} colSpan={SHIP_COLS.length}>
              Chi tiết phí vận chuyển
            </th>
            <th
              className={cn(HEADER_GROUP, "text-center text-rose-700")}
              colSpan={PLATFORM_COLS.length}
            >
              Phí nền tảng
            </th>
            <th className={cn(HEADER_GROUP, "text-center")} colSpan={TAX_COLS.length + 3}>
              Voucher, Thuế &amp; Kết quả
            </th>
          </tr>
          {/* Tầng tên cột */}
          <tr>
            {(
              [
                ["Mã đơn", "left"],
                ["Trạng thái", "left"],
                ["Shop", "left"],
                ["Ngày tạo", "left"],
                ["Chi tiết sản phẩm", "left"],
                ["Doanh thu ước tính", "right"],
                ...SHIP_COLS.map(([l]) => [l, "right"] as const),
                ...PLATFORM_COLS.map(([l]) => [l, "right"] as const),
                ...TAX_COLS.map(([l]) => [l, "right"] as const),
                ["Tiền thực về ví", "right"],
                ["Giá vốn sản phẩm", "right"],
                ["LỢI NHUẬN THỰC TẾ", "right"],
              ] as const
            ).map(([label, align], i) => (
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
            const d = b.lazada;
            const cell = "border-t border-slate-100 px-3 py-2.5";
            // Doanh thu ước tính: số sao kê (itemRevenue) khi đã đối soát;
            // chưa đối soát hiển thị doanh thu gốc của đơn (KHÔNG phải phí ước
            // tính — chỉ là giá bán thật của đơn).
            const estRevenue = d ? d.itemRevenue : b.revenueGross;
            const profit = d ? d.actualPayout - b.costSnapshot : null;
            return (
              <tr key={b.id} className="transition-colors hover:bg-primary/[0.04]">
                <RowCheckTd
                  checked={selectedIds.has(b.id)}
                  onToggle={() => onToggle(b)}
                  label={`Chọn đơn ${b.orderCode}`}
                />
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
                  {b.isSettled ? (
                    <span className="block text-[11px] text-emerald-500">đã đối soát</span>
                  ) : (
                    <span className="block text-[11px] text-amber-500">chưa đối soát</span>
                  )}
                </td>
                <td className={cn(cell, BLOCK.info, "text-slate-600")}>
                  {b.shopName}
                  {b.carrier ? (
                    <span className="block text-[11px] text-slate-400">
                      {carrierShort(b.carrier)}
                    </span>
                  ) : null}
                </td>
                <td className={cn(cell, BLOCK.info)}>
                  <span className="text-slate-700">{formatDateTime(b.createdAt)}</span>
                </td>
                <td className={cn(cell, BLOCK.info)}>
                  <ProductLines items={b.items} />
                </td>

                {/* Doanh thu */}
                <td className={cn(cell, BLOCK.revenue, "text-right")}>
                  <Amount value={estRevenue} tone="font-medium text-slate-800" />
                </td>

                {/* Chi tiết phí vận chuyển — số CÓ DẤU nguyên bản */}
                {SHIP_COLS.map(([label, pick]) => (
                  <td key={label} className={cn(cell, BLOCK.ship, "text-right")}>
                    {d ? <Signed value={pick(d)} /> : <span className="text-slate-300">—</span>}
                  </td>
                ))}

                {/* Phí nền tảng — số CÓ DẤU nguyên bản */}
                {PLATFORM_COLS.map(([label, pick]) => (
                  <td key={label} className={cn(cell, BLOCK.fee, "text-right")}>
                    {d ? <Signed value={pick(d)} /> : <span className="text-slate-300">—</span>}
                  </td>
                ))}

                {/* Thuế & Kết quả */}
                {TAX_COLS.map(([label, pick]) => (
                  <td key={label} className={cn(cell, BLOCK.result, "text-right")}>
                    {d ? <Signed value={pick(d)} /> : <span className="text-slate-300">—</span>}
                  </td>
                ))}
                <td className={cn(cell, BLOCK.result, "text-right font-medium text-slate-800")}>
                  {d ? (
                    <Amount value={d.actualPayout} />
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  <Deduction value={b.costSnapshot} tone="text-slate-600" />
                </td>
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  {profit == null ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <ProfitCell value={profit} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={cn(TEXT_SUB, "px-3 py-2")}>
        Mọi con số lấy <b>nguyên bản từ sao kê Finance API của Lazada</b> (âm = sàn
        trừ, dương = ghi có) — đơn <b>chưa đối soát</b> để trống, không dùng %
        tạm tính. Lợi nhuận thực tế = Tiền thực về ví − Giá vốn sản phẩm.
      </p>
    </div>
  );
}
