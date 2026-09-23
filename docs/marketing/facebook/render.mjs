/**
 * Xuất ảnh bìa Facebook từ cover.html → PNG 3280×1440 (sáng + tối; khung thiết kế 1640×720 xuất ở 2x —
 * Facebook trải ảnh bìa rộng tới ~1250px trên màn máy tính, màn DPR 1.5–2 cần ≥2500px mới nét).
 * Dùng Chrome cài sẵn qua playwright-core của hubsell-landing, không tải browser:
 *   node docs/marketing/facebook/render.mjs
 * GUIDES=1 → xuất thêm bản có khung vùng an toàn (máy tính / điện thoại) để soát.
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../../hubsell-landing/package.json"));
const { chromium } = require("playwright-core");

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1640, height: 720 }, deviceScaleFactor: 2 });
const base = pathToFileURL(join(here, "cover.html")).href;

for (const v of ["light", "dark"]) {
  await page.goto(`${base}?v=${v}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(here, `hubsell-cover-${v}-3280x1440.png`) });
  if (process.env.GUIDES) {
    await page.addStyleTag({
      content: `.cover::after{content:"";position:absolute;left:180px;top:48px;width:1280px;height:624px;
        outline:3px dashed #ef4444;box-shadow:0 0 0 2000px rgba(239,68,68,.12);z-index:9}`,
    });
    await page.screenshot({ path: join(here, `_guides-${v}.png`) });
  }
  console.log("✓", v);
}
// Ảnh kèm bài chào đầu tiên — 1080×1350
await page.setViewportSize({ width: 1080, height: 1350 });
await page.goto(pathToFileURL(join(here, "post-hello.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(here, "hubsell-post-hello-2160x2700.png") });
console.log("✓ post-hello");
await browser.close();
