/**
 * Chụp ảnh GIAO DIỆN THẬT + TỌA ĐỘ mục tiêu cho 3 TOUR ĐỘNG của trang
 * Hướng dẫn sử dụng (/guide): Quản lý kho, Đơn hàng & dòng tiền, Hóa đơn.
 * (Tour "Liên kết gian hàng" tái dùng bộ ảnh onboarding — không chụp ở đây.)
 *
 * Cùng cơ chế capture-onboarding-assets.js: mở frontend thật (localhost:3000)
 * bằng Chromium headless, chặn /api/* trả dữ liệu mẫu. Ảnh 1440x960 (khớp
 * khung 3:2 của TourPlayer), lưu public/guide-assets/tour/.
 *
 * In ra TỌA ĐỘ % của từng mục tiêu — dán vào lib/guide-tours.ts mỗi lần
 * chụp lại, kẻo con trỏ ảo chỉ trật chỗ.
 */
const { chromium } = require("playwright");
const path = require("path");

const OUT = "D:/Claude Code/frontend/public/guide-assets/tour";
const VIEW = { width: 1440, height: 960 };

const user = {
  id: "u1",
  fullName: "Chủ shop",
  email: "shop@hubsell.vn",
  role: "ADMIN",
  isPlatformAdmin: false,
  createdAt: "2026-06-01T00:00:00.000Z",
};

// ===== Gian hàng (trang Kênh bán + filter mọi trang) =====
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

// ===== Hàng hóa: SKU kho (tab Tồn kho) =====
const products = [
  {
    id: "p1", skuCode: "BLT002-CAFE14",
    productName: "Túi Xách Nữ Công Sở Sunny, Cặp Đựng Laptop 14, 15.6 inch BLT002",
    costPrice: 145000, sellingPrice: 279000, quantityInStock: 41, holdQuantity: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [{ channelSku: "BLT002-CAFE14", channelName: "SHOPEE", shopName: "Sunny Closet" }],
    hasSyncAlert: false,
  },
  {
    id: "p2", skuCode: "SNC01-LOGO",
    productName: "Túi đeo chéo Sunny CHIBI nhiều ngăn khóa chống thấm SNC02",
    costPrice: 98000, sellingPrice: 239000, quantityInStock: 1023, holdQuantity: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [{ channelSku: "SNC01-LOGO", channelName: "SHOPEE", shopName: "Sunny Closet" }],
    hasSyncAlert: false,
  },
  {
    id: "p3", skuCode: "AK001-GACON",
    productName: "JumpSuit bé yêu, body áo khoác lông lót bông cho bé 3-10Kg AK001",
    costPrice: 62000, sellingPrice: 300000, quantityInStock: 68, holdQuantity: 3,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [{ channelSku: "AK001-GACON", channelName: "SHOPEE", shopName: "Sunny Closet" }],
    hasSyncAlert: false,
  },
  {
    id: "p4", skuCode: "AGN01-DEN",
    productName: "Áo gió nam nữ 2 lớp chống tia UV, chống nước AGN",
    costPrice: 55000, sellingPrice: 149000, quantityInStock: 7, holdQuantity: 0,
    createdAt: "2026-08-01T00:00:00.000Z", channelLinks: [], hasSyncAlert: false,
  },
];

// ===== Hàng hóa: sản phẩm sàn chưa nối (tab Chờ liên kết) =====
const mkCp = (i, sku, name, price) => ({
  id: `cp${i}`, channelSku: sku, productName: name, variantName: null,
  price, imageUrl: null, status: "ACTIVE", lastSyncedAt: "2026-08-24T13:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z", productId: null,
  channel: { id: "c1", channelName: "SHOPEE", shopName: "Sunny Closet" },
  product: null,
});
const channelProducts = [
  mkCp(1, "SNC01-CHIBI", "Túi đeo chéo Sunny CHIBI nhiều ngăn khóa chống thấm SNC02", 350000),
  mkCp(2, "SNC02-LOVE", "Túi đeo chéo Sunny CHIBI nhiều ngăn khóa chống thấm SNC02", 239000),
  mkCp(3, "SNT01-TRANG-L", "Áo thun nam nữ cotton Sunny basic SNT01", 300000),
  mkCp(4, "SNT01-TRANG-M", "Áo thun nam nữ cotton Sunny basic SNT01", 300000),
  mkCp(5, "BL003-DEN", "Balo da Sunny chính hãng, đựng laptop 15,6 inch BL003", 530000),
];

