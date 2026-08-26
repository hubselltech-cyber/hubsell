/**
 * Chá»¥p áº£nh GIAO DIá»†N THáº¬T + Tá»ŒA Äá»˜ má»¥c tiÃªu cho 3 TOUR Äá»˜NG cá»§a trang
 * HÆ°á»›ng dáº«n sá»­ dá»¥ng (/guide): Quáº£n lÃ½ kho, ÄÆ¡n hÃ ng & dÃ²ng tiá»n, HÃ³a Ä‘Æ¡n.
 * (Tour "LiÃªn káº¿t gian hÃ ng" tÃ¡i dÃ¹ng bá»™ áº£nh onboarding â€” khÃ´ng chá»¥p á»Ÿ Ä‘Ã¢y.)
 *
 * CÃ¹ng cÆ¡ cháº¿ capture-onboarding-assets.js: má»Ÿ frontend tháº­t (localhost:3000)
 * báº±ng Chromium headless, cháº·n /api/* tráº£ dá»¯ liá»‡u máº«u. áº¢nh 1440x960 (khá»›p
 * khung 3:2 cá»§a TourPlayer), lÆ°u public/guide-assets/tour/.
 *
 * In ra Tá»ŒA Äá»˜ % cá»§a tá»«ng má»¥c tiÃªu â€” dÃ¡n vÃ o lib/guide-tours.ts má»—i láº§n
 * chá»¥p láº¡i, káº»o con trá» áº£o chá»‰ tráº­t chá»—.
 */
const { chromium } = require("playwright");
const path = require("path");

const OUT = "D:/Claude Code/Hubsell/frontend/public/guide-assets/tour";
const VIEW = { width: 1440, height: 960 };

const user = {
  id: "u1",
  fullName: "Chá»§ shop",
  email: "shop@hubsell.vn",
  role: "ADMIN",
  isPlatformAdmin: false,
  createdAt: "2026-06-01T00:00:00.000Z",
};

// ===== Gian hÃ ng (trang KÃªnh bÃ¡n + filter má»i trang) =====
const channels = [
  {
    id: "c1", channelName: "SHOPEE", shopName: "Sunny Closet",
    externalShopId: "281534907", externalShopName: "Sunny Closet",
    apiToken: "shpk_live_5f2a81c9d3e7b640", status: "ACTIVE", feeRate: "0",
    createdAt: "2026-08-20T09:00:00.000Z", apiConnected: true,
    accessTokenExpireAt: "2026-09-20T09:00:00.000Z",
    _count: { orders: 1284, channelProducts: 96 }, matchedProductCount: 42,
  },
];

// ===== HÃ ng hÃ³a: SKU kho (tab Tá»“n kho) =====
const products = [
  {
    id: "p1", skuCode: "BLT002-CAFE14",
    productName: "TÃºi XÃ¡ch Ná»¯ CÃ´ng Sá»Ÿ Sunny, Cáº·p Äá»±ng Laptop 14, 15.6 inch BLT002",
    costPrice: 145000, sellingPrice: 279000, quantityInStock: 41, holdQuantity: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [{ channelSku: "BLT002-CAFE14", channelName: "SHOPEE", shopName: "Sunny Closet" }],
    hasSyncAlert: false,
  },
  {
    id: "p2", skuCode: "SNC01-LOGO",
    productName: "TÃºi Ä‘eo chÃ©o Sunny CHIBI nhiá»u ngÄƒn khÃ³a chá»‘ng tháº¥m SNC02",
    costPrice: 98000, sellingPrice: 239000, quantityInStock: 1023, holdQuantity: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [{ channelSku: "SNC01-LOGO", channelName: "SHOPEE", shopName: "Sunny Closet" }],
    hasSyncAlert: false,
  },
  {
    id: "p3", skuCode: "AK001-GACON",
    productName: "JumpSuit bÃ© yÃªu, body Ã¡o khoÃ¡c lÃ´ng lÃ³t bÃ´ng cho bÃ© 3-10Kg AK001",
    costPrice: 62000, sellingPrice: 300000, quantityInStock: 68, holdQuantity: 3,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [{ channelSku: "AK001-GACON", channelName: "SHOPEE", shopName: "Sunny Closet" }],
    hasSyncAlert: false,
  },
  {
    id: "p4", skuCode: "AGN01-DEN",
    productName: "Ão giÃ³ nam ná»¯ 2 lá»›p chá»‘ng tia UV, chá»‘ng nÆ°á»›c AGN",
    costPrice: 55000, sellingPrice: 149000, quantityInStock: 7, holdQuantity: 0,
    createdAt: "2026-08-01T00:00:00.000Z", channelLinks: [], hasSyncAlert: false,
  },
];

