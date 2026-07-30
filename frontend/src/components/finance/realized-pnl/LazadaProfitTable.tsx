"use client";

import type { LazadaSettlementDetail, PnlDetailRow } from "@/lib/api";
import { carrierShort } from "@/lib/carrier-meta";
import { formatDateTime, formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { HintIcon } from "@/components/finance/hint-icon";
import {
  Amount,
  BLOCK,
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
 * Lợi nhuận thực tế = Doanh thu trên sàn (tiền sàn trả về ví) − Giá vốn
 * (khớp Báo cáo dòng tiền).
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

/** Cột header: [nhãn, căn lề, tooltip giải thích (tùy chọn)]. */
type HeadCol = [string, "left" | "right", string?];

/**
 * Bọc số TẠM TÍNH của đơn CHƯA đối soát: nghiêng + mờ + nhãn nhỏ, để phân
 * biệt với số THẬT từ sao kê nhưng vẫn khớp từng xu với thẻ Tổng ở Báo cáo
 * dòng tiền (thẻ Tổng SUM đúng các trường tạm tính này).
 */
function Provisional({ children }: { children: React.ReactNode }) {
  return (
    <div className="italic opacity-70">
      {children}
      <span className="block text-[10px] not-italic leading-tight text-slate-400">
        tạm tính
      </span>
    </div>
  );
}

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
  const minWidth = 900 + (SHIP_COLS.length + PLATFORM_COLS.length + TAX_COLS.length + 5) * 118;
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
            <th className={cn(HEADER_GROUP, "text-center")} colSpan={TAX_COLS.length + 4}>
              Voucher, Thuế &amp; Kết quả
            </th>
          </tr>
          {/* Tầng tên cột — phần tử thứ 3 (nếu có) là tooltip giải thích */}
          <tr>
            {(
              [
                ["Mã đơn", "left"],
                ["Trạng thái", "left"],
                ["Shop", "left"],
                ["Ngày tạo", "left"],
                ["Chi tiết sản phẩm", "left"],
                ["Giá trị đơn hàng", "right"],
                ...SHIP_COLS.map(([l]): HeadCol => [l, "right"]),
                ...PLATFORM_COLS.map(([l]): HeadCol => [l, "right"]),
                ...TAX_COLS.map(([l]): HeadCol => [l, "right"]),
                [
                  "Doanh thu ước tính",
                  "right",
                  "Doanh thu ước tính = Giá trị đơn hàng − giảm giá bằng xu/voucher của Shop. CHƯA trừ phí & thuế sàn — trừ tiếp các khoản đó sẽ ra Doanh thu trên sàn. Gọi là ước tính vì đơn chưa giao thành công/còn hoàn hủy thì chưa phải doanh thu cuối cùng.",
                ],
                [
                  "Doanh thu trên sàn",
                  "right",
                  "Doanh thu thực tế trên sàn — số tiền sàn trả về ví sau khi trừ phí và thuế sàn. Đơn đã đối soát: số THẬT từ sao kê; đơn chưa đối soát: số TẠM TÍNH (chữ nghiêng, mờ) theo % phí kênh + thuế ước tính.",
                ],
                ["Giá vốn sản phẩm", "right"],
                ["LỢI NHUẬN THỰC TẾ", "right"],
              ] as HeadCol[]
            ).map(([label, align, hint], i) => (
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
          {rows.map((b) => {
            const d = b.lazada;
            const cell = "border-t border-slate-100 px-3 py-2.5";
            // Doanh thu ước tính: số sao kê (itemRevenue) khi đã đối soát;
            // chưa đối soát hiển thị doanh thu gốc của đơn (KHÔNG phải phí ước
            // tính — chỉ là giá bán thật của đơn).
            // LƯU Ý: đơn CHƯA quyết toán vẫn có thể CÓ bản ghi sao kê MỘT PHẦN
            // (chi tiết phí vận chuyển đồng bộ sớm từ Order API) — itemRevenue/
            // actualPayout khi đó còn bằng 0. Vì vậy các cột KẾT QUẢ chỉ tin số
            // sao kê khi ĐÃ ĐỐI SOÁT THẬT (isSettled), còn lại dùng số của đơn.
            const settled = b.isSettled && d;
            const isCancelled = b.shippingStatus === "CANCELLED";
            // Đơn chưa đối soát (trừ đơn hủy) hiển thị SỐ TẠM TÍNH — đúng các
            // trường computePnlRow mà thẻ Tổng Báo cáo dòng tiền đang SUM
            // ("Lợi nhuận dự kiến"), để hai màn hình khớp nhau từng xu.
            const provisional = !settled && !isCancelled;
            const estRevenue = settled ? d.itemRevenue : b.revenueGross;
            // Doanh thu ước tính = Giá trị đơn hàng − giảm giá bằng xu/voucher
            // của Shop. Đã đối soát: cộng sellerVoucher CÓ DẤU của sao kê (âm =
            // sàn trừ); chưa đối soát: số gốc từ đơn (actualRevenue).
            const actualRevenue = settled
              ? d.itemRevenue + d.sellerVoucher
              : (b.actualRevenue ?? b.revenueGross - b.sellerVoucher);
            // Tiền dự kiến sàn trả về ví = doanh thu thuần − thuế ước tính
            // (ghép từ 2 trường SSOT của dòng, không chế công thức mới).
            const expectedPayout = b.netRevenue - b.platformTax;
            const profit = settled ? d.actualPayout - b.costSnapshot : null;
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

                {/* Phí nền tảng — số CÓ DẤU nguyên bản. Đơn chưa đối soát:
                    phí sàn TẠM TÍNH theo % kênh dồn vào cột "Phí cố định"
                    (đúng bucket feeFixedPayment backend đang dùng để tính tổng). */}
                {PLATFORM_COLS.map(([label, pick]) => (
                  <td key={label} className={cn(cell, BLOCK.fee, "text-right")}>
                    {provisional && label === "Phí cố định" && b.feeFixedPayment ? (
                      <Provisional>
                        <Signed value={-b.feeFixedPayment} />
                      </Provisional>
                    ) : settled ? (
                      <Signed value={pick(d)} />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                ))}

                {/* Thuế & Kết quả */}
                {TAX_COLS.map(([label, pick]) => (
                  <td key={label} className={cn(cell, BLOCK.result, "text-right")}>
                    {d ? <Signed value={pick(d)} /> : <span className="text-slate-300">—</span>}
                  </td>
                ))}
                {/* Doanh thu ước tính — xanh, nhóm doanh thu */}
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  <Amount value={actualRevenue} tone="font-medium text-emerald-700" />
                </td>
                {/* Doanh thu trên sàn — đã đối soát: tiền THẬT sàn trả về ví;
                    chưa đối soát: số TẠM TÍNH (doanh thu thuần − thuế ước tính) */}
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  {settled ? (
                    <Amount value={d.actualPayout} tone="font-medium text-emerald-700" />
                  ) : provisional ? (
                    <Provisional>
                      <Amount value={expectedPayout} tone="font-medium text-emerald-700" />
                    </Provisional>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                {/* Giá vốn — SỐ DƯƠNG (đúng như Cấu hình giá vốn nhập), chữ ĐỎ
                    thể hiện chi phí giảm trừ; backend vẫn TRỪ trong lợi nhuận. */}
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  <Amount value={b.costSnapshot} tone="text-rose-600" />
                </td>
                {/* Lợi nhuận — đã đối soát: số THẬT; chưa: TẠM TÍNH (profitAfterTax,
                    đúng trường thẻ Tổng đang SUM thành "Lợi nhuận dự kiến") */}
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  {profit != null ? (
                    <ProfitCell value={profit} />
                  ) : provisional ? (
                    <Provisional>
                      <ProfitCell value={b.profitAfterTax} />
                    </Provisional>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={cn(TEXT_SUB, "px-3 py-2")}>
        Đơn <b>đã đối soát</b>: mọi con số lấy <b>nguyên bản từ sao kê Finance
        API của Lazada</b> (âm = sàn trừ, dương = ghi có). Đơn <b>chưa đối
        soát</b>: hiển thị <b>số tạm tính</b> (chữ nghiêng, mờ) — phí sàn theo %
        kênh dồn ở cột &quot;Phí cố định&quot;, Doanh thu trên sàn &amp; Lợi nhuận
        đã trừ thuế ước tính — SUM các số này đúng bằng dòng &quot;Lợi nhuận dự
        kiến&quot; trên Báo cáo dòng tiền. <b>Doanh thu ước tính</b> = Giá trị
        đơn hàng − giảm giá bằng xu/voucher của Shop. <b>Doanh thu trên sàn</b> =
        tiền sàn trả về ví sau khi trừ phí &amp; thuế sàn. <b>Lợi nhuận thực
        tế</b> = Doanh thu trên sàn − Giá vốn sản phẩm (giá vốn hiển thị số dương
        màu đỏ, vẫn được TRỪ khi tính lợi nhuận).
      </p>
    </div>
  );
}
