// ============================================================
// URL GỐC CÔNG KHAI CỦA BACKEND — nguồn duy nhất cho mọi URL mà bên thứ ba
// (Shopee/Lazada/TikTok/MISA) gọi ngược vào: redirect OAuth, webhook đăng ký.
//
// Thứ tự ưu tiên:
//   1. BACKEND_URL         — đặt tay khi có domain riêng (vd https://api.hubsell.vn).
//   2. RENDER_EXTERNAL_URL — Render TỰ BƠM cho mọi service
//      (vd https://hubsell-backend.onrender.com) → deploy Render là các URL
//      callback/webhook tự đúng, không cần cấu hình thêm.
//   3. http://localhost:4000 — dev local.
// ============================================================

export function getBackendBaseUrl(): string {
  const raw =
    process.env.BACKEND_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "http://localhost:4000";
  // Bỏ dấu "/" cuối để nơi gọi ghép path (`${base}/api/...`) không bị "//".
  return raw.replace(/\/+$/, "");
}
