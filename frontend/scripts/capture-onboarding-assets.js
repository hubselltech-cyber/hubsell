/**
 * Chụp ảnh GIAO DIỆN THẬT của trang Kênh bán cho màn HƯỚNG DẪN ĐỘNG sau đăng
 * nhập lần đầu (components/onboarding-overlay.tsx): con trỏ ảo chạy trên các
 * ảnh này, click + phóng to từng vùng thao tác như một video quay màn hình.
 *
 * Cùng cơ chế với capture-invoice-assets.js: mở frontend thật (localhost:3000)
 * bằng Chromium headless, chặn mọi request /api/* trả dữ liệu mẫu — render đúng
 * 100% giao diện production, tái lập được khi UI đổi.
 *
 * NGOÀI ẢNH, script còn in ra TỌA ĐỘ (% viewport) của từng nút mục tiêu —
 * copy khối JSON đó vào TOUR_STEPS trong onboarding-overlay.tsx mỗi lần chụp
 * lại, kẻo con trỏ chỉ trật chỗ.
 */
const { chromium } = require("playwright");
const path = require("path");

const OUT = "D:/Claude Code/frontend/public/onboarding";
const VIEW = { width: 1440, height: 960 };

const user = {
  id: "u1",
  fullName: "Chủ shop",
  email: "shop@hubsell.vn",
  role: "ADMIN",
  isPlatformAdmin: false,
  createdAt: "2026-06-01T00:00:00.000Z",
};

// Gian Shopee ĐÃ KẾT NỐI THẬT cho ảnh cuối (bước Đồng bộ đơn) — data demo
// Sunny Closet trùng bộ ảnh landing/guide cho nhất quán.
const connectedChannel = {
  id: "c1",
  channelName: "SHOPEE",
  shopName: "Sunny Closet",
  externalShopId: "281534907",
  externalShopName: "Sunny Closet",
  apiToken: "shpk_live_5f2a81c9d3e7b640",
  status: "ACTIVE",
  feeRate: "0",
  createdAt: "2026-08-20T09:00:00.000Z",
  apiConnected: true,
  accessTokenExpireAt: "2026-09-20T09:00:00.000Z",
  _count: { orders: 1284, channelProducts: 96 },
  matchedProductCount: 42,
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 2, // ảnh nét gấp đôi — bị phóng to tới ~2.2x trong tour
    locale: "vi-VN",
    ignoreHTTPSErrors: true,
  });

  // Ảnh 1+2 cần danh sách gian RỖNG, ảnh 3 cần 1 gian Shopee đã nối —
  // route đọc biến này nên chỉ cần đổi giá trị rồi reload.
  let channelsPayload = [];

  await ctx.route("**/api/**", (route) => {
    const req = route.request();
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: cors });
    }
    const url = req.url();
    const json = (o) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify(o),
      });
    // hasChannels: true để AppShell render app đầy đủ (sidebar là nhân vật
    // chính của bước 1) — màn onboarding thật không chặn trang này nữa.
    if (url.includes("/api/auth/me")) return json({ user, hasChannels: true });
    if (/\/api\/channels(\?|$)/.test(url)) return json(channelsPayload);
    if (url.includes("/api/notifications")) return json({ items: [], unread: 0 });
    if (url.includes("/api/subscription/me")) {
      return json({
        exempt: true,
        hasSubscription: false,
        plan: null,
        subscription: null,
        usage: { channels: 1, staff: 0, ordersThisMonth: 0 },
        orders: { limit: null, used: 0, ratio: null, state: "OK", graceDeadline: null },
        expiry: { expired: false, lockDeadline: null, locked: false },
        locked: false,
        lockedReason: null,
        upgradePlans: [],
        payment: null,
        pendingUpgradeRequest: null,
      });
    }
    return json({});
  });

  await ctx.addInitScript(([u]) => {
    localStorage.setItem("hubsell_token", "demo-token");
    localStorage.setItem("hubsell_user", JSON.stringify(u));
  }, [user]);

  const page = await ctx.newPage();

  // % viewport của tâm + kích thước một element — nạp vào TOUR_STEPS.
  const pct = async (locator) => {
    const b = await locator.boundingBox();
    if (!b) throw new Error("Không lấy được boundingBox");
    const r = (v) => Math.round(v * 100) / 100;
    return {
      x: r(((b.x + b.width / 2) / VIEW.width) * 100),
      y: r(((b.y + b.height / 2) / VIEW.height) * 100),
      w: r((b.width / VIEW.width) * 100),
      h: r((b.height / VIEW.height) * 100),
    };
  };
  const targets = {};

  // ---- Ảnh 1: trang Kênh bán trống (sidebar + nút Kết nối gian hàng) ----
  await page.goto("http://localhost:3000/channels", { waitUntil: "domcontentloaded" });
  const navLink = page.getByRole("link", { name: "Kênh bán" });
  await navLink.waitFor({ timeout: 30000 });
  await page.getByText("Chưa kết nối gian hàng nào").waitFor();
  await page.waitForTimeout(1200); // đợi font + icon nạp xong

  targets.navChannels = await pct(navLink);
  targets.connectButton = await pct(
    page.getByRole("button", { name: "Kết nối gian hàng" })
  );
  await page.screenshot({ path: path.join(OUT, "onboard-channels-empty.png") });

  // ---- Ảnh 2: dialog Kết nối gian hàng (Shopee mặc định) ----
  await page.getByRole("button", { name: "Kết nối gian hàng" }).click();
  const select = page.locator("#channel-select");
  await select.waitFor();
  const oauthBtn = page.getByRole("button", { name: /Tiếp tục với Shopee/ });
  await oauthBtn.waitFor();
  await page.waitForTimeout(500); // đợi animation mở dialog đứng yên

  targets.platformSelect = await pct(select);
  targets.oauthButton = await pct(oauthBtn);
  await page.screenshot({ path: path.join(OUT, "onboard-connect-dialog.png") });

  // ---- Ảnh 3: gian Shopee đã kết nối + nút Đồng bộ đơn ----
  channelsPayload = [connectedChannel];
  await page.goto("http://localhost:3000/channels", { waitUntil: "domcontentloaded" });
  const syncBtn = page.getByRole("button", { name: "Đồng bộ đơn", exact: true });
  await syncBtn.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);

  targets.syncButton = await pct(syncBtn);
  await page.screenshot({ path: path.join(OUT, "onboard-channel-connected.png") });

  await browser.close();
  console.log("DONE: 3 anh da luu vao", OUT);
  console.log("TOA DO MUC TIEU (% viewport) — dan vao TOUR_STEPS:");
  console.log(JSON.stringify(targets, null, 2));
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
