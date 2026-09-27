/**
 * Chụp ảnh + đo tọa độ cho TOUR KẾT NỐI TIKTOK SHOP (lib/guide-tours.ts → TIKTOK_TOUR).
 *
 * Phần A — màn HUBSELL (mock /api như capture-lazada-tour-assets.js, cần frontend
 * dev server localhost:3000, KHÔNG cần backend):
 *   tk-channels.png    trang Kênh bán có Shopee + Lazada (chưa có TikTok)
 *   tk-dialog.png      hộp Kết nối gian hàng đã chọn TikTok
 *   tk-callback.png    trang /channels/tiktok/callback báo "Kết nối thành công"
 *   tk-connected.png   gian TikTok Đang hoạt động
 * Phần B — trang TikTok công khai (không cần đăng nhập):
 *   tk-seller-login.png  seller-vn.tiktok.com/account/login — đi qua đúng URL ủy
 *                        quyền thật (services.tiktokshop.com/open/authorize) của app.
 * Hai màn cần phiên seller (01 Cài đặt, "Bắt đầu bán") cắt từ ảnh thật anh Trung
 * chụp 16/09/2026 (scratchpad crop-tk-auth.js / crop-tk-wrong.js); màn 02 Ủy quyền
 * dựng lại bằng capture-tiktok-authorize-confirm.js.
 *
 * Ảnh 1440x960 (khung 3:2 của TourPlayer) → public/guide-assets/tour/tk-*.png.
 * In tọa độ % để dán vào TIKTOK_TOUR mỗi lần chụp lại.
 *
 * Chạy: node scripts/capture-tiktok-tour-assets.js [hubsell|tiktok]
 */
const { chromium } = require("playwright");
const path = require("path");

const OUT = "D:/Claude Code/Hubsell/frontend/public/guide-assets/tour";
const VIEW = { width: 1440, height: 960 };
const ONLY = process.argv[2];
const SERVICE_ID = "7685556109353699080";
/** Chép từ channels/page.tsx HISTORY_BACKFILL_NOTICE (backend sync-schedule.ts). */
const HISTORY_BACKFILL_NOTICE =
  "Hubsell đang kéo đơn hàng và số đối soát của 3 tháng gần nhất (90 ngày) về, thường xong trong vài phút. Đơn cũ hơn 3 tháng không được kéo về.";

const user = {
  id: "u1",
  fullName: "Chủ shop",
  email: "shop@hubsell.vn",
  role: "ADMIN",
  isPlatformAdmin: false,
  createdAt: "2026-06-01T00:00:00.000Z",
};

const shopee = {
  id: "c1", channelName: "SHOPEE", shopName: "Sunny Closet",
  externalShopId: "281534907", externalShopName: "Sunny Closet",
  apiToken: "shpk_live_5f2a81c9d3e7b640", status: "ACTIVE", feeRate: "0",
  createdAt: "2026-08-20T09:00:00.000Z", apiConnected: true,
  accessTokenExpireAt: "2026-10-20T09:00:00.000Z",
  _count: { orders: 1284, channelProducts: 96 }, matchedProductCount: 42,
};
const lazada = {
  id: "c2", channelName: "LAZADA", shopName: "Sunny Closet",
  externalShopId: "200628688522", externalShopName: "Sunny Closet",
  apiToken: "50000200a0bPpGqEeRtYuIoPaSdFgHjKlZxCvBnM", status: "ACTIVE", feeRate: "0",
  createdAt: "2026-09-14T06:44:00.000Z", apiConnected: true,
  accessTokenExpireAt: "2027-03-13T17:00:00.000Z",
  refreshTokenExpireAt: "2027-03-13T17:00:00.000Z",
  _count: { orders: 312, channelProducts: 80 }, matchedProductCount: 80,
};
const tiktok = {
  id: "c3", channelName: "TIKTOK", shopName: "DarkMan",
  externalShopId: "7495000000000000001", externalShopName: "DarkMan",
  apiToken: "ROW_l3Fk9AAAAAB2cXh0dGtfbGl2ZV9kZW1v", status: "ACTIVE", feeRate: "0",
  createdAt: "2026-09-25T02:10:00.000Z", apiConnected: true,
  accessTokenExpireAt: "2026-09-25T09:10:00.000Z",
  refreshTokenExpireAt: "2027-09-25T02:10:00.000Z",
  _count: { orders: 0, channelProducts: 0 }, matchedProductCount: 0,
};

