/**
 * Chụp ảnh + đo tọa độ cho TOUR KẾT NỐI LAZADA (lib/guide-tours.ts → LAZADA_TOUR).
 *
 * Phần A — màn HUBSELL (mock /api như capture-guide-tour-assets.js, cần frontend
 * dev server localhost:3000, KHÔNG cần backend):
 *   lz-channels.png      trang Kênh bán có 1 gian Shopee (chưa có Lazada)
 *   lz-dialog.png        hộp Kết nối gian hàng đã chọn Lazada (app ISV → không ô code)
 *   lz-dialog-code.png   hộp mở sẵn với code do Lazada bật về (?lazada=code&via=marketplace)
 *   lz-connected.png     gian Lazada Đang hoạt động + Kỳ dịch vụ
 * Phần B — 2 trang LAZADA công khai (không cần đăng nhập):
 *   lz-auth.png          auth.lazada.com "Sign in and authorize permission" (Site mặc định Singapore)
 *   lz-seller-login.png  sellercenter.lazada.vn đăng nhập
 * Các trang Marketplace (gói, xác nhận đơn, đặt hàng thành công, dịch vụ đã
 * mua, hộp Đồng ý) cần phiên seller → chụp từ Chrome đăng nhập Hi.Bé (khung
 * 1440x960) qua Claude in Chrome: resize viewport 1440x960, screenshot save_to_disk,
 * đo bbox bằng getBoundingClientRect → % (ghi chú cách làm trong memory tour).
 *
 * Ảnh 1440x960 (khung 3:2 của TourPlayer) → public/guide-assets/tour/lz-*.png.
 * In tọa độ % để dán vào LAZADA_TOUR mỗi lần chụp lại.
 *
 * Chạy: node scripts/capture-lazada-tour-assets.js [hubsell|lazada]
 */
const { chromium } = require("playwright");
const path = require("path");

const OUT = "D:/Claude Code/Hubsell/frontend/public/guide-assets/tour";
const VIEW = { width: 1440, height: 960 };
const ONLY = process.argv[2];

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
  accessTokenExpireAt: "2026-09-20T09:00:00.000Z",
  _count: { orders: 1284, channelProducts: 96 }, matchedProductCount: 42,
};
const lazada = {
  id: "c2", channelName: "LAZADA", shopName: "Sunny Closet",
  externalShopId: "200628688522", externalShopName: "Sunny Closet",
  apiToken: "50000200a0bPpGqEeRtYuIoPaSdFgHjKlZxCvBnM", status: "ACTIVE", feeRate: "0",
  createdAt: "2026-09-14T06:44:00.000Z", apiConnected: true,
  accessTokenExpireAt: "2027-03-13T17:00:00.000Z",
  refreshTokenExpireAt: "2027-03-13T17:00:00.000Z",
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
  let channelsPayload = [shopee];
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
      return json({
        configured: true,
        subscribeUrl:
          "https://marketplace.lazada.vn/web/detail.html?articleCode=FW_GOODS-1000034551&itemCode=FW_GOODS-1000034551-1",
      });
    if (/\/api\/channels(\?|$)/.test(url)) return json(channelsPayload);
    if (url.includes("/api/notifications")) return json({ items: [], unread: 0 });
    if (url.includes("/api/subscription/me")) {
      return json({
        exempt: true, hasSubscription: false, plan: null, subscription: null,
        usage: { channels: 1, staff: 0, ordersThisMonth: 214 },
        orders: { limit: null, used: 214, ratio: null, state: "OK", graceDeadline: null },
        expiry: { expired: false, lockDeadline: null, locked: false },
        locked: false, lockedReason: null, upgradePlans: [], payment: null, pendingUpgradeRequest: null,
      });
    }
    return json({});
  });
  await ctx.addInitScript(([u]) => {
    localStorage.setItem("hubsell_token", "demo-token");
    localStorage.setItem("hubsell_user", JSON.stringify(u));
  }, [user]);
  const page = await ctx.newPage();

  // ---- lz-channels: trang Kênh bán có Shopee, chưa có Lazada ----
  await page.goto("http://localhost:3000/channels", { waitUntil: "domcontentloaded" });
  const navLink = page.getByRole("link", { name: "Kênh bán" });
  await navLink.waitFor({ timeout: 60000 });
  const connectBtn = page.getByRole("button", { name: "Kết nối gian hàng" });
  await connectBtn.waitFor();
  await page.getByText("Sunny Closet").first().waitFor();
  await page.waitForTimeout(1200);
  targets.navChannels = await pct(navLink);
  targets.connectButton = await pct(connectBtn);
  await page.screenshot({ path: path.join(OUT, "lz-channels.png") });

  // ---- lz-dialog: chọn Lazada ----
  await connectBtn.click();
  const select = page.locator("#channel-select");
  await select.waitFor();
  await select.selectOption("LAZADA");
  const oauthBtn = page.getByRole("button", { name: /Tiếp tục với Lazada/ });
  await oauthBtn.waitFor();
  await page.waitForTimeout(500);
  targets.platformSelect = await pct(select);
  targets.oauthButton = await pct(oauthBtn);
  await page.screenshot({ path: path.join(OUT, "lz-dialog.png") });

  // ---- lz-dialog-code: code do Lazada bật về, ô điền sẵn ----
  await page.goto(
    "http://localhost:3000/channels?lazada=code&code=0_142085_mLpO9nO7jHaLl1MwSsxXbJt52185&via=marketplace",
    { waitUntil: "domcontentloaded" }
  );
  const codeBtn = page.getByRole("button", { name: /Đổi code lấy token/ });
  await codeBtn.waitFor({ timeout: 60000 });
  await page.waitForTimeout(700);
  targets.codeInput = await pct(page.locator("#lazada-code"));
  targets.codeButton = await pct(codeBtn);
  await page.screenshot({ path: path.join(OUT, "lz-dialog-code.png") });

  // ---- lz-connected: gian Lazada Đang hoạt động ----
  channelsPayload = [shopee, lazada];
  await page.goto("http://localhost:3000/channels", { waitUntil: "domcontentloaded" });
  await page.getByText("Kỳ dịch vụ").waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  const syncBtns = page.getByRole("button", { name: "Đồng bộ đơn", exact: true });
  targets.syncButtonLazada = await pct(syncBtns.nth(1));
  targets.servicePeriod = await pct(page.getByText("Kỳ dịch vụ"));
  targets.guideButtonLazada = await pct(page.locator('[data-tour="guide-lazada"]'));
  await page.screenshot({ path: path.join(OUT, "lz-connected.png") });
  await ctx.close();
}

