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
 *
 * Chạy: node scripts/capture-guide-tour-assets.js [kho|donhang|hoadon]
 * (không truyền = chụp cả 3). Cần frontend dev server ở localhost:3000; KHÔNG
 * cần backend — mọi /api/* bị chặn trả mock.
 *
 * TOUR KHO (làm lại 06/09 theo hub Hàng hóa 3 tầng): mock có TRẠNG THÁI thay
 * đổi giữa các ảnh (chưa kéo SP → đã kéo, chưa nối → đã nối, chưa bật → đã bật)
 * để khối "Kho trung tâm Hubsell" tự chuyển bước; mục tiêu lấy qua data-tour.
 */
const { chromium } = require("playwright");
const path = require("path");

const OUT = "D:/Claude Code/Hubsell/frontend/public/guide-assets/tour";
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
    channelLinks: [{ channelSku: "BLT002-CAFE14", channelName: "SHOPEE", shopName: "Sunny Closet", state: "match", channelStock: 41 }],
    hasSyncAlert: false,
  },
  {
    id: "p2", skuCode: "SNC01-LOGO",
    productName: "Túi đeo chéo Sunny CHIBI nhiều ngăn khóa chống thấm SNC02",
    costPrice: 98000, sellingPrice: 239000, quantityInStock: 1023, holdQuantity: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [{ channelSku: "SNC01-LOGO", channelName: "SHOPEE", shopName: "Sunny Closet", state: "match", channelStock: 1023 }],
    hasSyncAlert: false,
  },
  {
    id: "p3", skuCode: "AK001-GACON",
    productName: "JumpSuit bé yêu, body áo khoác lông lót bông cho bé 3-10Kg AK001",
    costPrice: 62000, sellingPrice: 300000, quantityInStock: 68, holdQuantity: 3,
    createdAt: "2026-08-01T00:00:00.000Z",
    channelLinks: [{ channelSku: "AK001-GACON", channelName: "SHOPEE", shopName: "Sunny Closet", state: "match", channelStock: 65 }],
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
  invoiceSeries: "1C26TAA", cqtStatus: "ACCEPTED", cqtCheckedAt: "2026-08-24T11:00:00.000Z",
  buyerName: "Người mua không lấy hóa đơn", buyerTaxCode: null,
};
const invoiceLogs = [
  { ...logBase, id: "l3", orderCode: "2508190SNKXR7T", invoiceNo: "00000132", transactionId: "TX-132", status: "ISSUED", totalAmount: 356000, vatAmount: 0, issuedAt: "2026-08-24T10:15:00.000Z", createdAt: "2026-08-24T10:15:00.000Z" },
  { ...logBase, id: "l2", orderCode: "2508180K2M7QQA", invoiceNo: "00000131", transactionId: "TX-131", status: "ISSUED", totalAmount: 428000, vatAmount: 0, issuedAt: "2026-08-23T09:02:00.000Z", createdAt: "2026-08-23T09:02:00.000Z" },
  { ...logBase, id: "l1", orderCode: "2508160A4B9NNC", invoiceNo: "00000130", transactionId: "TX-130", status: "ISSUED", totalAmount: 199000, vatAmount: 0, issuedAt: "2026-08-21T10:05:00.000Z", createdAt: "2026-08-21T10:05:00.000Z" },
];
const taxReport = {
  settings: { customTaxPercent: 0, calculationBase: "REVENUE", filterPeriod: "MONTH", platformTaxPercent: 1.5 },
  summary: { orderCount: 214, settledCount: 178, grossRevenue: 86400000, platformTaxActual: 1074000, platformTaxEstimated: 222000, platformTaxTotal: 1296000, additionalTax: 0, additionalTaxBase: 86400000 },
  invoiceSummary: { issuedCount: 128, adjustmentCount: 3, failedCount: 0, needsAdjustmentCount: 1, invoicedAmount: 41250000, invoicedVat: 0, adjustedAmount: 878000,
    cqtRejectedCount: 0, cqtWaitingCount: 2, cqtUncheckedCount: 0, cancelledCount: 0 },
  coverage: { deliveredCount: 178, invoicedCount: 128, missingCount: 50, overdueCount: 3, overdueHours: 24 },
  logs: invoiceLogs,
};
// Tab "Kê khai thuế" (07/09): số liệu kỳ theo sàn + ngưỡng năm.
const declRow = (channelName, orderCount, gross) => ({
  channelName, orderCount, settledCount: Math.round(orderCount * 0.85), unsettledCount: Math.round(orderCount * 0.15),
  grossRevenue: gross, sellerVoucher: Math.round(gross * 0.04), refundedAmount: Math.round(gross * 0.02),
  taxableRevenue: Math.round(gross * 0.94), unsettledTaxableRevenue: Math.round(gross * 0.14),
  taxWithheldActual: Math.round(gross * 0.94 * 0.85 * 0.015), taxWithheldEstimated: Math.round(gross * 0.14 * 0.015),
});
const declRows = [declRow("SHOPEE", 1284, 386400000), declRow("TIKTOK", 312, 98600000), declRow("LAZADA", 118, 41200000)];
const declTotal = declRows.reduce((t, r) => {
  for (const k of Object.keys(r)) if (typeof r[k] === "number") t[k] = (t[k] || 0) + r[k];
  return t;
}, { channelName: "SHOPEE" });
const taxDeclaration = {
  period: { year: 2026, quarter: 3, key: "2026-Q3", label: "Quý 3/2026",
    deadline: { date: "2026-10-31", label: "31/10/2026", description: "Hạn nộp tờ khai quý 3/2026", daysLeft: 36 } },
  rows: declRows,
  total: { ...declTotal, withheldSplit: { vat: Math.round(declTotal.taxWithheldActual * 2 / 3), pit: Math.round(declTotal.taxWithheldActual / 3) } },
  annual: { year: 2026, taxableRevenueToDate: 1264000000, threshold: 3000000000,
    tier: { tier: 3, label: "Trên 1 tỷ đến 3 tỷ", obligation: "Kê khai theo phương pháp khoán / kê khai, sàn khấu trừ 1,5%" },
    percentOfThreshold: 42.1, truncated: false },
  truncated: false,
};

