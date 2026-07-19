import type { Order } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { carrierLabel } from "@/lib/carrier-meta";
import { formatVND, formatDateTime } from "@/lib/format";

/**
 * IN PHIẾU GIAO HÀNG HÀNG LOẠT
 *
 * ⚠️ Đây là phiếu do HUBSELL tự dựng từ dữ liệu đơn, KHÔNG phải file vận đơn
 * chính thức của sàn. Muốn in đúng phiếu của Shopee/TikTok thì phải có tích hợp
 * API thật kèm quyền in vận đơn — Hubsell hiện dùng sàn giả lập nên chưa lấy
 * được. Phiếu này vẫn dùng được để dán kiện hàng và soát hàng khi đóng gói.
 *
 * Cách làm: dựng một trang HTML gồm nhiều phiếu, mỗi phiếu một trang giấy, rồi
 * gọi hộp thoại in của trình duyệt. Không cần thư viện PDF nào — chủ shop bấm
 * "In" một lần là ra cả xấp, hoặc chọn "Lưu thành PDF" nếu muốn file.
 */

function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
}

function labelHtml(order: Order): string {
  const channel = CHANNEL_META[order.channel.channelName];
  const rows = (order.items ?? [])
    .map(
      (i) => `
      <tr>
        <td>${esc(i.productName)}<div class="sku">${esc(i.channelSku)}</div></td>
        <td class="qty">×${esc(i.quantity)}</td>
      </tr>`
    )
    .join("");

  return `
  <section class="label">
    <header>
      <div>
        <div class="channel">${esc(channel.label)}</div>
        <div class="code">${esc(order.orderCode)}</div>
      </div>
      <div class="right">
        <div class="carrier">${esc(carrierLabel(order.carrier))}</div>
        <div class="tracking">${esc(order.trackingCode ?? "—")}</div>
      </div>
    </header>

    <div class="box">
      <div class="row"><span class="k">Người nhận</span><span class="v strong">${esc(order.customerName)}</span></div>
      <div class="row"><span class="k">Điện thoại</span><span class="v">${esc(order.customerPhone ?? "—")}</span></div>
      <div class="row"><span class="k">Ngày đặt</span><span class="v">${esc(formatDateTime(order.createdAt))}</span></div>
    </div>

    <table>
      <thead><tr><th>Sản phẩm</th><th class="qty">SL</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="2">(không có chi tiết dòng hàng)</td></tr>'}</tbody>
    </table>

    <div class="total"><span>Tổng tiền</span><b>${esc(formatVND(order.totalAmount))}</b></div>
    <footer>Phiếu do Hubsell tạo — không phải vận đơn chính thức của sàn</footer>
  </section>`;
}

export function printOrderLabels(orders: Order[]): boolean {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return false; // trình duyệt chặn popup

  win.document.write(`<!doctype html>
<html lang="vi"><head><meta charset="utf-8" />
<title>Phiếu giao hàng (${orders.length} đơn)</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, "Segoe UI", Arial, sans-serif; color: #0f172a; }
  .label { padding: 16mm 14mm; page-break-after: always; }
  .label:last-child { page-break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #0f172a; padding-bottom: 10px; }
  .channel { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #475569; }
  .code { font-size: 22px; font-weight: 800; letter-spacing: -.01em; }
  .right { text-align: right; }
  .carrier { font-size: 14px; font-weight: 600; }
  .tracking { font-family: ui-monospace, Consolas, monospace; font-size: 16px; font-weight: 700; }
  .box { margin: 14px 0; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; }
  .row { display: flex; gap: 12px; padding: 3px 0; font-size: 14px; }
  .k { width: 96px; color: #64748b; flex: none; }
  .v.strong { font-weight: 700; font-size: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { text-align: left; border-bottom: 1px solid #e2e8f0; padding: 7px 4px; font-size: 14px; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #475569; }
  .qty { text-align: right; white-space: nowrap; }
  .sku { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: #64748b; }
  .total { display: flex; justify-content: space-between; margin-top: 10px;
           padding-top: 8px; border-top: 2px solid #0f172a; font-size: 16px; }
  footer { margin-top: 10px; font-size: 10px; color: #94a3b8; }
  @page { size: A5; margin: 0; }
  @media print { .label { padding: 10mm; } }
</style></head><body>${orders.map(labelHtml).join("")}</body></html>`);
  win.document.close();

  // Đợi trình duyệt dựng xong trang rồi mới mở hộp thoại in, nếu không sẽ in ra
  // trang trắng ở một số máy.
  win.onload = () => {
    win.focus();
    win.print();
  };
  return true;
}