async function captureLazadaPublic(browser, targets) {
  const ctx = await browser.newContext({
    viewport: VIEW, deviceScaleFactor: 2, locale: "vi-VN",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();

  // ---- lz-auth: trang Sign in and authorize permission ----
  await page.goto(
    "https://auth.lazada.com/oauth/authorize?response_type=code&force_auth=true&redirect_uri=https%3A%2F%2Fhubsell-backend-sg.onrender.com%2Fapi%2Fauth%2Flazada%2Fcallback&client_id=142085",
    { waitUntil: "networkidle", timeout: 90000 }
  );
  const sellerLogin = page.getByText("Use Seller Login").first();
  await sellerLogin.waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  const siteBox = page.locator("input").first();
  targets.authSite = await pct(siteBox);
  targets.authSellerLogin = await pct(sellerLogin);
  await page.screenshot({ path: path.join(OUT, "lz-auth.png") });

  // ---- lz-seller-login: đăng nhập Seller Center VN ----
  await page.goto("https://sellercenter.lazada.vn/apps/seller/login?login=1", {
    waitUntil: "networkidle", timeout: 90000,
  });
  const pwd = page.locator("input[type=password]").first();
  await pwd.waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  const form = pwd.locator("xpath=ancestor::form[1]");
  const textInput = (await form.count())
    ? form.locator("input:not([type=password]):not([type=hidden]):not([type=checkbox])").first()
    : page.locator("input:not([type=password]):not([type=hidden]):not([type=checkbox])").first();
  targets.loginUser = await pct(textInput);
  targets.loginPassword = await pct(pwd);
  const loginBtn = page.getByRole("button", { name: /^Đăng nhập$/ }).first();
  targets.loginButton = (await loginBtn.count())
    ? await pct(loginBtn)
    : await pct(page.getByText("Đăng nhập", { exact: true }).first());
  await page.screenshot({ path: path.join(OUT, "lz-seller-login.png") });
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const targets = {};
  try {
    if (!ONLY || ONLY === "hubsell") await captureHubsell(browser, targets);
    if (!ONLY || ONLY === "lazada") await captureLazadaPublic(browser, targets);
  } finally {
    await browser.close();
  }
  console.log("TOA DO MUC TIEU (% khung 1440x960) — dan vao LAZADA_TOUR:");
  console.log(JSON.stringify(targets, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
