/**
 * Chụp ảnh thô các màn app cho trang kho — từ GIẢ LẬP WEB của hubsell-mobile
 * (expo web) ở mật độ 3x nên chữ nét (bộ cũ 05/10 chụp máy ảo Android 1080px
 * rồi phóng → anh Trung 16/10: "ảnh trên App Store bị nhòe").
 *
 * Chuẩn bị (xem PROGRESS 16/10 khuya):
 *   1. preview "backend" (https://localhost:4000) + "mobile-web-local" (http://localhost:8081)
 *   2. token của một tài khoản có số đẹp trong DB local:
 *      npx tsx backend/scripts/dev-mint-jwt.ts --email=reviewer@hubsell.vn > <tệp json>
 *   3. node docs/store/screenshots/capture-raw.mjs --token-file=<tệp json>
 * Ra: raw/<tên>.png 1179×2556 (393×852 @3x — đúng cỡ "iPhone Dynamic Island medium" ASC nhận).
 * Sau đó: node render-shots.mjs && python finish-shots.py
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../../hubsell-landing/package.json"));
const { chromium } = require("playwright-core");

const tokenFile = process.argv.find((a) => a.startsWith("--token-file="))?.slice(13);
if (!tokenFile) throw new Error("Thiếu --token-file=<json từ dev-mint-jwt.ts>");
const { token, user } = JSON.parse(readFileSync(tokenFile, "utf8"));
const BASE = process.env.MOBILE_WEB ?? "http://localhost:8081";
const API = process.env.MOBILE_API ?? "http://localhost:8099"; // dev-proxy của hubsell-mobile

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  colorScheme: "light",
  locale: "vi-VN",
});
await ctx.addInitScript(
  ([t, u]) => {
    localStorage.setItem("hubsell.token", t);
    localStorage.setItem("hubsell.user", JSON.stringify({ ...u, permissions: [] }));
    localStorage.setItem("hubsell.themePref", "light");
  },
  [token, user]
);
// Gian TikTok giả trong DB local đã bị đánh dấu hủy ủy quyền (không có token thật) → ảnh kho
// cần trạng thái "đang nối" bình thường: vá hai ô trạng thái trên đường trả về.
await ctx.route(`${API}/api/quang-cao/tiktok?**`, async (route) => {
  const res = await route.fetch();
  const j = await res.json();
  for (const ch of j.channels ?? []) if (ch.ads) Object.assign(ch.ads, { status: "ACTIVE", problem: null });
  if (j.link) Object.assign(j.link, { status: "ACTIVE", lastSyncError: null });
  await route.fulfill({ response: res, json: j });
});

const page = await ctx.newPage();
const shot = async (name) => {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(here, "raw", `${name}.png`) });
  console.log("✓", name);
};
const tap = async (text) => {
  await page.getByText(text, { exact: true }).first().click();
  await page.waitForTimeout(800);
};

await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await shot("1-tong-quan");
await tap("Tài chính");
await shot("2-tai-chinh");

await page.goto(`${BASE}/orders`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await shot("3-don-hang");

await page.goto(`${BASE}/warehouse?tab=returns`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await shot("4-don-hoan");

await page.goto(`${BASE}/warehouse`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await shot("5-ton-kho");

await page.goto(`${BASE}/assistant`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
// Hỏi một câu gợi ý để ảnh có câu trả lời bằng số thật (tầng luật thuần, backend local trả lời).
await tap("Hôm nay lãi bao nhiêu?");
await page.waitForTimeout(3500);
await shot("6-tro-ly");

// Quảng cáo → chip TikTok (bản 1.1.0): thẻ Cần xử lý + 4 số + chiến dịch.
await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await tap("Quảng cáo");
await tap("TikTok");
await page.waitForTimeout(1500);
await shot("7-quang-cao");

await browser.close();
