// ============================================================
// TEST LẤY ACCESS TOKEN MISA meInvoice (Sandbox) bằng cặp khóa trong .env.
//
// Chạy (từ thư mục backend/):  npx tsx scripts/misa-get-token.ts
//
// Thành công → in token (che giữa) + độ dài. Thất bại → in nguyên thông điệp
// lỗi từ misa-auth.ts (thiếu cấu hình / MISA từ chối / sai tên trường body —
// trường hợp cuối chỉnh buildAuthBody() trong misa-auth.ts theo tài liệu kèm
// hợp đồng sandbox).
// ============================================================

import "dotenv/config";
import {
  getMisaAccessToken,
  misaApiBase,
  misaEnvCredentials,
} from "../src/integrations/invoice/misa-auth";

(async () => {
  const creds = misaEnvCredentials();
  console.log(`Endpoint auth: ${misaApiBase()}/auth/token`);
  console.log(`Client ID:     ${creds?.clientId ?? "(CHƯA cấu hình MISA_CLIENT_ID)"}`);

  const token = await getMisaAccessToken();
  const masked =
    token.length > 16 ? `${token.slice(0, 8)}…${token.slice(-8)}` : "(token ngắn bất thường)";
  console.log(`✅ Lấy token thành công: ${masked} (dài ${token.length} ký tự)`);
})().catch((err) => {
  console.error(`❌ ${(err as Error).message}`);
  process.exit(1);
});