// ===== HÃ ng hÃ³a: sáº£n pháº©m sÃ n chÆ°a ná»‘i (tab Chá» liÃªn káº¿t) =====
const mkCp = (i, sku, name, price) => ({
  id: `cp${i}`, channelSku: sku, productName: name, variantName: null,
  price, imageUrl: null, status: "ACTIVE", lastSyncedAt: "2026-08-24T13:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z", productId: null,
  channel: { id: "c1", channelName: "SHOPEE", shopName: "Sunny Closet" },
  product: null,
});
const channelProducts = [
  mkCp(1, "SNC01-CHIBI", "TÃºi Ä‘eo chÃ©o Sunny CHIBI nhiá»u ngÄƒn khÃ³a chá»‘ng tháº¥m SNC02", 350000),
  mkCp(2, "SNC02-LOVE", "TÃºi Ä‘eo chÃ©o Sunny CHIBI nhiá»u ngÄƒn khÃ³a chá»‘ng tháº¥m SNC02", 239000),
  mkCp(3, "SNT01-TRANG-L", "Ão thun nam ná»¯ cotton Sunny basic SNT01", 300000),
  mkCp(4, "SNT01-TRANG-M", "Ão thun nam ná»¯ cotton Sunny basic SNT01", 300000),
  mkCp(5, "BL003-DEN", "Balo da Sunny chÃ­nh hÃ£ng, Ä‘á»±ng laptop 15,6 inch BL003", 530000),
];

// ===== ÄÆ¡n hÃ ng =====
const mkOrder = (i, code, name, amount, status, carrier, tracking) => ({
  id: `o${i}`, channelId: "c1", orderCode: code, customerName: name,
  customerPhone: null, totalAmount: amount, paymentStatus: "PAID",
  shippingStatus: status, carrier, shippingCarrierName: null,
  trackingCode: tracking, returnTrackingCode: null, packedAt: null,
  labelPrintedAt: null, itemCount: 1, returnStatus: "NONE", returnNote: null,
  returnedAt: null, returnRequestedAt: null, compensationAmount: 0,
  stockRestoredAt: null, createdAt: `2026-08-2${(i % 5) + 1}T0${i}:12:00.000Z`,
  channel: { channelName: "SHOPEE", shopName: "Sunny Closet" },
});
const orders = [
  mkOrder(1, "2508250SNKXR7T", "Ngá»c Anh", 356000, "PENDING", "SPX", "SPXVN0512345671"),
  mkOrder(2, "2508250QWE2MHA", "Tráº§n VÄƒn HÃ¹ng", 512000, "PENDING", "SPX", "SPXVN0512345672"),
  mkOrder(3, "2508240P1L9KDD", "Mai PhÆ°Æ¡ng", 189000, "PROCESSED", "GHTK", "GHTK512345673"),
  mkOrder(4, "2508230MB4TQ8N", "Pháº¡m Quá»‘c Báº£o", 268000, "SHIPPING", "SPX", "SPXVN0512345674"),
  mkOrder(5, "2508220XCV81LP", "VÅ© Háº£i Yáº¿n", 320000, "DELIVERED", "GHN", "GHN512345675"),
  mkOrder(6, "2508210ZTR55KM", "BÃ¹i Anh Tuáº¥n", 615000, "DELIVERED", "SPX", "SPXVN0512345676"),
];
const orderList = {
  items: orders,
  counts: { all: 1284, PENDING: 12, PROCESSED: 36, SHIPPING: 54, DELIVERED: 1163, CANCELLED: 19 },
  total: orders.length, page: 1, pageSize: 20, pageCount: 1,
};