// ===== TRẠNG THÁI KHO thay đổi giữa các ảnh của tour kho =====
// fresh: gian đã nối, chưa kéo SP → bước 1 sáng.  pulled: đã kéo, còn 54 chưa
// nối → bước 2.  linked: nối hết, chưa bật đồng bộ → bước 3.  done: đã bật.
const syncChannel = (enabled) => ({
  id: "c1", channelName: "SHOPEE", shopName: "Sunny Closet", connected: true,
  stockSyncEnabled: enabled, stockSyncEnabledAt: enabled ? "2026-09-06T09:00:00.000Z" : null,
  linkedCount: 0, lastReconcileAt: enabled ? "2026-09-06T12:00:00.000Z" : null,
  lastReconcileMismatch: enabled ? 0 : null,
});
const WH_STATES = {
  fresh: { products: [], counts: { all: 0, linked: 0, unlinked: 0 }, cps: [], enabled: false, linkedCount: 0 },
  pulled: { products, counts: { all: 96, linked: 42, unlinked: 54 }, cps: channelProducts, enabled: false, linkedCount: 42 },
  linked: { products, counts: { all: 96, linked: 96, unlinked: 0 }, cps: [], enabled: false, linkedCount: 96 },
  done: { products, counts: { all: 96, linked: 96, unlinked: 0 }, cps: [], enabled: true, linkedCount: 96 },
};
let wh = WH_STATES.pulled;
const syncPreview = () => ({
  channel: { id: "c1", channelName: "SHOPEE", shopName: "Sunny Closet" },
  refreshed: true, refreshError: null, safetyStockDefault: 0,
  summary: { total: 96, match: 91, up: 3, down: 2, unknown: 0, willZero: 0, unlinked: 0 },
  items: [
    { channelSku: "BLT002-CAFE14", channelProductName: "Túi Xách Nữ Công Sở Sunny BLT002", skuCode: "BLT002-CAFE14", productName: "Túi Xách Nữ Công Sở Sunny BLT002", quantityInStock: 41, holdQuantity: 0, safetyStock: 0, hubsell: 41, onChannel: 38, state: "up", pending: false },
    { channelSku: "AK001-GACON", channelProductName: "JumpSuit bé yêu AK001", skuCode: "AK001-GACON", productName: "JumpSuit bé yêu AK001", quantityInStock: 68, holdQuantity: 3, safetyStock: 0, hubsell: 65, onChannel: 70, state: "down", pending: false },
    { channelSku: "SNC01-LOGO", channelProductName: "Túi đeo chéo Sunny CHIBI SNC02", skuCode: "SNC01-LOGO", productName: "Túi đeo chéo Sunny CHIBI SNC02", quantityInStock: 1023, holdQuantity: 0, safetyStock: 0, hubsell: 1023, onChannel: 1023, state: "match", pending: false },
  ],
  truncated: false,
});

