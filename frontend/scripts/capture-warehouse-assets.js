/**
 * Chá»¥p áº£nh GIAO DIá»†N THáº¬T cá»§a hub HÃ ng hÃ³a cho bá»™ slide "Quáº£n lÃ½ kho".
 *
 * CÃ¹ng cÆ¡ cháº¿ vá»›i capture-guide-assets.js: má»Ÿ frontend tháº­t (localhost:3000)
 * báº±ng Chromium headless, cháº·n má»i request /api/* tráº£ dá»¯ liá»‡u máº«u â€” render Ä‘Ãºng
 * 100% giao diá»‡n production mÃ  khÃ´ng cáº§n backend hay Ä‘Äƒng nháº­p tháº­t.
 */
const { chromium } = require("playwright");
const path = require("path");

const OUT = "D:/Claude Code/Hubsell/frontend/public/guide-assets";

const user = {
  id: "u1",
  fullName: "Chá»§ shop",
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

// ===== Tab Tá»’N KHO: SKU kho vá»›i cá»™t "BÃ¡n trÃªn" Ä‘á»§ cÃ¡c tráº¡ng thÃ¡i =====
const products = [
  {
    id: "p1", skuCode: "BLT002-CAFE14",
    productName: "TÃºi XÃ¡ch Nam Ná»¯ CÃ´ng Sá»Ÿ ANO, Cáº·p Äá»±ng Laptop 14, 15, 15.6 inch BLT002",
    costPrice: 145000, sellingPrice: 279000, quantityInStock: 41, holdQuantity: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [{ channelSku: "BLT002-CAFE14", channelName: "SHOPEE", shopName: "ANO Official Store" }],
    hasSyncAlert: false,
  },
  {
    id: "p2", skuCode: "ANOC01-LOGO",
    productName: "TÃºi Ä‘eo chÃ©o ANO CHIBI LOVE nhiá»u ngÄƒn khÃ³a chá»‘ng tháº¥m ANOC02",
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
    productName: "JumpSuit Hi.BÃ©, body Ã¡o khoÃ¡c lÃ´ng lÃ³t bÃ´ng cho bÃ© tá»« 3-10Kg AK001",
    costPrice: 62000, sellingPrice: 300000, quantityInStock: 68, holdQuantity: 3,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [{ channelSku: "AK001-GACON", channelName: "SHOPEE", shopName: "ANO Official Store" }],
    hasSyncAlert: false,
  },
  {
    id: "p4", skuCode: "AGN01-DEN",
    productName: "Ão giÃ³ nam ná»¯ 2 lá»›p chá»‘ng tia UV, chá»‘ng nÆ°á»›c AGN",
    costPrice: 55000, sellingPrice: 149000, quantityInStock: 7, holdQuantity: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [],
    hasSyncAlert: false,
  },
];

// ===== Tab CHá»œ LIÃŠN Káº¾T: sáº£n pháº©m sÃ n chÆ°a ná»‘i =====
const mkChannelProduct = (i, sku, name, price, channel) => ({
  id: `cp${i}`, channelSku: sku, productName: name, variantName: null,
  price, imageUrl: null, status: "ACTIVE", lastSyncedAt: "2026-08-15T13:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z", productId: null,
  channel: { id: channel.id, channelName: channel.channelName, shopName: channel.shopName },
  product: null,
});
const channelProducts = [
  mkChannelProduct(1, "ANOC01-CHIBI", "TÃºi Ä‘eo chÃ©o ANO CHIBI LOVE nhiá»u ngÄƒn khÃ³a chá»‘ng tháº¥m ANOC02", 350000, channels[0]),
  mkChannelProduct(2, "ANOC02-LOVE", "TÃºi Ä‘eo chÃ©o ANO CHIBI LOVE nhiá»u ngÄƒn khÃ³a chá»‘ng tháº¥m ANOC02", 239000, channels[0]),
  mkChannelProduct(3, "ANT01-TRANG-L", "Ão thun nam ná»¯ cotton ANO x XWEAR ANT01", 300000, channels[0]),
  mkChannelProduct(4, "ANT01-TRANG-M", "Ão thun nam ná»¯ cotton ANO x XWEAR ANT01", 300000, channels[0]),
  mkChannelProduct(5, "BL003-DEN", "Balo da nam ANO chÃ­nh hÃ£ng, [KT: 44*30*18cm] Ä‘á»±ng laptop 15,6inch BL003", 530000, channels[0]),
  mkChannelProduct(6, "BLT001", "TÃºi XÃ¡ch Nam Ná»¯ CÃ´ng Sá»Ÿ REMOID Cáº·p Äá»±ng Laptop 13 14 15 inch BLT001", 199000, channels[1]),
  mkChannelProduct(7, "BLT002-CAFE15", "TÃºi XÃ¡ch Nam Ná»¯ CÃ´ng Sá»Ÿ REMOID Cáº·p Äá»±ng Laptop 13 14 15 inch BLT002", 199000, channels[1]),
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // áº£nh nÃ©t gáº¥p Ä‘Ã´i cho slide
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
  await page.waitForTimeout(1200); // Ä‘á»£i font + icon náº¡p xong

  // 1) Tab Tá»“n kho â€” báº£ng SKU kho + cá»™t BÃ¡n trÃªn + chip Äá»“ng bá»™ sÃ n
  await page.screenshot({ path: path.join(OUT, "products-inventory.png") });

  // 2) Tab Chá» liÃªn káº¿t â€” danh má»¥c sÃ n + hÃ ng nÃºt tá»± khá»›p / Ä‘á»“ng bá»™
  await page.getByRole("button", { name: /^Chá» liÃªn káº¿t/ }).first().click();
  await page.getByText("ANOC01-CHIBI").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "products-link-tab.png") });

  // 3) Tick 2 dÃ²ng â†’ thanh liÃªn káº¿t hÃ ng loáº¡t hiá»‡n dÆ°á»›i Ä‘Ã¡y
  await page.getByLabel("Chá»n ANOC01-CHIBI").check();
  await page.getByLabel("Chá»n ANOC02-LOVE").check();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "products-bulk-bar.png") });

  // 4) Dialog CÃ i Ä‘áº·t Ä‘á»“ng bá»™ tá»“n kho
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "CÃ i Ä‘áº·t" }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "sync-settings-dialog.png") });

  await browser.close();
  console.log("DONE: 4 anh da luu vao", OUT);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
