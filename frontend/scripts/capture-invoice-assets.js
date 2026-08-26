/**
 * Chá»¥p áº£nh GIAO DIá»†N THáº¬T cá»§a module HÃ³a Ä‘Æ¡n & Thuáº¿ cho bá»™ slide hÆ°á»›ng dáº«n
 * "Káº¿t ná»‘i & Xuáº¥t hÃ³a Ä‘Æ¡n" (public/huong-dan-xuat-hoa-don.html).
 *
 * CÃ¹ng cÆ¡ cháº¿ vá»›i capture-guide-assets.js: má»Ÿ frontend tháº­t (localhost:3000)
 * báº±ng Chromium headless, cháº·n má»i request /api/* vÃ  tráº£ dá»¯ liá»‡u máº«u â€” render
 * Ä‘Ãºng 100% giao diá»‡n production mÃ  khÃ´ng cáº§n backend hay tÃ i khoáº£n MISA tháº­t.
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

// Cáº¥u hÃ¬nh hÃ³a Ä‘Æ¡n MáºªU â€” shop demo Sunny Closet (trÃ¹ng bá»™ data demo landing),
// Ä‘Ã£ Ä‘iá»n Ä‘á»§ 3 bÆ°á»›c Ä‘á»ƒ áº£nh thá»ƒ hiá»‡n tráº¡ng thÃ¡i "cáº¥u hÃ¬nh xong".
const invoiceConfig = {
  taxCode: "0109734512",
  companyName: "Há»˜ KINH DOANH SUNNY CLOSET",
  companyAddress: "123 Nguyá»…n TrÃ£i, P. ThÆ°á»£ng ÄÃ¬nh, Q. Thanh XuÃ¢n, HÃ  Ná»™i",
  provider: "MISA",
  partnerCode: "HUBSELL-ISV-2026",
  clientId: "",
  customApiUrl: "",
  invoicePattern: "1",
  invoiceSeries: "1C26TAA",
  hasSecretKey: false,
  secretKeyMasked: null,
  meinvoiceUsername: "sunnycloset@gmail.com",
  hasMeinvoicePassword: true,
  meinvoicePasswordMasked: "suâ€¢â€¢â€¢â€¢â€¢â€¢et",
  signMethod: "ESIGN_CLOUD",
  esignClientId: "",
  esignUsername: "",
  certSerial: "",
  hasEsignSecretKey: false,
  esignSecretKeyMasked: null,
  hasEsignPassword: false,
  esignPasswordMasked: null,
  posProvider: "MISA",
  posClientId: "",
  posCodePrefix: "",
  posMachineId: "",
  posSeries: "",
  hasPosSecretKey: false,
  posSecretKeyMasked: null,
  defaultInvoiceType: "STANDARD",
  defaultVatRate: 0,
};

// KÃ½ hiá»‡u kÃ©o vá» tá»« meInvoice sau khi Test káº¿t ná»‘i OK.
const templates = [
  { invSeries: "1C26TAA", invTemplateNo: "1", templateName: "HÃ³a Ä‘Æ¡n GTGT - cÃ³ mÃ£ - cÆ¡ báº£n" },
  { invSeries: "2C26TAB", invTemplateNo: "2", templateName: "HÃ³a Ä‘Æ¡n bÃ¡n hÃ ng - cÃ³ mÃ£" },
];

// HÃ ng chá» xuáº¥t hÃ³a Ä‘Æ¡n â€” Ä‘Æ¡n Ä‘Ã£ giao thÃ nh cÃ´ng, trá»™n 2 sÃ n, 2 Ä‘Æ¡n khÃ¡ch
// "Cáº§n HÄ", trá»™n Ä‘Ã£/chÆ°a Ä‘á»‘i soÃ¡t cho Ä‘á»§ badge trÃªn áº£nh.
const queueRows = [
  { orderCode: "2508190SNKXR7T", customerName: "Ngá»c Anh", totalAmount: 356000, orderedAt: "2026-08-19T09:12:00.000Z", isSettled: true, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: { type: "COMPANY", hint: "MST 0312456789 â€” CTY TNHH Hoa Ban Mai" } },
  { orderCode: "2508200QWE2MHA", customerName: "Tráº§n VÄƒn HÃ¹ng", totalAmount: 512000, orderedAt: "2026-08-20T14:03:00.000Z", isSettled: true, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: { type: "PERSONAL", hint: null } },
  { orderCode: "2508210P1L9KDD", customerName: "Mai PhÆ°Æ¡ng", totalAmount: 189000, orderedAt: "2026-08-21T08:45:00.000Z", isSettled: true, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
  { orderCode: "836512094817263", customerName: "LÃª Thu HÃ ", totalAmount: 742000, orderedAt: "2026-08-21T19:27:00.000Z", isSettled: true, channelName: "LAZADA", shopName: "Sunny Kids", invoiceRequest: null },
  { orderCode: "2508220MB4TQ8N", customerName: "Pháº¡m Quá»‘c Báº£o", totalAmount: 268000, orderedAt: "2026-08-22T10:02:00.000Z", isSettled: false, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
  { orderCode: "836512094911042", customerName: "Äá»— Minh ChÃ¢u", totalAmount: 455000, orderedAt: "2026-08-22T16:40:00.000Z", isSettled: false, channelName: "LAZADA", shopName: "Sunny Kids", invoiceRequest: null },
  { orderCode: "2508230XCV81LP", customerName: "VÅ© Háº£i Yáº¿n", totalAmount: 320000, orderedAt: "2026-08-23T11:18:00.000Z", isSettled: false, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
  { orderCode: "2508240ZTR55KM", customerName: "BÃ¹i Anh Tuáº¥n", totalAmount: 615000, orderedAt: "2026-08-24T09:55:00.000Z", isSettled: false, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
];

const queue = {
  autoIssueEnabled: true,
  autoAdjustEnabled: true,
  configured: true,
  total: 23,
  settledTotal: 15,
  page: 1,
  pageSize: 20,
  rows: queueRows,
};

// Nháº­t kÃ½ hÃ³a Ä‘Æ¡n cho trang Lá»‹ch sá»­ & BÃ¡o cÃ¡o thuáº¿.
const logBase = {
  provider: "MISA",
  platformTaxWithheld: 0,
  errorMessage: null,
  adjustmentForLogId: null,
  hasAdjustment: false,
  needsAdjustment: false,
  returnInfo: null,
};
const logs = [
  { ...logBase, id: "l6", orderCode: "2508190SNKXR7T", invoiceNo: "00000132", transactionId: "TX-132", status: "ISSUED", totalAmount: 356000, vatAmount: 0, issuedAt: "2026-08-24T10:15:00.000Z", createdAt: "2026-08-24T10:15:00.000Z", needsAdjustment: true, returnInfo: { platformStatus: "ACCEPTED", refundAmount: 356000, returnedItems: 2 } },
  { ...logBase, id: "l5", orderCode: "2508180K2M7QQA", invoiceNo: "00000131", transactionId: "TX-131", status: "ISSUED", totalAmount: 428000, vatAmount: 0, issuedAt: "2026-08-23T09:02:00.000Z", createdAt: "2026-08-23T09:02:00.000Z" },
  { ...logBase, id: "l4", orderCode: "2508170H8P3WWE", invoiceNo: "00000130", transactionId: "TX-130", status: "ISSUED", totalAmount: -215000, vatAmount: 0, issuedAt: "2026-08-22T15:31:00.000Z", createdAt: "2026-08-22T15:31:00.000Z", adjustmentForLogId: "l2" },
  { ...logBase, id: "l3", orderCode: "836512094700518", invoiceNo: "00000129", transactionId: "TX-129", status: "ISSUED", totalAmount: 742000, vatAmount: 0, issuedAt: "2026-08-22T08:44:00.000Z", createdAt: "2026-08-22T08:44:00.000Z" },
  { ...logBase, id: "l2", orderCode: "2508170H8P3WWE", invoiceNo: "00000128", transactionId: "TX-128", status: "ISSUED", totalAmount: 215000, vatAmount: 0, issuedAt: "2026-08-21T13:10:00.000Z", createdAt: "2026-08-21T13:10:00.000Z", hasAdjustment: true },
  { ...logBase, id: "l1", orderCode: "2508160A4B9NNC", invoiceNo: "00000127", transactionId: "TX-127", status: "ISSUED", totalAmount: 199000, vatAmount: 0, issuedAt: "2026-08-21T10:05:00.000Z", createdAt: "2026-08-21T10:05:00.000Z" },
];

const taxReport = {
  settings: {
    customTaxPercent: 0,
    calculationBase: "REVENUE",
    filterPeriod: "MONTH",
    platformTaxPercent: 1.5,
  },
  summary: {
    orderCount: 214,
    settledCount: 178,
    grossRevenue: 86400000,
    platformTaxActual: 1074000,
    platformTaxEstimated: 222000,
    platformTaxTotal: 1296000,
    additionalTax: 0,
    additionalTaxBase: 86400000,
  },
  invoiceSummary: {
    issuedCount: 128,
    adjustmentCount: 3,
    failedCount: 0,
    needsAdjustmentCount: 1,
    invoicedAmount: 41250000,
    invoicedVat: 0,
    adjustedAmount: 878000,
  },
  logs,
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2, // áº£nh nÃ©t gáº¥p Ä‘Ã´i cho slide
    locale: "vi-VN",
    ignoreHTTPSErrors: true,
  });

  // Cháº·n toÃ n bá»™ API â€” ká»ƒ cáº£ preflight CORS (frontend gá»i https://localhost:4000)
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
    // AppShell gá»i 3 API ná»n â€” tráº£ Ä‘Ãºng SHAPE Ä‘á»ƒ khÃ´ng vá»¡ trang:
    // channels lÃ  Máº¢NG, notifications lÃ  {items,unread}, subscription exempt
    // (áº©n banner tráº§n gÃ³i khá»i áº£nh chá»¥p).
    if (/\/api\/channels(\?|$)/.test(url)) return json([]);
    if (url.includes("/api/notifications")) return json({ items: [], unread: 0 });
    if (url.includes("/api/subscription/me")) {
      return json({
        exempt: true,
        hasSubscription: false,
        plan: null,
        subscription: null,
        usage: { channels: 2, staff: 0, ordersThisMonth: 214 },
        orders: { limit: null, used: 214, ratio: null, state: "OK", graceDeadline: null },
        expiry: { expired: false, lockDeadline: null, locked: false },
        locked: false,
        lockedReason: null,
        upgradePlans: [],
        payment: null,
        pendingUpgradeRequest: null,
      });
    }
    if (url.includes("/api/invoice-config/templates")) return json({ templates, source: "meinvoice" });
    if (url.includes("/api/invoice-config/test-meinvoice")) {
      return json({ ok: true, message: "Káº¿t ná»‘i meInvoice OK â€” tÃ i khoáº£n há»£p lá»‡." });
    }
    if (url.includes("/api/invoice-config")) return json({ config: invoiceConfig, channelKeys: [] });
    if (url.includes("/api/tax/invoice-queue")) return json(queue);
    if (url.includes("/api/tax/report")) return json(taxReport);
    return json({});
  });

  // Gieo phiÃªn Ä‘Äƒng nháº­p trÆ°á»›c khi trang cháº¡y script
  await ctx.addInitScript(([u]) => {
    localStorage.setItem("hubsell_token", "demo-token");
    localStorage.setItem("hubsell_user", JSON.stringify(u));
  }, [user]);

  const page = await ctx.newPage();

  // ---- 1+2) Trang Káº¿t ná»‘i & Xuáº¥t hÃ³a Ä‘Æ¡n â€” tab Xuáº¥t hÃ³a Ä‘Æ¡n (máº·c Ä‘á»‹nh) ----
  await page.goto("http://localhost:3000/invoicing/connect", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Cáº¥u hÃ¬nh káº¿t ná»‘i" }).waitFor({ timeout: 30000 });
  await page.getByText("2508190SNKXR7T").waitFor();
  await page.waitForTimeout(1200); // Ä‘á»£i font + icon náº¡p xong

  // áº¢nh 1: hÃ ng chá» nguyÃªn tráº¡ng (chÆ°a tick)
  await page.screenshot({ path: path.join(OUT, "invoice-issue-tab.png") });

  // áº¢nh 2: tick 3 Ä‘Æ¡n Ä‘Ã£ Ä‘á»‘i soÃ¡t â†’ thanh hÃ nh Ä‘á»™ng hÃ ng loáº¡t hiá»‡n ra
  for (const code of ["2508190SNKXR7T", "2508200QWE2MHA", "2508210P1L9KDD"]) {
    await page.getByRole("checkbox", { name: `Chá»n Ä‘Æ¡n ${code}` }).check();
  }
  await page.getByRole("button", { name: /Xuáº¥t 3 hÃ³a Ä‘Æ¡n/ }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "invoice-issue-selected.png") });

  // ---- 3) Tab Cáº¥u hÃ¬nh káº¿t ná»‘i â€” form 3 bÆ°á»›c Ä‘Ã£ Ä‘iá»n ----
  await page.getByRole("tab", { name: "Cáº¥u hÃ¬nh káº¿t ná»‘i" }).click();
  await page.getByText("1 Â· ThÃ´ng tin PhÃ¡p nhÃ¢n / Há»™ kinh doanh").waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "invoice-config-tab.png") });

  // ---- 4) Báº¥m Test â†’ badge "ÄÃ£ káº¿t ná»‘i" + kÃ½ hiá»‡u kÃ©o vá» thÃ nh dropdown,
  //      rá»“i cuá»™n xuá»‘ng cuá»‘i form: kÃ½ hiá»‡u + thuáº¿ suáº¥t GTGT + nÃºt LÆ°u cáº¥u hÃ¬nh ----
  await page.getByRole("button", { name: "Test" }).click();
  await page.getByText("ÄÃ£ káº¿t ná»‘i").waitFor();
  // Ä‘á»£i toast sonner tá»± táº¯t Ä‘á»ƒ áº£nh sáº¡ch
  await page.waitForTimeout(4800);
  await page.getByRole("button", { name: "LÆ°u cáº¥u hÃ¬nh" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "invoice-config-bottom.png") });

  // ---- 5) Trang Lá»‹ch sá»­ & BÃ¡o cÃ¡o thuáº¿ ----
  // Ná»›i viewport Ä‘á»ƒ báº£ng nháº­t kÃ½ hiá»‡n trá»n cá»™t thao tÃ¡c (nÃºt Táº£i PDF) bÃªn pháº£i.
  await page.setViewportSize({ width: 1680, height: 960 });
  await page.goto("http://localhost:3000/invoicing/history", { waitUntil: "domcontentloaded" });
  await page.getByText("00000131").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, "invoice-history.png") });

  await browser.close();
  console.log("DONE: 5 anh da luu vao", OUT);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