// ===== Đơn hàng =====
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
  mkOrder(1, "2508250SNKXR7T", "Ngọc Anh", 356000, "PENDING", "SPX", "SPXVN0512345671"),
  mkOrder(2, "2508250QWE2MHA", "Trần Văn Hùng", 512000, "PENDING", "SPX", "SPXVN0512345672"),
  mkOrder(3, "2508240P1L9KDD", "Mai Phương", 189000, "PROCESSED", "GHTK", "GHTK512345673"),
  mkOrder(4, "2508230MB4TQ8N", "Phạm Quốc Bảo", 268000, "SHIPPING", "SPX", "SPXVN0512345674"),
  mkOrder(5, "2508220XCV81LP", "Vũ Hải Yến", 320000, "DELIVERED", "GHN", "GHN512345675"),
  mkOrder(6, "2508210ZTR55KM", "Bùi Anh Tuấn", 615000, "DELIVERED", "SPX", "SPXVN0512345676"),
];
const orderList = {
  items: orders,
  counts: { all: 1284, PENDING: 12, PROCESSED: 36, SHIPPING: 54, DELIVERED: 1163, CANCELLED: 19 },
  total: orders.length, page: 1, pageSize: 20, pageCount: 1,
};

// ===== Cấu hình Giá vốn =====
const skuProducts = {
  channel: "all",
  total: 4,
  missingCostCount: 1,
  items: [
    { skuId: "s1", productId: "p1", sku: "BLT002-CAFE14", productName: "Túi Xách Nữ Công Sở Sunny BLT002", variantName: "Cafe 14 inch", channelName: "SHOPEE", imageUrl: null, sellingPrice: "279000", costPrice: "145000", linked: true },
    { skuId: "s2", productId: "p2", sku: "SNC01-LOGO", productName: "Túi đeo chéo Sunny CHIBI SNC02", variantName: null, channelName: "SHOPEE", imageUrl: null, sellingPrice: "239000", costPrice: "98000", linked: true },
    { skuId: "s3", productId: "p3", sku: "AK001-GACON", productName: "JumpSuit bé yêu AK001", variantName: "Gà con", channelName: "SHOPEE", imageUrl: null, sellingPrice: "300000", costPrice: "62000", linked: true },
    { skuId: "s4", productId: "", sku: "AGN01-DEN", productName: "Áo gió nam nữ 2 lớp AGN", variantName: "Đen", channelName: "SHOPEE", imageUrl: null, sellingPrice: "149000", costPrice: "0", linked: false },
  ],
};

