"use client";

import type { PnlDetailRow } from "@/lib/api";
import {
  TIKTOK_COLUMNS,
  toTiktokRow,
  type TiktokColumnDef,
  type TiktokProfitRow,
} from "@/lib/pnl-mappers";
import { carrierShort } from "@/lib/carrier-meta";
import { formatDateTime, formatVND } from "@/lib/format";
import { formatDayVN } from "@/lib/date-range";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { HintIcon } from "@/components/finance/hint-icon";
import {
  BLOCK,
  Deduction,
  HEADER_COL,
  HEADER_GROUP,
  PNL_STICKY_HEAD,
  PNL_TABLE_SCROLLER,
  PNL_STATUS_LABEL,
  ProductLines,
  ProfitCell,
  ReturnBadge,
  RowCheckTd,
  SelectAllTh,
  type PnlSelection,
} from "./cells";

/**
 * BẢNG LÃI/LỖ THỰC HIỆN — TAB TIKTOK SHOP (làm lại 16/09/2026)
 *
 * Cột = ĐÚNG TÊN PHÍ TikTok Shop VN, mỗi cột một trường của bản kê Finance API
 * 202501 (đã quyết toán) hoặc Get Unsettled Transactions 202507 (số ƯỚC TÍNH
 * CỦA CHÍNH SÀN cho đơn chờ — chữ nghiêng, nhãn "sàn ước tính"). Số hiển thị
 * NGUYÊN DẤU như sàn ghi: âm (đỏ) = sàn trừ, dương (lục) = ghi có. Đơn chưa có
 * dòng nào từ sàn: cột phí trống, tuyệt đối không % tạm tính.
 *
 * Cột nào bằng 0 suốt các dòng đang xem thì tự ẩn (trừ các cột cốt lõi
 * `always`) — chủ shop không phải kéo ngang qua cột trống; Excel vẫn xuất đủ.
 */

/** Ô số CÓ DẤU nguyên bản: âm đỏ, dương lục, 0 hiện "—". */
function Signed({ value }: { value: number }) {
  if (!value) return <span className="text-slate-300">—</span>;
  return (
    <span className={value < 0 ? "text-rose-600" : "text-emerald-600"}>
      {value > 0 ? "+" : "−"}
      {formatVND(Math.abs(value))}
    </span>
  );
}

