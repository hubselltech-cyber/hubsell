/**
 * Chụp ảnh GIAO DIỆN THẬT của hub Hàng hóa cho bộ slide "Quản lý kho".
 *
 * Cùng cơ chế với capture-guide-assets.js: mở frontend thật (localhost:3000)
 * bằng Chromium headless, chặn mọi request /api/* trả dữ liệu mẫu — render đúng
 * 100% giao diện production mà không cần backend hay đăng nhập thật.
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

const channels = [
  {
    id: "c1", channelName: "SHOPEE", shopName: "ANO Official Store",
    externalShopId: "128600269", apiToken: "shp_41ef08c2a97f31d2b6f4",
    status: "ACTIVE", feeRate: "0", createdAt: "2026-07-01T00:00:00.000Z",
    apiConnected: true, _count: { orders: 963, channelProducts: 493 },
    matchedProductCount: 87,
  },
  {
    id: "c2", channelName: "LAZADA", shopName: "DarkMan",
    externalShopId: "400123", apiToken: "lzd_9f31d2b6a97f41ef08aa",
    status: "ACTIVE", feeRate: "0", createdAt: "2026-07-10T00:00:00.000Z",
    apiConnected: true, _count: { orders: 214, channelProducts: 260 },
    matchedProductCount: 52,
  },
];

// ===== Tab TỒN KHO: SKU kho với cột "Bán trên" đủ các trạng thái =====
const products = [
  {
    id: "p1", skuCode: "BLT002-CAFE14",
    productName: "Túi Xách Nam Nữ Công Sở ANO, Cặp Đựng Laptop 14, 15, 15.6 inch BLT002",
    costPrice: 145000, sellingPrice: 279000, quantityInStock: 41, holdQuantity: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [{ channelSku: "BLT002-CAFE14", channelName: "SHOPEE", shopName: "ANO Official Store" }],
    hasSyncAlert: false,
  },
  {
    id: "p2", skuCode: "ANOC01-LOGO",
    productName: "Túi đeo chéo ANO CHIBI LOVE nhiều ngăn khóa chống thấm ANOC02",
    costPrice: 98000, sellingPrice: 239000, quantityInStock: 1023, holdQuantity: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [
      { channelSku: "ANOC01-LOGO", channelName: "SHOPEE", shopName: "ANO Official Store" },
      { channelSku: "LZD-ANOC01", channelName: "LAZADA", shopName: "DarkMan" },
    ],
    hasSyncAlert: false,
  },
  {
    id: "p3", skuCode: "AK001-GACON",
    productName: "JumpSuit Hi.Bé, body áo khoác lông lót bông cho bé từ 3-10Kg AK001",
    costPrice: 62000, sellingPrice: 300000, quantityInStock: 68, holdQuantity: 3,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [{ channelSku: "AK001-GACON", channelName: "SHOPEE", shopName: "ANO Official Store" }],
    hasSyncAlert: false,
  },
  {
    id: "p4", skuCode: "AGN01-DEN",
    productName: "Áo gió nam nữ 2 lớp chống tia UV, chống nước AGN",
    costPrice: 55000, sellingPrice: 149000, quantityInStock: 7, holdQuantity: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [],
    hasSyncAlert: false,
  },
];

// ===== Tab CHỜ LIÊN KẾT: sản phẩm sàn chưa nối =====
const mkChannelProduct = (i, sku, name, price, channel) => ({
  id: `cp${i}`, channelSku: sku, productName: name, variantName: null,
  price, imageUrl: null, status: "ACTIVE", lastSyncedAt: "2026-08-15T13:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z", productId: null,
  channel: { id: channel.id, channelName: channel.channelName, shopName: channel.shopName },
  product: null,
});
const channelProducts = [
  mkChannelProduct(1, "ANOC01-CHIBI", "Túi đeo chéo ANO CHIBI LOVE nhiều ngăn khóa chống thấm ANOC02", 350000, channels[0]),
  mkChannelProduct(2, "ANOC02-LOVE", "Túi đeo chéo ANO CHIBI LOVE nhiều ngăn khóa chống thấm ANOC02", 239000, channels[0]),
  mkChannelProduct(3, "ANT01-TRANG-L", "Áo thun nam nữ cotton ANO x XWEAR ANT01", 300000, channels[0]),
  mkChannelProduct(4, "ANT01-TRANG-M", "Áo thun nam nữ cotton ANO x XWEAR ANT01", 300000, channels[0]),
  mkChannelProduct(5, "BL003-DEN", "Balo da nam ANO chính hãng, [KT: 44*30*18cm] đựng laptop 15,6inch BL003", 530000, channels[0]),
  mkChannelProduct(6, "BLT001", "Túi Xách Nam Nữ Công Sở REMOID Cặp Đựng Laptop 13 14 15 inch BLT001", 199000, channels[1]),
  mkChannelProduct(7, "BLT002-CAFE15", "Túi Xách Nam Nữ Công Sở REMOID Cặp Đựng Laptop 13 14 15 inch BLT002", 199000, channels[1]),
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // ảnh nét gấp đôi cho slide
    locale: "vi-VN",
    ignoreHTTPSErrors: true,
  });

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
    if (url.includes("/api/inventory/sync-settings"))
      return json({ autoSyncEnabled: false, safetyStockDefault: 0, updatedAt: null, pendingJobs: 0 });
    if (url.includes("/api/inventory/sync-alerts")) return json([]);
    if (url.includes("/api/inventory/sync-logs")) return json([]);
    if (url.includes("/api/inventory/sync-pending")) return json({ pending: 0 });
    if (url.includes("/channel-links")) return json([]);
    if (url.includes("/api/products"))
      return json({ items: products, total: products.length, page: 1, pageSize: 10, pageCount: 1 });
    if (url.includes("/api/mappings"))
      return json({
        items: channelProducts,
        total: 2757, page: 1, pageSize: 20, pageCount: 138,
        counts: { all: 2757, linked: 0, unlinked: 2757 },
      });
    return json({});
  });

  await ctx.addInitScript(([u]) => {
    localStorage.setItem("hubsell_token", "demo-token");
    localStorage.setItem("hubsell_user", JSON.stringify(u));
  }, [user]);

  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/products", { waitUntil: "domcontentloaded" });
  await page.getByText("BLT002-CAFE14").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200); // đợi font + icon nạp xong

  // 1) Tab Tồn kho — bảng SKU kho + cột Bán trên + chip Đồng bộ sàn
  await page.screenshot({ path: path.join(OUT, "products-inventory.png") });

  // 2) Tab Chờ liên kết — danh mục sàn + hàng nút tự khớp / đồng bộ
  await page.getByRole("button", { name: /^Chờ liên kết/ }).first().click();
  await page.getByText("ANOC01-CHIBI").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "products-link-tab.png") });

  // 3) Tick 2 dòng → thanh liên kết hàng loạt hiện dưới đáy
  await page.getByLabel("Chọn ANOC01-CHIBI").check();
  await page.getByLabel("Chọn ANOC02-LOVE").check();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "products-bulk-bar.png") });

  // 4) Dialog Cài đặt đồng bộ tồn kho
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Cài đặt" }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "sync-settings-dialog.png") });

  await browser.close();
  console.log("DONE: 4 anh da luu vao", OUT);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