const r = (v) => Math.round(v * 100) / 100;
const pctOf = (b) => ({
  x: r(((b.x + b.width / 2) / VIEW.width) * 100),
  y: r(((b.y + b.height / 2) / VIEW.height) * 100),
  w: r((b.width / VIEW.width) * 100),
  h: r((b.height / VIEW.height) * 100),
});
const pct = async (locator) => {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Không lấy được boundingBox");
  return pctOf(b);
};

async function captureHubsell(browser, targets) {
  let channelsPayload = [shopee, lazada];
  const ctx = await browser.newContext({
    viewport: VIEW, deviceScaleFactor: 2, locale: "vi-VN", ignoreHTTPSErrors: true,
  });
  await ctx.route("**/api/**", (route) => {
    const req = route.request();
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = req.url();
    const json = (o) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(o) });
    if (url.includes("/api/auth/me")) return json({ user, hasChannels: true });
    if (url.includes("/api/channels/lazada/connect-info"))
      return json({ configured: true, subscribeUrl: "https://marketplace.lazada.vn/web/detail.html?articleCode=FW_GOODS-1000034551" });
    if (url.includes("/api/channels/tiktok/callback"))
      return json({
        connected: 1,
        message: HISTORY_BACKFILL_NOTICE,
        channels: [{ id: "c3", channelName: "TIKTOK", shopName: "DarkMan", externalShopId: "7495000000000000001", status: "ACTIVE" }],
      });
    if (/\/api\/channels(\?|$)/.test(url)) return json(channelsPayload);
    if (url.includes("/api/notifications")) return json({ items: [], unread: 0 });
    if (url.includes("/api/subscription/me")) {
      return json({
        exempt: true, hasSubscription: false, plan: null, subscription: null,
        usage: { channels: 2, staff: 0, ordersThisMonth: 214 },
        orders: { limit: null, used: 214, ratio: null, state: "OK", graceDeadline: null },
        expiry: { expired: false, lockDeadline: null, locked: false },
        locked: false, lockedReason: null, upgradePlans: [], payment: null, pendingUpgradeRequest: null,
      });
    }
    return json({});
  });
  // Ẩn nút "N" của Next dev (nextjs-portal) kẻo lọt vào góc ảnh tour.
  await ctx.addInitScript(() => {
    const st = document.createElement("style");
    st.textContent = "nextjs-portal{display:none!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st));
  });
  await ctx.addInitScript(([u]) => {
    localStorage.setItem("hubsell_token", "demo-token");
    localStorage.setItem("hubsell_user", JSON.stringify(u));
    // Trang callback đối chiếu state với giá trị lưu trước khi rời Hubsell.
    if (!sessionStorage.getItem("tiktok_oauth_state_set")) {
      sessionStorage.setItem("tiktok_oauth_state", "tourstate");
      sessionStorage.setItem("tiktok_oauth_state_set", "1");
    }
  }, [user]);
  const page = await ctx.newPage();

  // ---- tk-channels: trang Kênh bán có Shopee + Lazada, chưa có TikTok ----
  await page.goto("http://localhost:3000/channels", { waitUntil: "domcontentloaded" });
  const navLink = page.getByRole("link", { name: "Kênh bán" });
  await navLink.waitFor({ timeout: 60000 });
  const connectBtn = page.getByRole("button", { name: "Kết nối gian hàng" });
  await connectBtn.waitFor();
  await page.getByText("Sunny Closet").first().waitFor();
  await page.waitForTimeout(1200);
  targets.navChannels = await pct(navLink);
  targets.connectButton = await pct(connectBtn);
  await page.screenshot({ path: path.join(OUT, "tk-channels.png") });

  // ---- tk-dialog: chọn TikTok ----
  await connectBtn.click();
  const select = page.locator("#channel-select");
  await select.waitFor();
  await select.selectOption("TIKTOK");
  const oauthBtn = page.getByRole("button", { name: /Tiếp tục với TikTok/ });
  await oauthBtn.waitFor();
  await page.waitForTimeout(500);
  targets.platformSelect = await pct(select);
  targets.oauthButton = await pct(oauthBtn);
  await page.screenshot({ path: path.join(OUT, "tk-dialog.png") });

  // ---- tk-callback: TikTok trả về kèm code + state → Kết nối thành công ----
  await page.goto("http://localhost:3000/channels/tiktok/callback?code=ROW_demoAuthCode&state=tourstate", {
    waitUntil: "domcontentloaded",
  });
  const backBtn = page.getByRole("button", { name: "Về trang Kênh bán" });
  await backBtn.waitFor({ timeout: 60000 });
  await page.waitForTimeout(700);
  targets.callbackCard = await pct(page.getByText("Kết nối thành công").locator("xpath=ancestor::div[contains(@class,'flex-col')][1]"));
  targets.callbackBack = await pct(backBtn);
  await page.screenshot({ path: path.join(OUT, "tk-callback.png") });

  // ---- tk-connected: gian TikTok Đang hoạt động ----
  channelsPayload = [shopee, lazada, tiktok];
  await page.goto("http://localhost:3000/channels", { waitUntil: "domcontentloaded" });
  await page.getByText("DarkMan").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  const tiktokRow = page.locator("div", { has: page.getByText("DarkMan", { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Đồng bộ đơn", exact: true }) })
    .last();
  targets.syncButtonTiktok = await pct(tiktokRow.getByRole("button", { name: "Đồng bộ đơn", exact: true }));
  targets.syncSettleTiktok = await pct(tiktokRow.getByRole("button", { name: "Đồng bộ đối soát" }));
  targets.guideButtonTiktok = await pct(page.locator('[data-tour="guide-tiktok"]'));
  await page.screenshot({ path: path.join(OUT, "tk-connected.png") });
  await ctx.close();
}

async function captureTiktokPublic(browser, targets) {
  const ctx = await browser.newContext({
    viewport: VIEW, deviceScaleFactor: 2, locale: "vi-VN",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  // URL ủy quyền thật của app (buildAuthorizeUrl trong backend tiktok/config.ts) →
  // TikTok tự chuyển tới trang đăng nhập Seller Center VN kèm redirect_url custom-authorize.
  await page.goto(
    `https://services.tiktokshop.com/open/authorize?service_id=${SERVICE_ID}&app_type=custom&state=demo`,
    { waitUntil: "domcontentloaded", timeout: 90000 }
  );
  const pwd = page.locator("input[type=password]").first();
  await pwd.waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
  targets.loginPassword = await pct(pwd);
  targets.loginPhone = await pct(page.locator("input[type=tel], input[placeholder*='số điện thoại' i]").first());
  targets.loginButton = await pct(page.getByRole("button", { name: /^Đăng nhập$/ }).first());
  await page.screenshot({ path: path.join(OUT, "tk-seller-login.png") });
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const targets = {};
  try {
    if (!ONLY || ONLY === "hubsell") await captureHubsell(browser, targets);
    if (!ONLY || ONLY === "tiktok") await captureTiktokPublic(browser, targets);
  } finally {
    await browser.close();
  }
  console.log("TOA DO MUC TIEU (% khung 1440x960) — dan vao TIKTOK_TOUR:");
  console.log(JSON.stringify(targets, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