// ===== VỊ TRÍ CHỨA HÀNG (đợt B 24/09) — off: chưa dùng; on: cây Kho › Kệ =====
const mkLoc = (id, parentId, name, code, sortOrder, extra = {}) => ({
  id, parentId, name, code, sortOrder, isDefault: false, isReturnDefault: false, sellable: true,
  createdAt: "2026-09-24T09:00:00.000Z", path: name, skuCount: 0, totalQuantity: 0, ...extra,
});
const LOC_STATE = {
  off: { items: [], enabled: false },
  on: {
    enabled: true,
    items: [
      mkLoc("l1", null, "Kho chính", "KHO-CHINH", 0, { isDefault: true, skuCount: 4, totalQuantity: 1079 }),
      mkLoc("l2", null, "Kho 2", "K2", 1, { skuCount: 2, totalQuantity: 60 }),
      mkLoc("l3", "l2", "Kệ A1", "KE-A1", 2, { path: "Kho 2 › Kệ A1", skuCount: 1, totalQuantity: 40 }),
      mkLoc("l4", "l2", "Kệ A2", "KE-A2", 3, { path: "Kho 2 › Kệ A2", skuCount: 1, totalQuantity: 20 }),
      mkLoc("l5", null, "Nhận hoàn", "HOAN", 4, { isReturnDefault: true, sellable: false }),
    ],
  },
};
let locs = LOC_STATE.off;
const STOCK_LEVELS = {
  p1: [{ locationId: "l1", quantity: 41 }],
  p2: [{ locationId: "l1", quantity: 983 }, { locationId: "l3", quantity: 40 }],
  p3: [{ locationId: "l1", quantity: 48 }, { locationId: "l4", quantity: 20 }],
  p4: [{ locationId: "l1", quantity: 7 }],
};
const withLevels = (list) =>
  locs.enabled ? list.map((p) => ({ ...p, stockLevels: STOCK_LEVELS[p.id] ?? [] })) : list;