// ===== Cáº¥u hÃ¬nh GiÃ¡ vá»‘n =====
const skuProducts = {
  channel: "all",
  total: 4,
  missingCostCount: 1,
  items: [
    { skuId: "s1", productId: "p1", sku: "BLT002-CAFE14", productName: "TÃºi XÃ¡ch Ná»¯ CÃ´ng Sá»Ÿ Sunny BLT002", variantName: "Cafe 14 inch", channelName: "SHOPEE", imageUrl: null, sellingPrice: "279000", costPrice: "145000", linked: true },
    { skuId: "s2", productId: "p2", sku: "SNC01-LOGO", productName: "TÃºi Ä‘eo chÃ©o Sunny CHIBI SNC02", variantName: null, channelName: "SHOPEE", imageUrl: null, sellingPrice: "239000", costPrice: "98000", linked: true },
    { skuId: "s3", productId: "p3", sku: "AK001-GACON", productName: "JumpSuit bÃ© yÃªu AK001", variantName: "GÃ  con", channelName: "SHOPEE", imageUrl: null, sellingPrice: "300000", costPrice: "62000", linked: true },
    { skuId: "s4", productId: "", sku: "AGN01-DEN", productName: "Ão giÃ³ nam ná»¯ 2 lá»›p AGN", variantName: "Äen", channelName: "SHOPEE", imageUrl: null, sellingPrice: "149000", costPrice: "0", linked: false },
  ],
};

