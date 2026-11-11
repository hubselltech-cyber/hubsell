// CỔNG payOS GIẢ LẬP cho DEV LOCAL — để thử trọn luồng thanh toán (mua gói, trả phí vượt)
// mà không cần khóa payOS thật và không có tiền thật nào chạy.
//
// Chạy kèm backend qua cấu hình "backend-http-payos" trong .claude/launch.json (đặt
// PAYOS_API_BASE=http://localhost:4099 + ba khóa giả). KHÔNG bao giờ dùng trên prod.
//
//   POST /v2/payment-requests            → tạo link (trả tài khoản + chuỗi QR giả)
//   GET  /v2/payment-requests/:id        → trạng thái (backend hỏi mỗi 3 giây khi hộp QR mở)
//   POST /v2/payment-requests/:id/cancel → hủy
//   GET  /mock/pay/:orderCode            → GIẢ LẬP TIỀN VỀ cho đơn đó (mở bằng trình duyệt / curl)
//
// checkoutUrl để trống có chủ đích: hộp thanh toán của Hubsell khi đó hiện mã QR của chính
// mình (đường dự phòng "Dùng mã QR của Hubsell") thay vì nhúng trang pay.payos.vn.
import { createServer } from "node:http";

const PORT = Number(process.env.PAYOS_MOCK_PORT ?? 4099);
const orders = new Map(); // orderCode (chuỗi) → đơn

const pad = (n) => String(n).padStart(2, "0");
function vnNow() {
  const d = new Date(Date.now() + 7 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
const ok = (res, data) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ code: "00", desc: "success", data }));
};
const info = (o) => ({
  id: o.paymentLinkId,
  orderCode: Number(o.orderCode),
  amount: o.amount,
  amountPaid: o.status === "PAID" ? o.amount : 0,
  amountRemaining: o.status === "PAID" ? 0 : o.amount,
  status: o.status,
  createdAt: o.createdAt,
  transactions:
    o.status === "PAID"
      ? [{ reference: o.reference, amount: o.amount, description: o.description, transactionDateTime: o.paidAt }]
      : [],
});

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.method === "POST" && url.pathname === "/v2/payment-requests") {
      const b = JSON.parse(raw || "{}");
      const o = {
        orderCode: String(b.orderCode),
        amount: b.amount,
        description: b.description,
        paymentLinkId: `mock-${b.orderCode}`,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      };
      orders.set(o.orderCode, o);
      console.log(`[payos-mock] Tạo link ${o.orderCode} — ${o.amount.toLocaleString("vi-VN")}₫ — "${o.description}"`);
      return ok(res, {
        bin: "970422",
        accountNumber: "VQRQ0000MOCK01",
        accountName: "CONG TY TNHH CONG NGHE HUBSELL",
        amount: o.amount,
        description: o.description,
        orderCode: Number(o.orderCode),
        currency: "VND",
        paymentLinkId: o.paymentLinkId,
        status: "PENDING",
        checkoutUrl: "",
        qrCode: `00020101021238570010A000000727012700069704220113VQRQ0000MOCK010208QRIBFTTA5303704540${String(o.amount).length}${o.amount}5802VN62${pad(o.description.length + 4)}08${pad(o.description.length)}${o.description}6304MOCK`,
      });
    }
    if (parts[0] === "v2" && parts[1] === "payment-requests" && parts[2]) {
      const key = parts[2].replace(/^mock-/, "");
      const o = orders.get(key);
      if (!o) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ code: "101", desc: "Không tìm thấy đơn (giả lập)", data: null }));
      }
      if (req.method === "POST" && parts[3] === "cancel" && o.status === "PENDING") o.status = "CANCELLED";
      return ok(res, info(o));
    }
    if (req.method === "GET" && parts[0] === "mock" && parts[1] === "pay" && parts[2]) {
      const o = orders.get(parts[2]);
      res.writeHead(o ? 200 : 404, { "Content-Type": "text/plain; charset=utf-8" });
      if (!o) return res.end("Không có đơn này trong cổng giả lập");
      if (o.status === "PENDING") {
        o.status = "PAID";
        o.paidAt = vnNow();
        o.reference = `MOCKFT${Date.now()}`;
        console.log(`[payos-mock] Giả lập TIỀN VỀ đơn ${o.orderCode}`);
      }
      return res.end(`Đơn ${o.orderCode}: ${o.status}`);
    }
    res.writeHead(404);
    res.end();
  });
}).listen(PORT, () => console.log(`[payos-mock] Cổng payOS giả lập chạy ở http://localhost:${PORT}`));
