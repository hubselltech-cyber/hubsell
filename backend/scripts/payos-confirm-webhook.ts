// Đăng ký URL webhook với payOS — chạy MỘT lần sau khi đặt PAYOS_* trên môi
// trường (payOS gọi thử URL ngay, backend phải đang chạy và trả 2xx).
//   npx tsx scripts/payos-confirm-webhook.ts https://hubsell-backend-sg.onrender.com/api/webhooks/payos
import "dotenv/config";
import { confirmPayosWebhook, getPayosConfig } from "../src/integrations/payos/client";

async function main() {
  const url = process.argv[2];
  if (!url || !/^https:\/\//.test(url)) {
    console.error("Cách dùng: npx tsx scripts/payos-confirm-webhook.ts https://<backend>/api/webhooks/payos");
    process.exit(1);
  }
  const cfg = getPayosConfig();
  if (!cfg) {
    console.error("Thiếu PAYOS_CLIENT_ID / PAYOS_API_KEY / PAYOS_CHECKSUM_KEY trong env.");
    process.exit(1);
  }
  const result = await confirmPayosWebhook(cfg, url);
  console.log("payOS đã nhận webhook URL:", result);
}

main().catch((err) => {
  console.error("Đăng ký webhook thất bại:", err.message);
  process.exit(1);
});