// ===== HÃ³a Ä‘Æ¡n (cÃ¹ng bá»™ máº«u capture-invoice-assets.js) =====
const invoiceConfig = {
  taxCode: "0109734512", companyName: "Há»˜ KINH DOANH SUNNY CLOSET",
  companyAddress: "123 Nguyá»…n TrÃ£i, P. ThÆ°á»£ng ÄÃ¬nh, Q. Thanh XuÃ¢n, HÃ  Ná»™i",
  provider: "MISA", partnerCode: "HUBSELL-ISV-2026", clientId: "", customApiUrl: "",
  invoicePattern: "1", invoiceSeries: "1C26TAA", hasSecretKey: false, secretKeyMasked: null,
  meinvoiceUsername: "sunnycloset@gmail.com", hasMeinvoicePassword: true,
  meinvoicePasswordMasked: "suâ€¢â€¢â€¢â€¢â€¢â€¢et", signMethod: "ESIGN_CLOUD",
  esignClientId: "", esignUsername: "", certSerial: "", hasEsignSecretKey: false,
  esignSecretKeyMasked: null, hasEsignPassword: false, esignPasswordMasked: null,
  posProvider: "MISA", posClientId: "", posCodePrefix: "", posMachineId: "",
  posSeries: "", hasPosSecretKey: false, posSecretKeyMasked: null,
  defaultInvoiceType: "STANDARD", defaultVatRate: 0,
};
const invTemplates = [
  { invSeries: "1C26TAA", invTemplateNo: "1", templateName: "HÃ³a Ä‘Æ¡n GTGT - cÃ³ mÃ£ - cÆ¡ báº£n" },
  { invSeries: "2C26TAB", invTemplateNo: "2", templateName: "HÃ³a Ä‘Æ¡n bÃ¡n hÃ ng - cÃ³ mÃ£" },
];
const queueRows = [
  { orderCode: "2508190SNKXR7T", customerName: "Ngá»c Anh", totalAmount: 356000, orderedAt: "2026-08-19T09:12:00.000Z", isSettled: true, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: { type: "COMPANY", hint: "MST 0312456789 â€” CTY TNHH Hoa Ban Mai" } },
  { orderCode: "2508200QWE2MHA", customerName: "Tráº§n VÄƒn HÃ¹ng", totalAmount: 512000, orderedAt: "2026-08-20T14:03:00.000Z", isSettled: true, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
  { orderCode: "2508210P1L9KDD", customerName: "Mai PhÆ°Æ¡ng", totalAmount: 189000, orderedAt: "2026-08-21T08:45:00.000Z", isSettled: true, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
  { orderCode: "2508220MB4TQ8N", customerName: "Pháº¡m Quá»‘c Báº£o", totalAmount: 268000, orderedAt: "2026-08-22T10:02:00.000Z", isSettled: false, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
  { orderCode: "2508230XCV81LP", customerName: "VÅ© Háº£i Yáº¿n", totalAmount: 320000, orderedAt: "2026-08-23T11:18:00.000Z", isSettled: false, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
];
const invoiceQueue = {
  autoIssueEnabled: false, autoAdjustEnabled: false, configured: true,
  total: 23, settledTotal: 15, page: 1, pageSize: 20, rows: queueRows,
};
const logBase = {
  provider: "MISA", platformTaxWithheld: 0, errorMessage: null,
  adjustmentForLogId: null, hasAdjustment: false, needsAdjustment: false, returnInfo: null,
};
const invoiceLogs = [
  { ...logBase, id: "l3", orderCode: "2508190SNKXR7T", invoiceNo: "00000132", transactionId: "TX-132", status: "ISSUED", totalAmount: 356000, vatAmount: 0, issuedAt: "2026-08-24T10:15:00.000Z", createdAt: "2026-08-24T10:15:00.000Z" },
  { ...logBase, id: "l2", orderCode: "2508180K2M7QQA", invoiceNo: "00000131", transactionId: "TX-131", status: "ISSUED", totalAmount: 428000, vatAmount: 0, issuedAt: "2026-08-23T09:02:00.000Z", createdAt: "2026-08-23T09:02:00.000Z" },
  { ...logBase, id: "l1", orderCode: "2508160A4B9NNC", invoiceNo: "00000130", transactionId: "TX-130", status: "ISSUED", totalAmount: 199000, vatAmount: 0, issuedAt: "2026-08-21T10:05:00.000Z", createdAt: "2026-08-21T10:05:00.000Z" },
];
const taxReport = {
  settings: { customTaxPercent: 0, calculationBase: "REVENUE", filterPeriod: "MONTH", platformTaxPercent: 1.5 },
  summary: { orderCount: 214, settledCount: 178, grossRevenue: 86400000, platformTaxActual: 1074000, platformTaxEstimated: 222000, platformTaxTotal: 1296000, additionalTax: 0, additionalTaxBase: 86400000 },
  invoiceSummary: { issuedCount: 128, adjustmentCount: 3, failedCount: 0, needsAdjustmentCount: 1, invoicedAmount: 41250000, invoicedVat: 0, adjustedAmount: 878000 },
  logs: invoiceLogs,
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 2,
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
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = req.url();
    const json = (o) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(o) });
    if (url.includes("/api/auth/me")) return json({ user, hasChannels: true });
    if (/\/api\/channels(\?|$)/.test(url)) return json(channels);
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
    // HÃ ng hÃ³a
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
        items: channelProducts, total: 96, page: 1, pageSize: 20, pageCount: 5,
        counts: { all: 96, linked: 42, unlinked: 54 },
      });
    // ÄÆ¡n hÃ ng
    if (url.includes("/api/orders")) return json(orderList);
    // GiÃ¡ vá»‘n
    if (url.includes("/api/finance/sku-products")) return json(skuProducts);
    // HÃ³a Ä‘Æ¡n
    if (url.includes("/api/invoice-config/templates")) return json({ templates: invTemplates, source: "meinvoice" });
    if (url.includes("/api/invoice-config/test-meinvoice"))
      return json({ ok: true, message: "Káº¿t ná»‘i meInvoice OK â€” tÃ i khoáº£n há»£p lá»‡." });
    if (url.includes("/api/invoice-config")) return json({ config: invoiceConfig, channelKeys: [] });
    if (url.includes("/api/tax/invoice-queue")) return json(invoiceQueue);
    if (url.includes("/api/tax/report")) return json(taxReport);
    return json({});
  });

  await ctx.addInitScript(([u]) => {
    localStorage.setItem("hubsell_token", "demo-token");
    localStorage.setItem("hubsell_user", JSON.stringify(u));
  }, [user]);

  const page = await ctx.newPage();

  const r = (v) => Math.round(v * 100) / 100;
  const pct = async (locator) => {
    const b = await locator.boundingBox();
    if (!b) throw new Error("KhÃ´ng láº¥y Ä‘Æ°á»£c boundingBox");
    return {
      x: r(((b.x + b.width / 2) / VIEW.width) * 100),
      y: r(((b.y + b.height / 2) / VIEW.height) * 100),
      w: r((b.width / VIEW.width) * 100),
      h: r((b.height / VIEW.height) * 100),
    };
  };
  // Gá»™p bbox 2 locator thÃ nh má»™t khung (vd 2 má»¥c menu liá»n nhau)
  const pctUnion = async (l1, l2) => {
    const a = await l1.boundingBox();
    const b = await l2.boundingBox();
    if (!a || !b) throw new Error("KhÃ´ng láº¥y Ä‘Æ°á»£c boundingBox (union)");
    const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x + a.width, b.x + b.width);
    const y2 = Math.max(a.y + a.height, b.y + b.height);
    return {
      x: r(((x1 + x2) / 2 / VIEW.width) * 100),
      y: r(((y1 + y2) / 2 / VIEW.height) * 100),
      w: r(((x2 - x1) / VIEW.width) * 100),
      h: r(((y2 - y1) / VIEW.height) * 100),
    };
  };
  const targets = { kho: {}, donhang: {}, hoadon: {} };

  // ================= TOUR KHO =================
  await page.goto("http://localhost:3000/products", { waitUntil: "domcontentloaded" });
  await page.getByText("BLT002-CAFE14").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);

  // áº¢nh 1: tab Tá»“n kho
  targets.kho.navProducts = await pct(page.getByRole("link", { name: "HÃ ng hÃ³a" }));
  targets.kho.colSellOn = await pct(page.getByText("BÃ¡n trÃªn").first());
  targets.kho.btnSettings = await pct(page.getByRole("button", { name: "CÃ i Ä‘áº·t" }));
  await page.screenshot({ path: path.join(OUT, "kho-inventory.png") });

  // áº¢nh 2: tab Chá» liÃªn káº¿t
  await page.getByRole("button", { name: /^Chá» liÃªn káº¿t/ }).first().click();
  await page.getByText("SNC01-CHIBI").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(900);
  targets.kho.tabLinks = await pct(page.getByRole("button", { name: /^Chá» liÃªn káº¿t/ }).first());
  targets.kho.btnSyncFromChannels = await pct(page.getByRole("button", { name: "Äá»“ng bá»™ tá»« sÃ n" }).first());
  targets.kho.btnAutoAll = await pct(page.getByRole("button", { name: "Tá»± khá»›p + táº¡o SKU toÃ n bá»™" }));
  await page.screenshot({ path: path.join(OUT, "kho-links.png") });

  // áº¢nh 3: tick 2 dÃ²ng â†’ thanh liÃªn káº¿t hÃ ng loáº¡t
  await page.getByLabel("Chá»n SNC01-CHIBI").check();
  await page.getByLabel("Chá»n SNC02-LOVE").check();
  await page.waitForTimeout(600);
  targets.kho.bulkBar = await pct(page.getByLabel("LiÃªn káº¿t hÃ ng loáº¡t"));
  await page.screenshot({ path: path.join(OUT, "kho-bulk.png") });

  // áº¢nh 4: dialog CÃ i Ä‘áº·t Ä‘á»“ng bá»™ tá»“n
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "CÃ i Ä‘áº·t" }).click();
  await page.getByText("Tá»± Ä‘á»™ng Ä‘á»“ng bá»™").first().waitFor();
  await page.waitForTimeout(900);
  targets.kho.switchAutoSync = await pct(page.getByLabel("Báº­t/táº¯t tá»± Ä‘á»™ng Ä‘á»“ng bá»™ tá»“n kho"));
  targets.kho.btnSyncAll = await pct(page.getByRole("button", { name: "Sync ngay toÃ n bá»™" }));
  await page.screenshot({ path: path.join(OUT, "kho-sync-dialog.png") });

  // ================= TOUR ÄÆ N HÃ€NG =================
  // áº¢nh 1: trang ÄÆ¡n hÃ ng
  await page.goto("http://localhost:3000/orders", { waitUntil: "domcontentloaded" });
  await page.getByText("2508250SNKXR7T").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  targets.donhang.navOrders = await pct(page.getByRole("link", { name: "ÄÆ¡n hÃ ng" }));
  targets.donhang.ordersTable = await pct(page.locator("table").first());
  await page.screenshot({ path: path.join(OUT, "dh-orders.png") });

  // áº¢nh 2: trang KÃªnh bÃ¡n â€” nÃºt Äá»“ng bá»™ Ä‘Æ¡n / Äá»“ng bá»™ Ä‘á»‘i soÃ¡t
  await page.goto("http://localhost:3000/channels", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Äá»“ng bá»™ Ä‘Æ¡n", exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  targets.donhang.btnSyncOrders = await pct(page.getByRole("button", { name: "Äá»“ng bá»™ Ä‘Æ¡n", exact: true }));
  targets.donhang.btnSyncSettle = await pct(page.getByRole("button", { name: "Äá»“ng bá»™ Ä‘á»‘i soÃ¡t" }));
  await page.screenshot({ path: path.join(OUT, "dh-channels.png") });

  // áº¢nh 3: Cáº¥u hÃ¬nh GiÃ¡ vá»‘n (sidebar nhÃ³m TÃ i chÃ­nh Ä‘ang má»Ÿ)
  await page.goto("http://localhost:3000/finance/cost-prices", { waitUntil: "domcontentloaded" });
  await page.getByText("BLT002-CAFE14").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  targets.donhang.navCostPrices = await pct(page.getByRole("link", { name: "Cáº¥u hÃ¬nh GiÃ¡ vá»‘n" }));
  targets.donhang.costInput = await pct(page.locator("table input").first());
  targets.donhang.navReports = await pctUnion(
    page.getByRole("link", { name: "BÃ¡o cÃ¡o dÃ²ng tiá»n" }),
    page.getByRole("link", { name: "LÃ£i/Lá»— Thá»±c Hiá»‡n" })
  );
  await page.screenshot({ path: path.join(OUT, "dh-costs.png") });

  // ================= TOUR HÃ“A ÄÆ N =================
  // áº¢nh 1: tab Cáº¥u hÃ¬nh káº¿t ná»‘i (form Ä‘Ã£ Ä‘iá»n)
  await page.goto("http://localhost:3000/invoicing/connect", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Cáº¥u hÃ¬nh káº¿t ná»‘i" }).waitFor({ timeout: 30000 });
  await page.getByText("2508190SNKXR7T").waitFor();
  await page.waitForTimeout(1200);
  // (tab Xuáº¥t hÃ³a Ä‘Æ¡n lÃ  máº·c Ä‘á»‹nh â€” láº¥y tá»a Ä‘á»™ trÃªn áº£nh hd-issue trÆ°á»›c)
  targets.hoadon.tabConfig = await pct(page.getByRole("tab", { name: "Cáº¥u hÃ¬nh káº¿t ná»‘i" }));
  targets.hoadon.switchAutoIssue = await pct(page.getByText("Tá»± Ä‘á»™ng phÃ¡t hÃ nh").first());
  // Tick 3 Ä‘Æ¡n Ä‘Ã£ Ä‘á»‘i soÃ¡t â†’ nÃºt xuáº¥t hÃ ng loáº¡t
  for (const code of ["2508190SNKXR7T", "2508200QWE2MHA", "2508210P1L9KDD"]) {
    await page.getByRole("checkbox", { name: `Chá»n Ä‘Æ¡n ${code}` }).check();
  }
  const issueBtn = page.getByRole("button", { name: /Xuáº¥t 3 hÃ³a Ä‘Æ¡n/ });
  await issueBtn.waitFor();
  await page.waitForTimeout(400);
  targets.hoadon.btnIssue = await pct(issueBtn);
  await page.screenshot({ path: path.join(OUT, "hd-issue.png") });

  // áº¢nh 2: tab Cáº¥u hÃ¬nh káº¿t ná»‘i
  await page.getByRole("tab", { name: "Cáº¥u hÃ¬nh káº¿t ná»‘i" }).click();
  const legalBlock = page.getByText("1 Â· ThÃ´ng tin PhÃ¡p nhÃ¢n / Há»™ kinh doanh");
  await legalBlock.waitFor();
  await page.waitForTimeout(600);
  targets.hoadon.blockLegal = await pct(legalBlock);
  targets.hoadon.btnTest = await pct(page.getByRole("button", { name: "Test" }));
  await page.screenshot({ path: path.join(OUT, "hd-config.png") });

  // áº¢nh 3: sau Test â€” cuá»™n tá»›i cuá»‘i form (kÃ½ hiá»‡u + thuáº¿ suáº¥t + LÆ°u cáº¥u hÃ¬nh)
  await page.getByRole("button", { name: "Test" }).click();
  await page.getByText("ÄÃ£ káº¿t ná»‘i").waitFor();
  await page.waitForTimeout(4800); // Ä‘á»£i toast tá»± táº¯t cho áº£nh sáº¡ch
  await page.getByRole("button", { name: "LÆ°u cáº¥u hÃ¬nh" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  targets.hoadon.btnSave = await pct(page.getByRole("button", { name: "LÆ°u cáº¥u hÃ¬nh" }));
  await page.screenshot({ path: path.join(OUT, "hd-config-bottom.png") });

  // áº¢nh 4: Lá»‹ch sá»­ & BÃ¡o cÃ¡o thuáº¿ â€” nÃºt Táº£i PDF
  await page.goto("http://localhost:3000/invoicing/history", { waitUntil: "domcontentloaded" });
  await page.getByText("00000131").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  targets.hoadon.btnDownload = await pct(page.getByRole("button", { name: "Táº£i", exact: true }).first());
  await page.screenshot({ path: path.join(OUT, "hd-history.png") });

  await browser.close();
  console.log("DONE: 8 anh da luu vao", OUT);
  console.log("TOA DO MUC TIEU (% viewport) â€” dan vao lib/guide-tours.ts:");
  console.log(JSON.stringify(targets, null, 2));
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
