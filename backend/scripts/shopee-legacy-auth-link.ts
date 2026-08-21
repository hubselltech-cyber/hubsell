// ============================================================
// Probe: sinh link ủy quyền Shopee LUỒNG CŨ (v2 auth_partner, ký sign)
// để đối chứng với luồng mới open.shopee.com/auth trong vụ điều tra
// "seller bị đá sang cổng developer" (ticket 2086736099706646528).
//
// Salework (và có lẽ các ISV cũ) đang chạy trang đích /authorize của luồng
// ký sign này và seller ủy quyền bình thường — cần xem link cùng dạng của
// app 2040029 đổ về đâu.
//
// Chạy với key PRODUCTION (không có trong .env local — dán tạm qua env):
//   $env:SHOPEE_PARTNER_ID="2040029"; $env:SHOPEE_PARTNER_KEY="<Live Partner Key>"; `
//     npx tsx scripts/shopee-legacy-auth-link.ts
//
// Mở link in ra trong trình duyệt cần test. CHỈ QUAN SÁT trang đổ về đâu
// (Confirm Authorization hay cổng developer) — đừng bấm Confirm: luồng cũ
// không mang state nên callback sẽ báo lỗi (vô hại, nhưng khỏi rác log).
// Link có timestamp + sign nên HẾT HẠN SAU ~5 PHÚT — chạy lại khi cần.
// ============================================================

import crypto from "crypto";

const partnerId = process.env.SHOPEE_PARTNER_ID;
const partnerKey = process.env.SHOPEE_PARTNER_KEY;
const redirect =
  process.env.SHOPEE_REDIRECT_URI ??
  "https://hubsell-backend-sg.onrender.com/api/auth/shopee/callback";

if (!partnerId || !partnerKey) {
  console.error("Thiếu SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY trong env.");
  process.exit(1);
}
if (partnerKey.startsWith("shpk") && partnerId === "1239199") {
  console.warn("⚠ Đang dùng bộ SANDBOX — kết quả không nói lên gì về production.");
}

const path = "/api/v2/shop/auth_partner";
const timestamp = Math.floor(Date.now() / 1000);
const sign = crypto
  .createHmac("sha256", partnerKey)
  .update(`${partnerId}${path}${timestamp}`)
  .digest("hex");

const qs = new URLSearchParams({
  partner_id: partnerId,
  timestamp: String(timestamp),
  sign,
  redirect,
}).toString();

console.log(`\nLink ủy quyền LUỒNG CŨ (hết hạn ~5'):\n`);
console.log(`https://partner.shopeemobile.com${path}?${qs}\n`);
