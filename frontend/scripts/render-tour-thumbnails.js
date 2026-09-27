// Sinh 10 thumbnail YouTube 1280x720 cho bộ video hướng dẫn Hubsell.
// Chạy trong frontend/: node scripts/render-tour-thumbnails.js [key ...] → Downloads/hubsell-thumbnails/NN-hubsell-<key>.png
// Cần playwright + chromium (npm install --no-save playwright; npx playwright install chromium) và mạng để tải Be Vietnam Pro.
const { chromium } = require("playwright");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const HERE = path.join(require("os").tmpdir(), "hubsell-thumbs"); fs.mkdirSync(HERE, { recursive: true });
const toUrl = (p) => "file:///" + p.split(path.sep).join("/");
const LOGO = toUrl(path.resolve(__dirname, "../public/logo-hubsell.png"));
const TOUR_IMG = path.resolve(__dirname, "../public/guide-assets/tour") + path.sep;
const OUT = process.env.THUMB_OUT || path.join(process.env.USERPROFILE || "C:/Users/trung", "Downloads", "hubsell-thumbnails");
fs.mkdirSync(OUT, { recursive: true });

const GREEN = "#34D399";
const THUMBS = [
  { key: "channels", ep: 1, accent: "#FF6A3D", plat: "Shopee",
    title: "Kết nối <em>Shopee</em> về Hubsell", sub: "Làm một lần cho mỗi gian · chưa tới 2 phút",
    steps: 8, mins: "2 phút", img: "lz-channels.png", ox: 0, oy: 0 },
  { key: "lazada", ep: 2, accent: "#7C8CFF", plat: "Lazada",
    title: "Kết nối <em>Lazada</em> về Hubsell", sub: "15 bước đầy đủ, kể cả gói Hubsell 0đ chỉ phải đăng ký lần đầu",
    steps: 15, mins: "3,5 phút", img: "lz-connected.png", ox: 0, oy: -120 },
  { key: "tiktok", ep: 3, accent: "#25F4EE", plat: "TikTok Shop",
    title: "Kết nối <em>TikTok Shop</em> về Hubsell", sub: "12 bước · cách xử lý khi gặp màn “Bắt đầu bán”",
    steps: 12, mins: "3 phút", img: "tk-connected.png", ox: 0, oy: -240 },
  { key: "kho", ep: 4, accent: GREEN, plat: "Kho hàng",
    title: "Một <em>kho</em> cho mọi sàn", sub: "Liên kết SKU · đồng bộ tồn kho tự động lên Shopee, Lazada, TikTok",
    steps: 14, mins: "4 phút", img: "kho-inventory.png", ox: 0, oy: 0 },
  { key: "donhang", ep: 5, accent: GREEN, plat: "Đơn hàng",
    title: "Đơn hàng & <em>đối soát</em> dòng tiền", sub: "Từng đơn thực nhận bao nhiêu sau khi sàn trừ phí?",
    steps: 8, mins: "2 phút", img: "dh-orders-bulk.png", ox: 0, oy: 0 },
  { key: "hoadon", ep: 6, accent: "#60A5FA", plat: "Hóa đơn & Thuế",
    title: "Xuất <em>hóa đơn điện tử</em> một chạm", sub: "Nối meInvoice một lần · tự phát hành · tự điều chỉnh khi hoàn",
    steps: 9, mins: "3 phút", img: "hd-issue.png", ox: 0, oy: 0 },
  { key: "taichinh", ep: 7, accent: GREEN, plat: "Tài chính",
    title: "<em>Lãi thật</em> sau khi sàn trừ phí", sub: "Tổng quan · Lãi/Lỗ thực hiện · Dòng tiền · P&L từng sản phẩm",
    steps: 10, mins: "3 phút", img: "tc-dashboard.png", ox: 0, oy: 0 },
  { key: "giutien", ep: 8, accent: "#FBBF24", plat: "Giữ tiền",
    title: "<em>Giữ tiền:</em> đơn hoàn, phí ship, giao hỏng", sub: "Đòi lại từng đồng sàn trừ sai · tự nhắn khách khi shipper giao hỏng",
    steps: 7, mins: "2 phút", img: "gt-returns.png", ox: 0, oy: 0 },
  { key: "ads", ep: 9, accent: "#FF6A3D", plat: "Quảng cáo Shopee",
    title: "Quảng cáo Shopee đang <em>lãi hay lỗ?</em>", sub: "ROAS hòa vốn từ lãi thật · Trợ lý tự hạ ngân sách, tạm dừng",
    steps: 6, mins: "2 phút", img: "ad-overview.png", ox: 0, oy: 0 },
  { key: "nhansu", ep: 10, accent: "#A78BFA", plat: "Nhân viên & Gói",
    title: "<em>Nhân viên,</em> gói dịch vụ & cấu hình", sub: "Tài khoản không cần email · phân quyền từng tính năng × gian hàng",
    steps: 5, mins: "1,5 phút", img: "ns-plan.png", ox: 0, oy: 0 },
];

