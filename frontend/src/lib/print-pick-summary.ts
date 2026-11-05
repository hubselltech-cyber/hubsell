/**
 * IN THỐNG KÊ BỐC HÀNG: bảng 3 cột Mã SKU · Tên sản phẩm · Số lượng (anh Trung chốt 04/11/2026).
 *
 * In ngay trên trình duyệt từ số liệu popup đã tải, không gọi máy chủ. Bản đầu dựng PDF
 * ở backend: đo 5.000 SKU mất 49 giây và thêm 268 MB RAM trên máy chủ web, nên đã bỏ.
 * Seller muốn giữ file thì chọn Lưu thành PDF trong hộp thoại in.
 */

import type { PickSummaryRow } from "./api";
import { formatDateTime, formatNumber } from "./format";

const FRAME_ID = "hubsell-pick-summary-print";

export interface PickSummaryPrintInput {
  /** Nhóm đơn + bộ lọc đang bật. Tờ giấy không có thanh lọc nên phải ghi rõ. */
  scope: string;
  orders: number;
  totalQty: number;
  expressQty: number;
  rows: PickSummaryRow[];
}

/** Tên và mã do seller đặt trên sàn, phải coi là dữ liệu không tin cậy. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
  @page {
    size: A4;
    margin: 12mm 10mm 14mm;
    @bottom-right { content: "Trang " counter(page) "/" counter(pages); font: 9pt Arial, sans-serif; color: #64748b; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11pt/1.35 Arial, "Helvetica Neue", sans-serif; color: #0f172a; }
  h1 { margin: 0 0 4px; font-size: 16pt; }
  .scope { font-weight: 700; overflow-wrap: anywhere; }
  .meta { color: #475569; font-size: 10pt; }
  .express { margin-top: 2px; color: #b91c1c; font-weight: 700; font-size: 10pt; }
  table { width: 100%; margin-top: 10px; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  th { padding: 6px; background: #f1f5f9; border-bottom: 1.5px solid #0f172a; text-align: left; font-size: 10pt; }
  td { padding: 6px; border-bottom: 1px solid #cbd5e1; vertical-align: top; overflow-wrap: anywhere; }
  tr { break-inside: avoid; }
  .sku { width: 32%; font-weight: 700; }
  .no-sku { color: #64748b; font-weight: 400; }
  .qty { width: 14%; text-align: right; }
  td.qty { font-size: 13pt; font-weight: 700; }
  .qty small { display: block; color: #b91c1c; font-size: 8.5pt; }
  .total td { border-bottom: 0; border-top: 1.5px solid #0f172a; font-weight: 700; }
`;

export function buildPickSummaryHtml(input: PickSummaryPrintInput): string {
  const rows = input.rows
    .map((r) => {
      const sku = r.sku
        ? `<td class="sku">${escapeHtml(r.sku)}</td>`
        : `<td class="sku no-sku">Không có SKU</td>`;
      const express = r.expressQty > 0 ? `<small>Hỏa tốc ${formatNumber(r.expressQty)}</small>` : "";
      return `<tr>${sku}<td>${escapeHtml(r.name)}</td><td class="qty">${formatNumber(r.qty)}${express}</td></tr>`;
    })
    .join("");

  const express =
    input.expressQty > 0
      ? `<p class="express" style="margin-bottom:0">Có ${formatNumber(input.expressQty)} sản phẩm thuộc đơn hỏa tốc, lấy trước.</p>`
      : "";

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Phiếu nhặt hàng</title><style>${STYLE}</style></head><body>
<h1>PHIẾU NHẶT HÀNG</h1>
<div class="scope">${escapeHtml(input.scope)}</div>
<div class="meta">${formatNumber(input.orders)} đơn · ${formatNumber(input.totalQty)} sản phẩm · ${formatNumber(input.rows.length)} SKU · Xuất lúc ${formatDateTime(new Date().toISOString())}</div>
${express}
<table>
<thead><tr><th class="sku">Mã SKU</th><th>Tên sản phẩm</th><th class="qty">Số lượng</th></tr></thead>
<tbody>${rows}<tr class="total"><td colspan="2">Tổng cộng</td><td class="qty">${formatNumber(input.totalQty)}</td></tr></tbody>
</table>
</body></html>`;
}

/** Mở hộp thoại in cho bảng thống kê, dùng khung ẩn để in đúng tờ bảng chứ không in cả trang. */
export function printPickSummary(input: PickSummaryPrintInput): void {
  document.getElementById(FRAME_ID)?.remove();
  const frame = document.createElement("iframe");
  frame.id = FRAME_ID;
  frame.title = "In phiếu nhặt hàng";
  // Không cho chạy script bên trong khung; allow-modals để gọi được hộp thoại in.
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  // Giữ khổ thật và đẩy ra ngoài màn: khung 0px hoặc ẩn hẳn thì Firefox không in được.
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;";
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  };
  frame.srcdoc = buildPickSummaryHtml(input);
  document.body.appendChild(frame);
}
