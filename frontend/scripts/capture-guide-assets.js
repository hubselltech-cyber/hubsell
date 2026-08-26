/**
 * Chụp ảnh GIAO DIỆN THẬT của Hubsell cho bộ slide hướng dẫn.
 *
 * Cách hoạt động: mở frontend thật (localhost:3000) bằng Chromium headless,
 * chặn mọi request /api/* và trả dữ liệu mẫu — nhờ đó render đúng 100% giao
 * diện production mà không cần backend hay đăng nhập thật.
 */
const { chromium } = require("playwright");
const path = require("path");

const OUT = "D:/Claude Code/Hubsell/frontend/public/guide-assets";

const user = {
  id: "u1",
  fullName: "Chủ shop",
  email: "shop@hubsell.vn",
  role: "ADMIN",
  isPlatformAdmin: false,
  createdAt: "2026-06-01T00:00:00.000Z",
};

// 2 gian hàng mẫu — số liệu khớp bối cảnh thật (DarkMan 963 đơn)
const channels = [
  {
    id: "c1", channelName: "SHOPEE", shopName: "DarkMan Store",
    externalShopId: "128600269", apiToken: "shp_41ef08c2a97f31d2b6f4",
    status: "ACTIVE", feeRate: "0", createdAt: "2026-07-01T00:00:00.000Z",
    apiConnected: true, _count: { orders: 963, channelProducts: 120 },
    matchedProductCount: 87,
  },
  {
    id: "c2", channelName: "LAZADA", shopName: "Hi.Bé Official",
    externalShopId: "400123", apiToken: "lzd_9f31d2b6a97f41ef08aa",
    status: "ACTIVE", feeRate: "0", createdAt: "2026-07-10T00:00:00.000Z",
    apiConnected: true, _count: { orders: 214, channelProducts: 60 },
    matchedProductCount: 52,
  },
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // ảnh nét gấp đôi cho slide
    locale: "vi-VN",
    ignoreHTTPSErrors: true,
  });

  // Chặn toàn bộ API — kể cả preflight CORS (frontend gọi https://localhost:4000)
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
    if (url.includes("/api/auth/me")) return json({ user, hasChannels: true });
    if (/\/api\/channels(\?|$)/.test(url)) return json(channels);
    return json({});
  });

  // Gieo phiên đăng nhập trước khi trang chạy script
  await ctx.addInitScript(([u]) => {
    localStorage.setItem("hubsell_token", "demo-token");
    localStorage.setItem("hubsell_user", JSON.stringify(u));
  }, [user]);

  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/channels", { waitUntil: "domcontentloaded" });
  const connectBtn = page.getByRole("button", { name: "Kết nối gian hàng" });
  await connectBtn.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200); // đợi font + icon nạp xong

  // 1) Toàn trang Kênh bán
  await page.screenshot({ path: path.join(OUT, "channels-page.png") });

  // 2) Riêng khối gian hàng Shopee (có nút Đồng bộ đơn / Đồng bộ đối soát)
  const shopeeCard = page
    .locator("div[class*='shadow-sm']")
    .filter({ hasText: "DarkMan Store" })
    .first();
  await shopeeCard.screenshot({ path: path.join(OUT, "shopee-card.png") });

  // 3) Hộp thoại Kết nối gian hàng — mặc định Shopee
  await connectBtn.click();
  await page.getByText("Sàn thương mại").waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "connect-dialog-shopee.png") });

  // 4) Chuyển sang Lazada — hiện ô "Code uỷ quyền"
  await page.selectOption("#channel-select", "LAZADA");
  await page.getByText("Code uỷ quyền").waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "connect-dialog-lazada.png") });

  await browser.close();
  console.log("DONE: 4 anh da luu vao", OUT);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
