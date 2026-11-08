/**
 * Ảnh listing cho App & Service Store của TikTok Shop (docs/TIKTOK-APP-STORE-NIEM-YET.md mục 4):
 *   docs/store/tiktok/listing-images.html chứa 6 khung 1500×900 (tỷ lệ 5:3 TikTok yêu cầu),
 *   mỗi khung = 1 ảnh: 01 ảnh chính + 02–06 ảnh bổ sung. Không phải ảnh chụp màn hình thô
 *   (TikTok cấm, LR-MED-002): mỗi ảnh ghép giao diện + câu giải thích tính năng.
 * Chạy từ gốc repo, dùng Chrome cài sẵn qua playwright-core của hubsell-landing:
 *   node tools/do-hoa/tiktok-store-images.mjs
 * Ra: docs/store/tiktok/0N-<tên>.png (1500×900, PNG RGB).
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "../../docs/store/tiktok");
const require = createRequire(join(here, "../../hubsell-landing/package.json"));
const { chromium } = require("playwright-core");

const FRAMES = [
  "01-quan-ly-da-san-lai-that",
  "02-don-ba-san-mot-man-hinh",
  "03-ton-kho-mot-noi",
  "04-lai-that-khong-chi-roas",
  "05-loai-video-dot-tien",
  "06-canh-quang-cao-24-7",
];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
for (const [i, name] of FRAMES.entries()) {
  const url = `${pathToFileURL(join(OUT, "listing-images.html")).href}?frame=${i + 1}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, `${name}.png`), type: "png" });
  console.log(`✓ ${name}.png`);
}
await browser.close();
console.log("Tiếp: python tools/do-hoa/tiktok-store-finish.py (PNG RGB không alpha + logo 256)");
