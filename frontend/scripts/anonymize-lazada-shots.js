/**
 * ẨN TÊN SHOP THẬT trên 4 ảnh Marketplace của tour Lazada (anh Trung 14/09: không
 * muốn lộ tên shop, thay bằng "DarkMan"): tên góc phải header + tên/logo thẻ
 * seller bên trái (trang Dịch vụ đã mua, hộp Đồng ý). Vá bằng canvas trong
 * Chromium: tô đè bằng MÀU NỀN LẤY NGAY TẠI CHỖ (không lộ vết), vẽ chữ mới.
 * Tọa độ tính theo khung 1440x960 (ảnh gốc 2880x1920, scale 2).
 *
 * Chạy: node scripts/anonymize-lazada-shots.js   (ghi đè ảnh trong public/guide-assets/tour)
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DIR = "D:/Claude Code/Hubsell/frontend/public/guide-assets/tour";
const NAME = "DarkMan";

// Mỗi patch: cover = ô tô đè (lấy màu tại sample), text = chữ vẽ lại.
const headerPatch = {
  cover: { x: 1258, y: 10, w: 66, h: 20 }, sample: { x: 1300, y: 6 },
  text: { x: 1259, y: 24.5, size: 11, color: "#333", weight: "400", align: "left" },
  caret: { x: 1306, y: 20, w: 7, h: 4, color: "#333" },
};
const JOBS = {
  "lz-marketplace.png": [headerPatch],
  "lz-order-success.png": [headerPatch],
  "lz-subscribed.png": [
    headerPatch,
    // tên dưới avatar (nền gradient xanh) — lấy màu ở cùng hàng, mép trái thẻ
    { cover: { x: 228, y: 264, w: 72, h: 24 }, gradient: true,
      text: { x: 264, y: 282, size: 17, color: "#fff", weight: "400", align: "center" } },
    // avatar: vòng tròn trắng + chữ cái đầu
    { circle: { cx: 264, cy: 224, r: 31, fill: "#fff" },
      text: { x: 264, y: 235, size: 26, color: "#1a66ff", weight: "700", align: "center", label: "D" } },
  ],
  "lz-agree-modal.png": [
    headerPatch,
    { cover: { x: 220, y: 264, w: 72, h: 24 }, gradient: true,
      text: { x: 256, y: 282, size: 17, color: "#fff", weight: "400", align: "center" } },
    { circle: { cx: 256, cy: 224, r: 31, fill: "#fff" },
      text: { x: 256, y: 235, size: 26, color: "#1a66ff", weight: "700", align: "center", label: "D" } },
  ],
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [file, patches] of Object.entries(JOBS)) {
    const src = path.join(DIR, file);
    const data = "data:image/png;base64," + fs.readFileSync(src).toString("base64");
    const out = await page.evaluate(async ({ data, patches, name }) => {
      const img = new Image();
      img.src = data;
      await img.decode();
      const S = 2; // ảnh gốc scale 2 so với khung 1440x960
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const px = (x, y) => {
        const d = ctx.getImageData(Math.round(x * S), Math.round(y * S), 1, 1).data;
        return `rgb(${d[0]},${d[1]},${d[2]})`;
      };
      for (const p of patches) {
        if (p.cover && p.gradient) {
          const g = ctx.createLinearGradient(p.cover.x * S, 0, (p.cover.x + p.cover.w) * S, 0);
          g.addColorStop(0, px(p.cover.x - 2, p.cover.y + p.cover.h / 2));
          g.addColorStop(1, px(p.cover.x + p.cover.w + 2, p.cover.y + p.cover.h / 2));
          ctx.fillStyle = g;
          ctx.fillRect(p.cover.x * S, p.cover.y * S, p.cover.w * S, p.cover.h * S);
        } else if (p.cover) {
          ctx.fillStyle = px(p.sample.x, p.sample.y);
          ctx.fillRect(p.cover.x * S, p.cover.y * S, p.cover.w * S, p.cover.h * S);
        }
        if (p.caret) {
          ctx.fillStyle = p.caret.color;
          ctx.beginPath();
          ctx.moveTo(p.caret.x * S, p.caret.y * S);
          ctx.lineTo((p.caret.x + p.caret.w) * S, p.caret.y * S);
          ctx.lineTo((p.caret.x + p.caret.w / 2) * S, (p.caret.y + p.caret.h) * S);
          ctx.closePath();
          ctx.fill();
        }
        if (p.circle) {
          ctx.fillStyle = p.circle.fill;
          ctx.beginPath();
          ctx.arc(p.circle.cx * S, p.circle.cy * S, p.circle.r * S, 0, Math.PI * 2);
          ctx.fill();
        }
        if (p.text) {
          ctx.fillStyle = p.text.color;
          ctx.font = `${p.text.weight} ${p.text.size * S}px Roboto, "Segoe UI", Arial, sans-serif`;
          ctx.textAlign = p.text.align;
          ctx.textBaseline = "alphabetic";
          ctx.fillText(p.text.label ?? name, p.text.x * S, p.text.y * S);
        }
      }
      return c.toDataURL("image/png");
    }, { data, patches, name: NAME });
    fs.writeFileSync(src, Buffer.from(out.split(",")[1], "base64"));
    console.log("đã vá", file);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