/** Ô số ƯỚC TÍNH / TẠM TÍNH: nghiêng + mờ + nhãn nhỏ để phân biệt số đã chốt sổ. */
function Provisional({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
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

const GROUP_META: Record<
  TiktokColumnDef["group"],
  { title: string; className: string; cell: string }
> = {
  revenue: { title: "Doanh thu", className: "text-emerald-700", cell: BLOCK.revenue },
  ship: { title: "Phí vận chuyển", className: "text-sky-700", cell: BLOCK.ship },
  fee: { title: "Phí", className: "text-rose-700", cell: BLOCK.fee },
  tax: { title: "Thuế", className: "text-rose-700", cell: BLOCK.fee },
  result: { title: "Điều chỉnh & Kết quả", className: "", cell: BLOCK.result },
};
const GROUP_ORDER: TiktokColumnDef["group"][] = ["revenue", "ship", "fee", "tax", "result"];

/** Ẩn cột bằng 0 suốt kỳ (trừ cột cốt lõi) — luật dùng chung cho bảng. */
export function visibleTiktokColumns(rows: TiktokProfitRow[]): TiktokColumnDef[] {
  return TIKTOK_COLUMNS.filter(
    (c) => c.always || rows.some((r) => Number(r[c.key]) !== 0)
  );
}

export function TiktokProfitTable({
  rows,
  selectedIds,
  allSelected,
  someSelected,
  onToggle,
  onToggleAll,
}: { rows: PnlDetailRow[] } & PnlSelection) {
  const data = rows.map(toTiktokRow);
  const cols = visibleTiktokColumns(data);
  const groups = GROUP_ORDER.map((g) => ({
    group: g,
    cols: cols.filter((c) => c.group === g),
  })).filter((g) => g.cols.length > 0);
  const minWidth = 1180 + cols.length * 128;

  return (
    <div>
    <div className={PNL_TABLE_SCROLLER}>
      <table
        className="w-full border-separate border-spacing-0 text-sm"
        style={{ minWidth }}
      >
        <thead className={PNL_STICKY_HEAD}>
          {/* Tầng nhóm block */}
          <tr>
            <SelectAllTh
              allSelected={allSelected}
              someSelected={someSelected}
              onToggle={onToggleAll}
            />
            <th className={cn(HEADER_GROUP, "text-center")} colSpan={8}>
              Thông tin đơn &amp; Sản phẩm
            </th>
            {groups.map((g) => (
              <th
                key={g.group}
                className={cn(HEADER_GROUP, "text-center", GROUP_META[g.group].className)}
                colSpan={g.cols.length}
              >
                {GROUP_META[g.group].title}
              </th>
            ))}
          </tr>
          {/* Tầng tên cột — tên phí theo TikTok, tooltip = trường API + cách tính */}
          <tr>
            {[
              "Mã đơn",
              "Trạng thái",
              "Shop",
              "Ngày tạo",
              "ĐVVC",
              "Ngày gửi ĐVVC",
              "Khách hàng",
              "Chi tiết sản phẩm",
            ].map((label) => (
              <th key={label} className={cn(HEADER_COL, "text-left")}>
                {label}
              </th>
            ))}
            {cols.map((c) => (
              <th
                key={c.key}
                className={cn(
                  HEADER_COL,
                  "text-right",
                  c.key === "profit" && "font-semibold text-slate-700"
                )}
              >
                {c.hint ? (
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    <HintIcon hint={c.hint} />
                  </span>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {data.map((r) => {
            const b = r.base;
            const cell = "border-t border-slate-100 px-3 py-2.5";
            const soft = r.provisional
              ? "tạm tính"
              : r.estimated
                ? "sàn ước tính"
                : null;
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
                  {b.isSettled ? (
                    <span className="block text-[11px] text-emerald-500">đã đối soát</span>
                  ) : r.detail?.estimated ? (
                    <span className="block text-[11px] text-slate-400">
                      chờ đối soát
                      {r.detail.estimatedSettlementAt
                        ? ` · dự kiến ${formatDayVN(new Date(r.detail.estimatedSettlementAt))}`
                        : ""}
                    </span>
                  ) : null}
                  <ReturnBadge row={b} />
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
                <td className={cn(cell, BLOCK.info, "text-slate-600")}>{b.customerName}</td>
                <td className={cn(cell, BLOCK.info)}>
                  <ProductLines items={b.items} />
                </td>

                {cols.map((c) => {
                  const v = Number(r[c.key]);
                  const meta = GROUP_META[c.group];
                  let node: React.ReactNode;
                  if (c.key === "profit") {
                    node = <ProfitCell value={v} />;
                  } else if (c.key === "costSnapshot") {
                    node = <Deduction value={v} tone="text-slate-600" />;
                  } else if (c.key === "settlementAmount") {
                    node = (
                      <span className={v < 0 ? "text-rose-600" : "text-slate-900"}>
                        {formatVND(v)}
                      </span>
                    );
                  } else if (c.key === "adjustmentAmount") {
                    node = (
                      <div>
                        <Signed value={v} />
                        {r.adjustmentTypes && v !== 0 && (
                          <span className="block text-[10px] leading-tight text-slate-400">
                            {r.adjustmentTypes.replaceAll(",", " · ")}
                          </span>
                        )}
                      </div>
                    );
                  } else {
                    node = <Signed value={v} />;
                  }
                  // Cột từ sàn (không phải giá vốn/lợi nhuận) mà đơn chưa chốt sổ →
                  // chữ nghiêng + nhãn; đơn chưa có dòng nào thì chỉ nhãn ở cột doanh thu.
                  const fromPlatform = c.key !== "costSnapshot" && c.key !== "profit";
                  const showSoft =
                    soft && fromPlatform && (!r.provisional || c.group === "revenue" || c.key === "settlementAmount");
                  return (
                    <td key={c.key} className={cn(cell, meta.cell, "text-right")}>
                      {showSoft ? <Provisional label={soft}>{node}</Provisional> : node}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
      <p className={cn(TEXT_SUB, "px-3 py-2")}>
        Tên cột đúng theo TikTok Shop; số lấy từ <b>bản kê TikTok</b> (Finance
        API 202501, đồng bộ mỗi giờ). Đơn chờ đối soát hiện <b>số ước tính của
        chính sàn</b> (Get Unsettled Transactions), chữ nghiêng — không tự ước
        %. Cột bằng 0 suốt kỳ đang xem tự ẩn; xuất Excel vẫn đủ mọi cột.
      </p>
    </div>
  );
}
