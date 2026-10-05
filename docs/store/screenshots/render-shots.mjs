/**
 * Ghép ảnh màn hình cho trang kho (docs/store/LISTING.md mục 7) từ ảnh chụp app thật trong raw/
 * (chụp trên máy ảo Android, đã cắt thanh trạng thái + thanh điều hướng của Android):
 *   - iphone/  1290×2796 : App Store, iPhone 6,9"
 *   - android/ 1080×2160 : Google Play (tỷ lệ 2:1)
 * Dùng Chrome cài sẵn qua playwright-core của hubsell-landing:
 *   node docs/store/screenshots/render-shots.mjs
 *   python docs/store/screenshots/finish-shots.py   (bỏ kênh alpha)
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../../hubsell-landing/package.json"));
const { chromium } = require("playwright-core");

const SHOTS = [
  { img: "1-tong-quan", t: "Mở máy là thấy lãi ròng hôm nay", s: "Doanh thu, lợi nhuận, đơn chờ xử lý" },
  { img: "2-tai-chinh", t: "Tiền đi đâu, còn lại bao nhiêu", s: "Bóc tách từng khoản tới lợi nhuận ròng" },
  { img: "3-don-hang", t: "Đơn mọi sàn trong một danh sách", s: "Tìm theo mã đơn, tên khách, mã vận đơn" },
  { img: "4-don-hoan", t: "Quét mã, nhận hàng hoàn", s: "Biết đơn nào chờ về kho, đơn nào quá hạn" },
  { img: "5-ton-kho", t: "Tồn kho từng mã, biết hàng sắp hết", s: "Chạm vào dòng để nhập, xuất" },
  { img: "6-tro-ly", t: "Hỏi bằng tiếng Việt, đáp bằng số thật", s: "Gõ hoặc nói với Trợ lý Hubsell" },
];
const SIZES = [
  { dir: "iphone", w: 1290, h: 2796, cap: 520, pw: 1050 },
  { dir: "android", w: 1080, h: 2160, cap: 380, pw: 850 },
];

const browser = await chromium.launch({ channel: "chrome" });
for (const z of SIZES) {
  mkdirSync(join(here, z.dir), { recursive: true });
  const page = await browser.newPage({ viewport: { width: z.w, height: z.h }, deviceScaleFactor: 1 });
  for (const shot of SHOTS) {
    const url = new URL(pathToFileURL(join(here, "shot.html")).href);
    for (const [k, v] of Object.entries({ ...shot, w: z.w, h: z.h, cap: z.cap, pw: z.pw })) url.searchParams.set(k, v);
    await page.goto(url.href, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(here, z.dir, `${shot.img}.png`) });
    console.log(`✓ ${z.dir}/${shot.img}`);
  }
  await page.close();
}
await browser.close();
