/**
 * Xuất ảnh cho trang kho ứng dụng (docs/store/LISTING.md mục 7):
 *   - feature-graphic-1024x500.png : ảnh bìa Google Play. Chụp 2x (2048×1000) cho nét,
 *     bước thu về đúng 1024×500 + bỏ kênh alpha làm bằng Pillow ở lệnh thứ hai.
 * Dùng Chrome cài sẵn qua playwright-core của hubsell-landing, không tải browser:
 *   node tools/do-hoa/store-feature-graphic.mjs
 *   python tools/do-hoa/store-finish.py
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const STORE = join(here, "../../docs/store"); // html nguồn + ảnh ra nằm cạnh tư liệu store
const require = createRequire(join(here, "../../hubsell-landing/package.json"));
const { chromium } = require("playwright-core");

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(join(STORE, "feature-graphic.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(STORE, "_feature-graphic@2x.png") });
console.log("✓ feature graphic @2x");
await browser.close();
