/**
 * Dựng lại màn "Confirm Authorization" của Shopee Open Platform bằng HTML rồi
 * chụp thành ảnh cho bước 7 của tour onboarding (onboarding-overlay.tsx).
 *
 * Vì sao dựng lại thay vì chụp thật: trang này chỉ hiện SAU KHI đăng nhập
 * seller thật/sandbox — ảnh chụp thật (anh Trung cung cấp 25/08) lộ shop
 * DarkMan/hieuxachtay nên dựng bản trung tính "shop_cua_ban" (khớp tên gõ ở
 * bước đăng nhập), layout + câu chữ bám sát ảnh thật từng dòng.
 *
 * Script tự chứa, KHÔNG cần dev server. In ra tọa độ % nút Confirm để dán
 * vào TOUR_STEPS.
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = "D:/Claude Code/frontend/public/onboarding";
// Nhúng data URI: trang setContent (origin about:blank) bị Chromium chặn file://
const LOGO = `data:image/png;base64,${fs
  .readFileSync("D:/Claude Code/frontend/public/logo-hubsell.png")
  .toString("base64")}`;
const VIEW = { width: 1440, height: 960 };

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Roboto, "Helvetica Neue", Arial, sans-serif; background: #fff; color: #333; }
  header { display: flex; align-items: center; gap: 10px; height: 64px; padding: 0 28px;
           border-bottom: 1px solid #eee; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
  header .brand { display: flex; align-items: center; gap: 8px; font-size: 22px; font-weight: 700; color: #ee4d2d; }
  header .bag { width: 30px; height: 30px; background: #ee4d2d; border-radius: 6px; color: #fff;
                display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; }
  header .plat { font-size: 21px; color: #222; font-weight: 400; }
  main { display: flex; justify-content: center; margin-top: 88px; }
  .wrap { display: flex; width: 1060px; }
  .left { width: 400px; padding-right: 64px; }
  .left h1 { font-size: 27px; font-weight: 600; color: #222; margin-bottom: 14px; }
  .left .manage { font-size: 14px; color: #999; line-height: 1.5; margin-bottom: 40px; }
  .shop { text-align: center; }
  .avatar { width: 84px; height: 84px; border-radius: 50%; margin: 0 auto 16px;
            border: 1px solid #f0f0f0; background: linear-gradient(135deg,#fff3ee,#ffe1d6);
            display: flex; align-items: center; justify-content: center; }
  .avatar svg { width: 42px; height: 42px; }
  .shop-name { font-size: 17px; color: #333; margin-bottom: 18px; }
  .shop-note { font-size: 14px; color: #999; line-height: 1.5; margin-bottom: 28px; }
  .confirm { display: block; width: 100%; border: 0; padding: 14px 0; border-radius: 3px;
             background: linear-gradient(90deg,#ff9d6b,#f1582f); color: #fff; font-size: 16px; cursor: pointer; }
  .divider { width: 1px; background: #eee; }
  .right { flex: 1; padding-left: 72px; }
  .app { display: flex; align-items: center; gap: 16px; margin-bottom: 40px; }
  .app img { width: 56px; height: 56px; border-radius: 10px; }
  .app span { font-size: 17px; color: #333; }
  .apply { font-size: 15px; color: #555; margin-bottom: 22px; }
  .perm { display: flex; gap: 10px; font-size: 15px; color: #333; line-height: 1.55; margin-bottom: 20px; }
  .perm .tick { color: #52c41a; flex-shrink: 0; margin-top: 1px; }
  .perm b { font-weight: 400; }
</style></head><body>
  <header>
    <div class="brand"><div class="bag">S</div>Shopee</div>
    <div class="plat">Open Platform</div>
  </header>
  <main><div class="wrap">
    <div class="left">
      <h1>Authorization</h1>
      <p class="manage">You can manage authorization in Shopee Seller Center &gt; Shop Setting &gt; Partner Management.</p>
      <div class="shop">
        <div class="avatar">
          <svg viewBox="0 0 24 24" fill="none" stroke="#ee4d2d" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9l1.2-5h15.6L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9h18"/><path d="M9 20v-6h6v6"/>
          </svg>
        </div>
        <p class="shop-name">shop_cua_ban</p>
        <p class="shop-note">The shop you are currently authorizing is a Shopee primary shop.</p>
        <button class="confirm" id="confirm-btn">Confirm Authorization</button>
      </div>
    </div>
    <div class="divider"></div>
    <div class="right">
      <div class="app"><img src="${LOGO}" alt="Hubsell"><span>Hubsell</span></div>
      <p class="apply">Apply for authorization to get the following information:</p>
      <div class="perm"><span class="tick">&#10003;</span><p><b>Product:</b> Basic information of products in your shop(s), including prices and stocks of them, as well as promotions details products joined.</p></div>
      <div class="perm"><span class="tick">&#10003;</span><p><b>Order:</b> Information of orders in your shop(s), including details about escrows and logistics related to these orders.</p></div>
      <div class="perm"><span class="tick">&#10003;</span><p><b>Payment:</b> Information of transactions and escrows in your shop(s).</p></div>
      <div class="perm"><span class="tick">&#10003;</span><p><b>Marketing:</b> Information related to discounts in your shop(s).</p></div>
    </div>
  </div></main>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "onboard-shopee-confirm.png") });

  const b = await page.locator("#confirm-btn").boundingBox();
  const r = (v) => Math.round(v * 100) / 100;
  console.log("DONE:", path.join(OUT, "onboard-shopee-confirm.png"));
  console.log("confirmButton:", JSON.stringify({
    x: r(((b.x + b.width / 2) / VIEW.width) * 100),
    y: r(((b.y + b.height / 2) / VIEW.height) * 100),
    w: r((b.width / VIEW.width) * 100),
    h: r((b.height / VIEW.height) * 100),
  }));
  await browser.close();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
