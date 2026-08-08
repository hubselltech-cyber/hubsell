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
  ReturnBadge,
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
 * Bọc số CHƯA CHỐT SỔ của đơn chưa đối soát: nghiêng + mờ + nhãn nhỏ, để phân
 * biệt với số THẬT từ sao kê (chữ đứng, đậm). Đơn đối soát xong thì sao kê
 * Finance API đè vào và bỏ kiểu chữ này ("chốt sổ").
 */
function Provisional({
  children,
  label = "chờ đối soát",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <div className="italic opacity-70">
      {children}
      <span className="block text-[10px] not-italic leading-tight text-slate-400">
        {label}
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
                  "= Giá trị sản phẩm − TOÀN BỘ phí & thuế sàn đã ghi nhận (cộng đại số các cột phí/thuế/voucher từ sao kê). Dùng để ĐỐI SOÁT: đơn đã đối soát, con số này phải khớp chằn chặn với 'Doanh thu trên sàn' (Tổng tiền sàn báo) — lệch tức là sót/phân loại thiếu phí.",
                ],
                [
                  "Doanh thu trên sàn",
                  "right",
                  "DOANH THU THỰC TẾ — 'Tổng tiền' từ API Lazada: số tiền sàn trả về ví sau khi đã cấn trừ hết các loại phí, thuế, xu. Đơn chưa thành công: hiển thị số từ API đơn hàng, kèm nhãn tạm tính (nghiêng, mờ).",
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
            // LƯU Ý: đơn CHƯA quyết toán vẫn có thể CÓ bản ghi sao kê MỘT PHẦN
            // (chi tiết phí vận chuyển đồng bộ sớm từ Order API) — itemRevenue/
            // actualPayout khi đó còn bằng 0. Vì vậy các cột KẾT QUẢ chỉ tin số
            // sao kê khi ĐÃ ĐỐI SOÁT THẬT (isSettled), còn lại dùng số của đơn.
            const settled = b.isSettled && d;
            const isCancelled = b.shippingStatus === "CANCELLED";
            // Đơn chưa đối soát (trừ đơn hủy): các cột phí ĐỂ TRỐNG ("chờ đối
            // soát" — sổ đối soát không bịa phí %); doanh thu hiển thị theo số
            // API đơn hàng, nghiêng mờ "tạm tính" chờ sao kê chốt sổ.
            const provisional = !settled && !isCancelled;
            // Giá trị đơn hàng = [Giá trị sản phẩm] thô — KHÔNG phải doanh thu.
            const orderValue = b.revenueGross;
            // DOANH THU ƯỚC TÍNH (để đối soát) = Giá trị sản phẩm − toàn bộ
            // phí & thuế sàn đã ghi nhận (cộng đại số các cột sao kê). Đơn đã
            // đối soát phải KHỚP CHẰN CHẶN với "Doanh thu trên sàn" — lệch là
            // sót phí. Chưa đối soát: trừ những khoản đã biết từ đơn (voucher).
            const estRevenue = settled
              ? [...PLATFORM_COLS, ...TAX_COLS].reduce(
                  (s, [, pick]) => s + pick(d),
                  d.itemRevenue
                )
              : (b.actualRevenue ?? b.revenueGross - b.sellerVoucher);
            // DOANH THU TRÊN SÀN = [Doanh thu thực tế] — "Tổng tiền" API sàn
            // báo (đã cấn trừ hết phí/thuế/xu); chưa đối soát = số API đơn hàng.
            const platformRevenue = settled ? d.actualPayout : b.platformRevenue;
            // LỢI NHUẬN THỰC TẾ = Doanh thu thực tế − Giá vốn. KHÔNG trừ thêm
            // cột đỏ nào nữa — chúng đã nằm sẵn trong "Tổng tiền" sàn báo.
            const profit = settled ? d.actualPayout - b.costSnapshot : null;
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
                  <ReturnBadge row={b} />
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

                {/* Giá trị đơn hàng — [Giá trị sản phẩm] thô */}
                <td className={cn(cell, BLOCK.revenue, "text-right")}>
                  <Amount value={orderValue} tone="font-medium text-slate-800" />
                </td>

                {/* Chi tiết phí vận chuyển — số CÓ DẤU nguyên bản */}
                {SHIP_COLS.map(([label, pick]) => (
                  <td key={label} className={cn(cell, BLOCK.ship, "text-right")}>
                    {d ? <Signed value={pick(d)} /> : <span className="text-slate-300">—</span>}
                  </td>
                ))}

                {/* Phí nền tảng — CHỈ số CÓ DẤU nguyên bản từ sao kê. Đơn chưa
                    đối soát: ĐỂ TRỐNG (chờ đối soát) — tuyệt đối không ước %. */}
                {PLATFORM_COLS.map(([label, pick]) => (
                  <td key={label} className={cn(cell, BLOCK.fee, "text-right")}>
                    {settled ? (
                      <Signed value={pick(d)} />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                ))}

                {/* Thuế & Voucher. Đơn chưa đối soát: "Voucher người bán" là
                    dữ liệu THẬT từ đơn gốc (giá gốc − giá khách trả) nên vẫn
                    hiện (nghiêng mờ); thuế thì chờ sao kê, để trống. */}
                {TAX_COLS.map(([label, pick]) => (
                  <td key={label} className={cn(cell, BLOCK.result, "text-right")}>
                    {provisional && label === "Voucher người bán" && b.sellerVoucher ? (
                      <Provisional label="từ đơn gốc">
                        <Signed value={-b.sellerVoucher} />
                      </Provisional>
                    ) : settled ? (
                      <Signed value={pick(d)} />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                ))}
                {/* Doanh thu ước tính — Giá trị SP − Σ phí/thuế (đối soát) */}
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  {provisional ? (
                    <Provisional label="tạm tính">
                      <Amount value={estRevenue} tone="font-medium text-emerald-700" />
                    </Provisional>
                  ) : (
                    <Amount value={estRevenue} tone="font-medium text-emerald-700" />
                  )}
                </td>
                {/* Doanh thu trên sàn — [Doanh thu thực tế] "Tổng tiền" sàn
                    báo: đã đối soát = số THẬT (chốt sổ: chữ đứng, đậm); chưa =
                    số API đơn hàng, nghiêng mờ "tạm tính". */}
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  {settled ? (
                    <Amount
                      value={platformRevenue}
                      tone="font-semibold text-emerald-700"
                    />
                  ) : provisional ? (
                    <Provisional label="tạm tính">
                      <Amount
                        value={platformRevenue}
                        tone="font-medium text-emerald-700"
                      />
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
                {/* Lợi nhuận = Doanh thu thực tế − Giá vốn (không trừ thêm cột
                    đỏ — đã nằm trong "Tổng tiền" sàn báo); chưa đối soát: tính
                    trên số API đơn hàng, nhãn "tạm tính" (đúng trường thẻ Tổng
                    SUM thành "Lợi nhuận dự kiến") */}
                <td className={cn(cell, BLOCK.result, "text-right")}>
                  {profit != null ? (
                    <ProfitCell value={profit} />
                  ) : provisional ? (
                    <Provisional label="tạm tính">
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
        Bảng này là <b>sổ đối soát với sàn</b>. <b>Giá trị đơn hàng</b> = [Giá
        trị sản phẩm] thô — không phải doanh thu. <b>Doanh thu ước tính</b> =
        Giá trị sản phẩm − toàn bộ phí &amp; thuế sàn đã ghi nhận (cộng đại số
        các cột đỏ); <b>Doanh thu trên sàn</b> = [Doanh thu thực tế] — &quot;Tổng
        tiền&quot; API sàn báo sau khi cấn trừ hết phí/thuế/xu — <b>đơn đã đối
        soát hai cột phải khớp chằn chặn</b>, lệch tức là sót phí. <b>Lợi nhuận
        thực tế</b> = Doanh thu thực tế − Giá vốn sản phẩm (KHÔNG trừ thêm cột
        đỏ nào nữa — chúng đã nằm trong Tổng tiền). Đơn <b>đã đối soát</b>: số
        nguyên bản sao kê Finance API (âm = sàn trừ, dương = ghi có), chữ đứng
        đậm = chốt sổ. Đơn <b>chưa đối soát</b> (nghiêng, mờ &quot;tạm
        tính&quot;): doanh thu &amp; lợi nhuận tính từ số API đơn hàng; cột
        phí/thuế để trống — hệ thống KHÔNG ước phí %, sàn báo phát sinh nào cột
        đó cập nhật ngay.
      </p>
    </div>
  );
}