// ===== NHẬT KÝ KHO (tab Nhật ký kho, 24/09) =====
const mkLog = (id, p, changeQuantity, type, reason, createdAt, actor, balanceAfter, order = null, loc = "Kho chính") => ({
  id, productId: p.id, skuCode: p.skuCode, productName: p.productName, changeQuantity, type, reason,
  createdAt, actor, balanceAfter, location: { id: "l1", name: loc }, order,
});
const staff = { id: "u1", name: "Chủ shop" };
const inventoryLogs = {
  items: [
    mkLog("g1", products[0], -1, "SYNC", "Đơn 2508250SNKXR7T trừ kho", "2026-09-25T02:41:00.000Z", null, 41,
      { id: "o1", orderCode: "2508250SNKXR7T", channelName: "SHOPEE", shopName: "Sunny Closet" }),
    mkLog("g2", products[2], 30, "IMPORT", "Nhập lô hàng xưởng ngày 25/09", "2026-09-25T01:15:00.000Z", staff, 68),
    mkLog("g3", products[1], -40, "TRANSFER", "Cất lên kệ: Kho chính → Kệ A1", "2026-09-24T09:30:00.000Z", staff, 1023),
    mkLog("g4", products[3], -2, "ADJUST", "Kiểm kê tại Kho chính: sổ 9 → đếm 7", "2026-09-23T10:05:00.000Z",
      { id: "u2", name: "Nhân viên kho" }, 7),
    mkLog("g5", products[0], 1, "SYNC", "Đơn 2508210ZTR55KM hủy — trả về kho", "2026-09-22T14:20:00.000Z", null, 42,
      { id: "o6", orderCode: "2508210ZTR55KM", channelName: "SHOPEE", shopName: "Sunny Closet" }),
  ],
  total: 5, page: 1, pageSize: 20, pageCount: 1,
};

// ===== PHIẾU KIỂM KÊ (trang /products/stocktake) =====
const stocktakeSheet = () => ({
  location: locs.enabled ? { id: "l1", name: "Kho chính" } : null,
  rows: products.map((p) => ({
    productId: p.id, skuCode: p.skuCode, productName: p.productName, isActive: true,
    book: locs.enabled ? STOCK_LEVELS[p.id][0].quantity : p.quantityInStock,
  })),
  truncated: false,
});