// ===== Hóa đơn (cùng bộ mẫu capture-invoice-assets.js) =====
const invoiceConfig = {
  taxCode: "0109734512", companyName: "HỘ KINH DOANH SUNNY CLOSET",
  companyAddress: "123 Nguyễn Trãi, P. Thượng Đình, Q. Thanh Xuân, Hà Nội",
  provider: "MISA", partnerCode: "HUBSELL-ISV-2026", clientId: "", customApiUrl: "",
  invoicePattern: "1", invoiceSeries: "1C26TAA", hasSecretKey: false, secretKeyMasked: null,
  meinvoiceUsername: "sunnycloset@gmail.com", hasMeinvoicePassword: true,
  meinvoicePasswordMasked: "su••••••et", signMethod: "ESIGN_CLOUD",
  esignClientId: "", esignUsername: "", certSerial: "", hasEsignSecretKey: false,
  esignSecretKeyMasked: null, hasEsignPassword: false, esignPasswordMasked: null,
  posProvider: "MISA", posClientId: "", posCodePrefix: "", posMachineId: "",
  posSeries: "", hasPosSecretKey: false, posSecretKeyMasked: null,
  defaultInvoiceType: "STANDARD", defaultVatRate: 0,
};
const invTemplates = [
  { invSeries: "1C26TAA", invTemplateNo: "1", templateName: "Hóa đơn GTGT - có mã - cơ bản" },
  { invSeries: "2C26TAB", invTemplateNo: "2", templateName: "Hóa đơn bán hàng - có mã" },
];
const queueRows = [
  { orderCode: "2508190SNKXR7T", customerName: "Ngọc Anh", totalAmount: 356000, orderedAt: "2026-08-19T09:12:00.000Z", isSettled: true, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: { type: "COMPANY", hint: "MST 0312456789 — CTY TNHH Hoa Ban Mai" } },
  { orderCode: "2508200QWE2MHA", customerName: "Trần Văn Hùng", totalAmount: 512000, orderedAt: "2026-08-20T14:03:00.000Z", isSettled: true, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
  { orderCode: "2508210P1L9KDD", customerName: "Mai Phương", totalAmount: 189000, orderedAt: "2026-08-21T08:45:00.000Z", isSettled: true, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
  { orderCode: "2508220MB4TQ8N", customerName: "Phạm Quốc Bảo", totalAmount: 268000, orderedAt: "2026-08-22T10:02:00.000Z", isSettled: false, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
  { orderCode: "2508230XCV81LP", customerName: "Vũ Hải Yến", totalAmount: 320000, orderedAt: "2026-08-23T11:18:00.000Z", isSettled: false, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
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
    // Hàng hóa
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
    // Đơn hàng
    if (url.includes("/api/orders")) return json(orderList);
    // Giá vốn
    if (url.includes("/api/finance/sku-products")) return json(skuProducts);
    // Hóa đơn
    if (url.includes("/api/invoice-config/templates")) return json({ templates: invTemplates, source: "meinvoice" });
    if (url.includes("/api/invoice-config/test-meinvoice"))
      return json({ ok: true, message: "Kết nối meInvoice OK — tài khoản hợp lệ." });
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
    if (!b) throw new Error("Không lấy được boundingBox");
    return {
      x: r(((b.x + b.width / 2) / VIEW.width) * 100),
      y: r(((b.y + b.height / 2) / VIEW.height) * 100),
      w: r((b.width / VIEW.width) * 100),
      h: r((b.height / VIEW.height) * 100),
    };
  };
  // Gộp bbox 2 locator thành một khung (vd 2 mục menu liền nhau)
  const pctUnion = async (l1, l2) => {
    const a = await l1.boundingBox();
    const b = await l2.boundingBox();
    if (!a || !b) throw new Error("Không lấy được boundingBox (union)");
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

  // Ảnh 1: tab Tồn kho
  targets.kho.navProducts = await pct(page.getByRole("link", { name: "Hàng hóa" }));
  targets.kho.colSellOn = await pct(page.getByText("Bán trên").first());
  targets.kho.btnSettings = await pct(page.getByRole("button", { name: "Cài đặt" }));
  await page.screenshot({ path: path.join(OUT, "kho-inventory.png") });

  // Ảnh 2: tab Chờ liên kết
  await page.getByRole("button", { name: /^Chờ liên kết/ }).first().click();
  await page.getByText("SNC01-CHIBI").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(900);
  targets.kho.tabLinks = await pct(page.getByRole("button", { name: /^Chờ liên kết/ }).first());
  targets.kho.btnSyncFromChannels = await pct(page.getByRole("button", { name: "Đồng bộ từ sàn" }).first());
  targets.kho.btnAutoAll = await pct(page.getByRole("button", { name: "Tự khớp + tạo SKU toàn bộ" }));
  await page.screenshot({ path: path.join(OUT, "kho-links.png") });

  // Ảnh 3: tick 2 dòng → thanh liên kết hàng loạt
  await page.getByLabel("Chọn SNC01-CHIBI").check();
  await page.getByLabel("Chọn SNC02-LOVE").check();
  await page.waitForTimeout(600);
  targets.kho.bulkBar = await pct(page.getByLabel("Liên kết hàng loạt"));
  await page.screenshot({ path: path.join(OUT, "kho-bulk.png") });

  // Ảnh 4: dialog Cài đặt đồng bộ tồn
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Cài đặt" }).click();
  await page.getByText("Tự động đồng bộ").first().waitFor();
  await page.waitForTimeout(900);
  targets.kho.switchAutoSync = await pct(page.getByLabel("Bật/tắt tự động đồng bộ tồn kho"));
  targets.kho.btnSyncAll = await pct(page.getByRole("button", { name: "Sync ngay toàn bộ" }));
  await page.screenshot({ path: path.join(OUT, "kho-sync-dialog.png") });

  // ================= TOUR ĐƠN HÀNG =================
  // Ảnh 1: trang Đơn hàng
  await page.goto("http://localhost:3000/orders", { waitUntil: "domcontentloaded" });
  await page.getByText("2508250SNKXR7T").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  targets.donhang.navOrders = await pct(page.getByRole("link", { name: "Đơn hàng" }));
  targets.donhang.ordersTable = await pct(page.locator("table").first());
  await page.screenshot({ path: path.join(OUT, "dh-orders.png") });

  // Ảnh 2: trang Kênh bán — nút Đồng bộ đơn / Đồng bộ đối soát
  await page.goto("http://localhost:3000/channels", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Đồng bộ đơn", exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  targets.donhang.btnSyncOrders = await pct(page.getByRole("button", { name: "Đồng bộ đơn", exact: true }));
  targets.donhang.btnSyncSettle = await pct(page.getByRole("button", { name: "Đồng bộ đối soát" }));
  await page.screenshot({ path: path.join(OUT, "dh-channels.png") });

  // Ảnh 3: Cấu hình Giá vốn (sidebar nhóm Tài chính đang mở)
  await page.goto("http://localhost:3000/finance/cost-prices", { waitUntil: "domcontentloaded" });
  await page.getByText("BLT002-CAFE14").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  targets.donhang.navCostPrices = await pct(page.getByRole("link", { name: "Cấu hình Giá vốn" }));
  targets.donhang.costInput = await pct(page.locator("table input").first());
  targets.donhang.navReports = await pctUnion(
    page.getByRole("link", { name: "Báo cáo dòng tiền" }),
    page.getByRole("link", { name: "Lãi/Lỗ Thực Hiện" })
  );
  await page.screenshot({ path: path.join(OUT, "dh-costs.png") });

  // ================= TOUR HÓA ĐƠN =================
  // Ảnh 1: tab Cấu hình kết nối (form đã điền)
  await page.goto("http://localhost:3000/invoicing/connect", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Cấu hình kết nối" }).waitFor({ timeout: 30000 });
  await page.getByText("2508190SNKXR7T").waitFor();
  await page.waitForTimeout(1200);
  // (tab Xuất hóa đơn là mặc định — lấy tọa độ trên ảnh hd-issue trước)
  targets.hoadon.tabConfig = await pct(page.getByRole("tab", { name: "Cấu hình kết nối" }));
  targets.hoadon.switchAutoIssue = await pct(page.getByText("Tự động phát hành").first());
  // Tick 3 đơn đã đối soát → nút xuất hàng loạt
  for (const code of ["2508190SNKXR7T", "2508200QWE2MHA", "2508210P1L9KDD"]) {
    await page.getByRole("checkbox", { name: `Chọn đơn ${code}` }).check();
  }
  const issueBtn = page.getByRole("button", { name: /Xuất 3 hóa đơn/ });
  await issueBtn.waitFor();
  await page.waitForTimeout(400);
  targets.hoadon.btnIssue = await pct(issueBtn);
  await page.screenshot({ path: path.join(OUT, "hd-issue.png") });

  // Ảnh 2: tab Cấu hình kết nối
  await page.getByRole("tab", { name: "Cấu hình kết nối" }).click();
  const legalBlock = page.getByText("1 · Thông tin Pháp nhân / Hộ kinh doanh");
  await legalBlock.waitFor();
  await page.waitForTimeout(600);
  targets.hoadon.blockLegal = await pct(legalBlock);
  targets.hoadon.btnTest = await pct(page.getByRole("button", { name: "Test" }));
  await page.screenshot({ path: path.join(OUT, "hd-config.png") });

  // Ảnh 3: sau Test — cuộn tới cuối form (ký hiệu + thuế suất + Lưu cấu hình)
  await page.getByRole("button", { name: "Test" }).click();
  await page.getByText("Đã kết nối").waitFor();
  await page.waitForTimeout(4800); // đợi toast tự tắt cho ảnh sạch
  await page.getByRole("button", { name: "Lưu cấu hình" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  targets.hoadon.btnSave = await pct(page.getByRole("button", { name: "Lưu cấu hình" }));
  await page.screenshot({ path: path.join(OUT, "hd-config-bottom.png") });

  // Ảnh 4: Lịch sử & Báo cáo thuế — nút Tải PDF
  await page.goto("http://localhost:3000/invoicing/history", { waitUntil: "domcontentloaded" });
  await page.getByText("00000131").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  targets.hoadon.btnDownload = await pct(page.getByRole("button", { name: "Tải", exact: true }).first());
  await page.screenshot({ path: path.join(OUT, "hd-history.png") });

  await browser.close();
  console.log("DONE: 8 anh da luu vao", OUT);
  console.log("TOA DO MUC TIEU (% viewport) — dan vao lib/guide-tours.ts:");
  console.log(JSON.stringify(targets, null, 2));
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