function html(t) {
  const imgPath = "file:///" + (TOUR_IMG + t.img).replace(/\\/g, "/");
  const ep = String(t.ep).padStart(2, "0");
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@500;600;700;800&display=swap">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; }
  body {
    position: relative; color: #fff; background: #0b1220;
    font-family: "Be Vietnam Pro", Inter, "Segoe UI", sans-serif;
  }
  .glow { position: absolute; inset: 0;
    background:
      radial-gradient(720px 560px at 88% 62%, ${t.accent}2e, transparent 70%),
      radial-gradient(640px 480px at 6% 0%, #10b98126, transparent 70%);
  }
  .grid { position: absolute; inset: 0; opacity: .18;
    background-image: linear-gradient(rgba(148,163,184,.25) 1px, transparent 1px),
      linear-gradient(90deg, rgba(148,163,184,.25) 1px, transparent 1px);
    background-size: 64px 64px;
    -webkit-mask-image: radial-gradient(900px 700px at 30% 40%, #000 30%, transparent 100%);
  }
  .bar { position: absolute; left: 0; top: 0; bottom: 0; width: 14px; background: ${t.accent}; }
  .brand { position: absolute; left: 60px; top: 46px; display: flex; align-items: center; gap: 16px; }
  .brand .chip { width: 64px; height: 64px; border-radius: 16px; background: #fff; display: grid; place-items: center;
    box-shadow: 0 8px 24px rgba(0,0,0,.35); }
  .brand .chip img { width: 54px; height: 54px; }
  .brand .name { font-weight: 800; font-size: 30px; letter-spacing: -.02em; line-height: 1; }
  .brand .tag { font-weight: 500; font-size: 18px; color: #94a3b8; margin-top: 6px; }
  .ep { position: absolute; right: 56px; top: 50px; padding: 12px 22px; border-radius: 999px;
    background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.18);
    font-weight: 700; font-size: 24px; letter-spacing: .02em; backdrop-filter: blur(6px); z-index: 5; }
  .ep b { color: ${t.accent}; }
  .text { position: absolute; left: 60px; top: 186px; width: 600px; z-index: 4; }
  .title { font-weight: 800; font-size: 62px; line-height: 1.12; letter-spacing: -.025em;
    text-shadow: 0 6px 30px rgba(0,0,0,.55); }
  .title em { font-style: normal; color: ${t.accent}; }
  .sub { margin-top: 26px; width: 600px;
    font-weight: 500; font-size: 25px; line-height: 1.35; color: #cbd5e1;
    text-shadow: 0 4px 20px rgba(0,0,0,.6); }
  .meta { position: absolute; left: 60px; bottom: 48px; display: flex; gap: 12px; }
  .meta span { padding: 10px 18px; border-radius: 999px; font-weight: 600; font-size: 20px;
    background: rgba(255,255,255,.09); border: 1.5px solid rgba(255,255,255,.16); color: #e2e8f0; }
  .meta span.plat { background: ${t.accent}; color: #0b1220; border-color: transparent; }
  .shot { position: absolute; left: 700px; top: 150px; width: 760px; height: 620px;
    border-radius: 18px; overflow: hidden; background: #fff;
    border: 1px solid rgba(255,255,255,.22);
    box-shadow: 0 40px 90px rgba(0,0,0,.6), 0 0 0 10px rgba(255,255,255,.04);
    transform: perspective(1600px) rotateY(-14deg) rotateX(3deg) rotateZ(-1deg);
    transform-origin: left center; }
  .shot .chrome { height: 40px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 8px; padding: 0 16px; }
  .shot .chrome i { width: 12px; height: 12px; border-radius: 50%; background: #cbd5e1; display: block; }
  .shot .chrome i:nth-child(1) { background: #fca5a5; } .shot .chrome i:nth-child(2) { background: #fcd34d; } .shot .chrome i:nth-child(3) { background: #86efac; }
  .shot .chrome .url { margin-left: 10px; height: 24px; flex: 1; border-radius: 8px; background: #fff; border: 1px solid #e2e8f0;
    font: 500 13px/24px Inter, sans-serif; color: #64748b; padding: 0 12px; }
  .shot .img { position: relative; width: 100%; height: 580px; overflow: hidden; }
  .shot .img img { position: absolute; left: ${-218 + t.ox}px; top: ${t.oy}px; width: 1176px; }
</style></head><body>
<div class="glow"></div><div class="grid"></div><div class="bar"></div>
<div class="brand"><div class="chip"><img src="${LOGO}"></div><div><div class="name">Hubsell</div><div class="tag">Hướng dẫn sử dụng</div></div></div>
<div class="ep">Bài <b>${ep}</b> / 10</div>
<div class="shot"><div class="chrome"><i></i><i></i><i></i><div class="url">app.hubsell.vn</div></div><div class="img"><img src="${imgPath}"></div></div>
<div class="text"><div class="title">${t.title}</div><div class="sub">${t.sub}</div></div>
<div class="meta"><span class="plat">${t.plat}</span><span>${t.steps} bước</span><span>${t.mins}</span></div>
</body></html>`;
}

(async () => {
  const only = process.argv.slice(2);
  const list = only.length ? THUMBS.filter((t) => only.includes(t.key)) : THUMBS;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const outs = [];
  for (const t of list) {
    const file = path.join(HERE, `thumb-${t.key}.html`);
    fs.writeFileSync(file, html(t), "utf8");
    await page.goto("file:///" + file.replace(/\\/g, "/"));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const ok = await page.evaluate(() => document.fonts.check('800 66px "Be Vietnam Pro"'));
    const out = path.join(OUT, `${String(t.ep).padStart(2, "0")}-hubsell-${t.key}.png`);
    await page.screenshot({ path: out });
    outs.push(out);
    console.log((ok ? "font OK " : "FONT MISSING ") + out);
  }
  await browser.close();
  // Lưới soát mắt
  const W = 640, H = 360, cols = 2;
  const tiles = [];
  for (let i = 0; i < outs.length; i++) {
    tiles.push({ input: await sharp(outs[i]).resize(W, H).png().toBuffer(), left: (i % cols) * W, top: Math.floor(i / cols) * H });
  }
  await sharp({ create: { width: W * cols, height: H * Math.ceil(outs.length / cols), channels: 3, background: "#222" } })
    .composite(tiles).jpeg({ quality: 80 }).toFile(path.join(HERE, "review.jpg"));
  console.log("review.jpg", outs.length);
})();