const ONLY = process.argv[2]; // kho | donhang | hoadon | undefined

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
    // Hàng hóa (trạng thái wh đổi giữa các ảnh của tour kho)
    if (url.includes("/api/inventory/sync-settings"))
      return json({
        channels: [{ ...syncChannel(wh.enabled), linkedCount: wh.linkedCount }],
        enabledCount: wh.enabled ? 1 : 0, safetyStockDefault: 0, initialStockMode: "MAX",
        lowStockDefault: 0, updatedAt: null, pendingJobs: 0,
      });
    if (url.includes("/api/inventory/sync-channels/") && url.endsWith("/preview")) return json(syncPreview());
    if (url.includes("/api/inventory/sync-alerts")) return json([]);
    if (url.includes("/api/inventory/sync-logs")) return json([]);
    if (url.includes("/api/inventory/sync-pending")) return json({ pending: 0 });
    if (url.includes("/channel-links")) return json([]);
    if (url.includes("/api/stock-locations")) return json(locs);
    if (url.includes("/api/inventory/logs")) return json(inventoryLogs);
    if (url.includes("/api/inventory/stocktake/sheet")) return json(stocktakeSheet());
    if (url.includes("/api/products")) {
      // Ô quét mã ở Phiếu nhiều mã / Cất lên kệ / Kiểm kê tìm theo ?search=
      const q = (new URL(url).searchParams.get("search") || "").trim().toUpperCase();
      const items = withLevels(
        q ? wh.products.filter((p) => p.skuCode.toUpperCase().includes(q) || p.productName.toUpperCase().includes(q)) : wh.products
      );
      return json({
        items, total: items.length, page: 1, pageSize: 10,
        pageCount: items.length ? 1 : 0, safetyStockDefault: 0, lowStockDefault: 0,
      });
    }
    if (url.includes("/api/mappings"))
      return json({
        items: wh.cps, total: wh.counts.all, page: 1, pageSize: 20,
        pageCount: wh.cps.length ? 5 : 0, counts: wh.counts,
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
    if (url.includes("/api/tax/declaration")) return json(taxDeclaration);
    if (url.includes("/api/tax/invoices/register")) return json({ rows: [], truncated: false });
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
  // Mốc data-tour do hub Hàng hóa gắn sẵn (hub-story-strip.tsx, setup-guide.tsx).
  // 25/09 làm lại 14 bước: 9 bước thiết lập cũ + phiếu nhiều mã, nhật ký kho,
  // vị trí chứa hàng (cây Kho › Kệ), cất lên kệ, kiểm kê (đợt Hàng hóa 24/09).
  const tour = (name) => page.locator('[data-tour="' + name + '"]');
  const gotoProducts = async (state, waitText) => {
    wh = WH_STATES[state];
    await page.goto("http://localhost:3000/products", { waitUntil: "domcontentloaded" });
    await page.getByText(waitText).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);
  };
  const scanEnter = async (input, code) => {
    await input.fill(code);
    await page.waitForTimeout(450); // chờ gợi ý (200ms debounce) rồi Enter tra đúng mã
    await input.press("Enter");
    await page.waitForTimeout(500);
  };
  if (!ONLY || ONLY === "kho") {
    // Khối thiết lập luôn BUNG khi chụp (xóa lựa chọn thu gọn nếu có)
    await page.addInitScript(() => localStorage.removeItem("hubsell_hub_guide_open"));

    // Ảnh 1: trạng thái MỚI — gian đã nối, chưa kéo SP (bước 1 sáng): nguyên lý + cùng mã + bước 1
    await gotoProducts("fresh", "Kho trung tâm Hubsell");
    targets.kho.navProducts = await pct(page.getByRole("link", { name: "Hàng hóa" }));
    targets.kho.story = await pct(tour("hub-story"));
    targets.kho.skuHint = await pct(tour("hub-sku-hint"));
    targets.kho.step1Btn = await pct(tour("setup-step-1").getByRole("button", { name: "Kéo sản phẩm về" }));
    await page.screenshot({ path: path.join(OUT, "kho-guide-start.png") });

    // Ảnh 2: ĐÃ KÉO, còn 54 chưa nối (bước 2 sáng) → nút Tự khớp + tạo SKU
    await gotoProducts("pulled", "BLT002-CAFE14");
    const step2Btn = tour("setup-step-2").getByRole("button", { name: "Tự khớp + tạo SKU" });
    targets.kho.step2Btn = await pct(step2Btn);
    await page.screenshot({ path: path.join(OUT, "kho-guide-link.png") });

    // Ảnh 3: hộp Tự khớp + tạo SKU (2 mức)
    await step2Btn.click();
    const fullBtn = page.getByRole("button", { name: "Tự khớp + tạo SKU còn lại" });
    await fullBtn.waitFor({ timeout: 10000 });
    await page.waitForTimeout(700);
    targets.kho.dialogFullBtn = await pct(fullBtn);
    targets.kho.dialogMatchBtn = await pct(page.getByRole("button", { name: "Chỉ tự khớp trùng mã" }));
    await page.screenshot({ path: path.join(OUT, "kho-oneclick-dialog.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Ảnh 4: tab Sản phẩm trên sàn (PageTabs, role=tab) — tick 2 dòng → thanh liên kết hàng loạt
    const tabLinks = page.getByRole("tab", { name: /^Sản phẩm trên sàn/ });
    targets.kho.tabLinks = await pct(tabLinks);
    await tabLinks.click();
    await page.getByText("SNC01-CHIBI").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(900);
    await page.getByLabel("Chọn SNC01-CHIBI").check();
    await page.getByLabel("Chọn SNC02-LOVE").check();
    await page.waitForTimeout(600);
    targets.kho.bulkBar = await pct(page.getByLabel("Liên kết hàng loạt"));
    // Tick ô làm trang cuộn xuống — kéo về đầu để dải tab còn trong ảnh (thanh hàng loạt cố định đáy).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "kho-bulk.png") });

    // Ảnh 5: ĐÃ NỐI HẾT, chưa bật đồng bộ (bước 3 sáng) → nút Bật đồng bộ
    await gotoProducts("linked", "BLT002-CAFE14");
    const step3Btn = tour("setup-step-3").getByRole("button", { name: "Bật đồng bộ" });
    targets.kho.step3Btn = await pct(step3Btn);
    await page.screenshot({ path: path.join(OUT, "kho-guide-sync.png") });

    // Ảnh 6: dialog đồng bộ — gạt công tắc gian → màn so số → nút Bật & đẩy
    await step3Btn.click();
    const sw = page.getByLabel("Bật/tắt đồng bộ tồn cho Sunny Closet");
    await sw.waitFor({ timeout: 10000 });
    await page.waitForTimeout(600);
    targets.kho.switchShop = await pct(sw);
    await sw.click();
    const enableBtn = page.getByRole("button", { name: /^Bật & đẩy/ });
    await enableBtn.waitFor({ timeout: 10000 });
    await page.waitForTimeout(800);
    targets.kho.btnEnable = await pct(enableBtn);
    await page.screenshot({ path: path.join(OUT, "kho-sync-dialog.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // Ảnh 7: ĐÃ XONG — khối thu thành một dòng "Đã thiết lập", bảng là việc chính
    await gotoProducts("done", "BLT002-CAFE14");
    targets.kho.guideHeader = await pct(tour("setup-guide"));
    targets.kho.colSellOn = await pct(page.getByText("Bán trên").first());
    targets.kho.rowImport = await pct(page.getByLabel("Nhập kho BLT002-CAFE14"));
    targets.kho.btnReceive = await pct(page.getByText("Phiếu nhiều mã", { exact: true }).first());
    targets.kho.btnStocktake = await pct(page.getByText("Kiểm kê", { exact: true }).first());
    targets.kho.btnLocations = await pct(page.getByRole("button", { name: "Thêm vị trí chứa hàng" }));
    targets.kho.tabLogs = await pct(page.getByRole("tab", { name: /^Nhật ký kho/ }));
    await page.screenshot({ path: path.join(OUT, "kho-inventory.png") });

    // Từ đây shop ĐÃ DÙNG vị trí chứa hàng (Kho chính + Kho 2 › Kệ A1/A2 + ô Nhận hoàn)
    locs = LOC_STATE.on;

    // Ảnh 8: PHIẾU NHIỀU MÃ (/products/receive) — quét 2 mã, mỗi mã một dòng
    await page.goto("http://localhost:3000/products/receive", { waitUntil: "domcontentloaded" });
    const rcScan = page.getByPlaceholder("Gõ hoặc quét mã SKU rồi Enter…");
    await rcScan.waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await scanEnter(rcScan, "BLT002-CAFE14");
    await scanEnter(rcScan, "AK001-GACON");
    await scanEnter(rcScan, "AK001-GACON"); // quét trùng → cộng dồn
    const rcSubmit = page.getByRole("button", { name: "Nhập kho", exact: true });
    await rcSubmit.waitFor();
    await page.waitForTimeout(600);
    targets.kho.rcScan = await pct(rcScan);
    targets.kho.rcTable = await pct(page.locator("table").first());
    targets.kho.rcSubmit = await pct(rcSubmit);
    targets.kho.rcTypeExport = await pct(page.getByRole("button", { name: "Xuất hàng" }));
    await page.screenshot({ path: path.join(OUT, "kho-receive.png") });

    // Ảnh 9: NHẬT KÝ KHO — tab thứ 3: ai làm, tồn sau, vị trí, đơn gây ra
    await gotoProducts("done", "BLT002-CAFE14");
    await page.getByRole("tab", { name: /^Nhật ký kho/ }).click();
    await page.getByText("Nhập lô hàng xưởng ngày 25/09").waitFor({ timeout: 30000 });
    await page.waitForTimeout(900);
    targets.kho.logsTable = await pct(page.locator("table").first());
    targets.kho.logsChips = await pct(page.getByRole("button", { name: "Chuyển vị trí" }));
    await page.screenshot({ path: path.join(OUT, "kho-logs.png") });

    // Ảnh 10: HỘP VỊ TRÍ CHỨA HÀNG — cây Kho chính / Kho 2 › Kệ A1, A2 / Nhận hoàn
    await gotoProducts("done", "BLT002-CAFE14");
    const locBtn = page.getByRole("button", { name: /^Vị trí \(/ });
    await locBtn.click();
    const dlg = page.getByRole("dialog");
    await dlg.getByText("Kệ A2").first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(700);
    targets.kho.locTree = await pct(dlg.locator("div.rounded-lg.border").first());
    targets.kho.locAddForm = await pct(dlg.locator("form").first());
    targets.kho.locBulk = await pct(dlg.getByText("Sinh nhiều kệ / tầng một lượt"));
    targets.kho.locPrint = await pct(dlg.getByText("In tem vị trí"));
    await page.screenshot({ path: path.join(OUT, "kho-locations.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // Ảnh 11: CẤT LÊN KỆ (/products/putaway) — chọn kệ, quét 2 SKU
    await page.goto("http://localhost:3000/products/putaway", { waitUntil: "domcontentloaded" });
    const paTo = page.locator("#pa-to");
    await paTo.waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    await paTo.selectOption("l3");
    const paScan = page.getByPlaceholder(/Quét SKU để cất vào/);
    await paScan.waitFor();
    await scanEnter(paScan, "SNC01-LOGO");
    await scanEnter(paScan, "BLT002-CAFE14");
    const paSubmit = page.getByRole("button", { name: "Cất lên kệ", exact: true });
    await paSubmit.waitFor();
    await page.waitForTimeout(600);
    targets.kho.paTo = await pct(paTo);
    targets.kho.paScan = await pct(paScan);
    targets.kho.paTable = await pct(page.locator("table").first());
    targets.kho.paSubmit = await pct(paSubmit);
    await page.screenshot({ path: path.join(OUT, "kho-putaway.png") });

    // Ảnh 12: KIỂM KÊ (/products/stocktake) — đếm 2 mã, 1 mã lệch
    await page.goto("http://localhost:3000/products/stocktake", { waitUntil: "domcontentloaded" });
    await page.getByText("BLT002-CAFE14").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    const countInputs = page.locator("table input");
    await countInputs.nth(0).fill("39");
    await countInputs.nth(1).fill("983");
    await page.waitForTimeout(500);
    targets.kho.stLocation = await pct(page.locator("#st-location"));
    targets.kho.stScan = await pct(page.getByPlaceholder(/Quét hoặc gõ mã SKU rồi Enter/));
    targets.kho.stTable = await pct(page.locator("table").first());
    targets.kho.stDiffChip = await pct(page.getByRole("button", { name: /^Chỉ hiện lệch/ }));
    targets.kho.stSubmit = await pct(page.getByRole("button", { name: /^Chốt kiểm kê/ }));
    await page.screenshot({ path: path.join(OUT, "kho-stocktake.png") });
    locs = LOC_STATE.off;
  }

  // ================= TOUR ĐƠN HÀNG =================
  if (!ONLY || ONLY === "donhang") {
  // Ảnh 1: trang Đơn hàng
  await page.goto("http://localhost:3000/orders", { waitUntil: "domcontentloaded" });
  await page.getByText("2508250SNKXR7T").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  targets.donhang.navOrders = await pct(page.getByRole("link", { name: "Đơn hàng" }));
  targets.donhang.ordersTable = await pct(page.locator("table").first());
  targets.donhang.statusTabs = await pct(page.getByRole("tablist", { name: "Lọc theo trạng thái đơn hàng" }));
  targets.donhang.tabCancelled = await pct(page.getByRole("tab", { name: /^Đơn hủy/ }));
  await page.screenshot({ path: path.join(OUT, "dh-orders.png") });

  // Ảnh 1b: tick 2 đơn Chờ xử lý → thanh xử lý hàng loạt (Chuẩn bị hàng / In phiếu)
  const rowCheck = (i) => page.locator("table tbody tr").nth(i).locator("[role=checkbox], input[type=checkbox]").first();
  await rowCheck(0).click();
  await rowCheck(1).click();
  const bulkPrepare = page.getByRole("button", { name: /^Chuẩn bị hàng \(/ });
  await bulkPrepare.waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  targets.donhang.bulkPrepare = await pct(bulkPrepare);
  targets.donhang.bulkPrint = await pct(page.getByRole("button", { name: /^In phiếu \(/ }));
  targets.donhang.bulkBar = await pct(bulkPrepare.locator("xpath=ancestor::div[contains(@class,'fixed') or contains(@class,'sticky')][1]"));
  // Tick ô làm trang cuộn xuống — kéo về đầu để dải tab còn trong ảnh (thanh hàng loạt cố định đáy).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "dh-orders-bulk.png") });

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
  }

  // ================= TOUR HÓA ĐƠN =================
  if (!ONLY || ONLY === "hoadon") {
  // Ảnh 1: tab Cấu hình kết nối (form đã điền)
  await page.goto("http://localhost:3000/invoicing/connect", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Cấu hình kết nối" }).waitFor({ timeout: 30000 });
  await page.getByText("2508190SNKXR7T").waitFor();
  await page.waitForTimeout(1200);
  // Ảnh 1a: ĐẦU TRANG tab Xuất hóa đơn — dải tab + khối thời điểm xuất / Tự động phát hành
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  targets.hoadon.tabConfig = await pct(page.getByRole("tab", { name: "Cấu hình kết nối" }));
  targets.hoadon.switchAutoIssue = await pct(page.getByText("Tự động phát hành").first());
  targets.hoadon.whenBlock = await pct(page.getByText("Xuất hóa đơn vào lúc nào?").first());
  await page.screenshot({ path: path.join(OUT, "hd-issue-top.png") });
  // Ảnh 1b: tick 3 đơn đã đối soát → thanh "Xuất 3 hóa đơn" (trang tự cuộn tới bảng)
  for (const code of ["2508190SNKXR7T", "2508200QWE2MHA", "2508210P1L9KDD"]) {
    await page.getByRole("checkbox", { name: `Chọn đơn ${code}` }).check();
  }
  const issueBtn = page.getByRole("button", { name: /Xuất 3 hóa đơn/ });
  await issueBtn.waitFor();
  await page.waitForTimeout(400);
  targets.hoadon.btnIssue = await pct(issueBtn);
  targets.hoadon.queueChips = await pct(page.getByRole("tab", { name: /^Đã đối soát/ }));
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
  // Trang Lịch sử & Báo cáo thuế (19/09): tab mặc định "Kê khai thuế", hóa đơn ở tab "Lịch sử hóa đơn"
  const tabInvoices = page.getByRole("tab", { name: /^Lịch sử hóa đơn/ });
  await tabInvoices.waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  targets.hoadon.tabDeclaration = await pct(page.getByRole("tab", { name: /^Kê khai thuế/ }));
  targets.hoadon.tabInvoices = await pct(tabInvoices);
  await page.screenshot({ path: path.join(OUT, "hd-declaration.png") });
  await tabInvoices.click();
  await page.getByText("00000131").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  targets.hoadon.coverageBox = await pct(page.getByText("Đối chiếu kỳ").first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]"));
  await page.screenshot({ path: path.join(OUT, "hd-history.png") });
  // Ảnh 5b: cuộn tới bảng nhật ký — nút Tải nằm mép phải bảng rộng (cuộn ngang)
  const dl = page.getByRole("button", { name: "Tải", exact: true }).first();
  await dl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  targets.hoadon.btnDownload = await pct(dl);
  targets.hoadon.logTable = await pct(page.locator("table").last());
  await page.screenshot({ path: path.join(OUT, "hd-history-table.png") });
  }

  await browser.close();
  console.log("DONE: anh da luu vao", OUT);
  console.log("TOA DO MUC TIEU (% viewport) — dan vao lib/guide-tours.ts:");
  console.log(JSON.stringify(targets, null, 2));
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
