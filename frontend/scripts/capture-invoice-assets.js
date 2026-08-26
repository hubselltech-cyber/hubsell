/**
 * Chụp ảnh GIAO DIỆN THẬT của module Hóa đơn & Thuế cho bộ slide hướng dẫn
 * "Kết nối & Xuất hóa đơn" (public/huong-dan-xuat-hoa-don.html).
 *
 * Cùng cơ chế với capture-guide-assets.js: mở frontend thật (localhost:3000)
 * bằng Chromium headless, chặn mọi request /api/* và trả dữ liệu mẫu — render
 * đúng 100% giao diện production mà không cần backend hay tài khoản MISA thật.
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

// Cấu hình hóa đơn MẪU — shop demo Sunny Closet (trùng bộ data demo landing),
// đã điền đủ 3 bước để ảnh thể hiện trạng thái "cấu hình xong".
const invoiceConfig = {
  taxCode: "0109734512",
  companyName: "HỘ KINH DOANH SUNNY CLOSET",
  companyAddress: "123 Nguyễn Trãi, P. Thượng Đình, Q. Thanh Xuân, Hà Nội",
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
  meinvoicePasswordMasked: "su••••••et",
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

// Ký hiệu kéo về từ meInvoice sau khi Test kết nối OK.
const templates = [
  { invSeries: "1C26TAA", invTemplateNo: "1", templateName: "Hóa đơn GTGT - có mã - cơ bản" },
  { invSeries: "2C26TAB", invTemplateNo: "2", templateName: "Hóa đơn bán hàng - có mã" },
];

// Hàng chờ xuất hóa đơn — đơn đã giao thành công, trộn 2 sàn, 2 đơn khách
// "Cần HĐ", trộn đã/chưa đối soát cho đủ badge trên ảnh.
const queueRows = [
  { orderCode: "2508190SNKXR7T", customerName: "Ngọc Anh", totalAmount: 356000, orderedAt: "2026-08-19T09:12:00.000Z", isSettled: true, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: { type: "COMPANY", hint: "MST 0312456789 — CTY TNHH Hoa Ban Mai" } },
  { orderCode: "2508200QWE2MHA", customerName: "Trần Văn Hùng", totalAmount: 512000, orderedAt: "2026-08-20T14:03:00.000Z", isSettled: true, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: { type: "PERSONAL", hint: null } },
  { orderCode: "2508210P1L9KDD", customerName: "Mai Phương", totalAmount: 189000, orderedAt: "2026-08-21T08:45:00.000Z", isSettled: true, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
  { orderCode: "836512094817263", customerName: "Lê Thu Hà", totalAmount: 742000, orderedAt: "2026-08-21T19:27:00.000Z", isSettled: true, channelName: "LAZADA", shopName: "Sunny Kids", invoiceRequest: null },
  { orderCode: "2508220MB4TQ8N", customerName: "Phạm Quốc Bảo", totalAmount: 268000, orderedAt: "2026-08-22T10:02:00.000Z", isSettled: false, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
  { orderCode: "836512094911042", customerName: "Đỗ Minh Châu", totalAmount: 455000, orderedAt: "2026-08-22T16:40:00.000Z", isSettled: false, channelName: "LAZADA", shopName: "Sunny Kids", invoiceRequest: null },
  { orderCode: "2508230XCV81LP", customerName: "Vũ Hải Yến", totalAmount: 320000, orderedAt: "2026-08-23T11:18:00.000Z", isSettled: false, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
  { orderCode: "2508240ZTR55KM", customerName: "Bùi Anh Tuấn", totalAmount: 615000, orderedAt: "2026-08-24T09:55:00.000Z", isSettled: false, channelName: "SHOPEE", shopName: "Sunny Closet", invoiceRequest: null },
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

// Nhật ký hóa đơn cho trang Lịch sử & Báo cáo thuế.
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
    // AppShell gọi 3 API nền — trả đúng SHAPE để không vỡ trang:
    // channels là MẢNG, notifications là {items,unread}, subscription exempt
    // (ẩn banner trần gói khỏi ảnh chụp).
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
      return json({ ok: true, message: "Kết nối meInvoice OK — tài khoản hợp lệ." });
    }
    if (url.includes("/api/invoice-config")) return json({ config: invoiceConfig, channelKeys: [] });
    if (url.includes("/api/tax/invoice-queue")) return json(queue);
    if (url.includes("/api/tax/report")) return json(taxReport);
    return json({});
  });

  // Gieo phiên đăng nhập trước khi trang chạy script
  await ctx.addInitScript(([u]) => {
    localStorage.setItem("hubsell_token", "demo-token");
    localStorage.setItem("hubsell_user", JSON.stringify(u));
  }, [user]);

  const page = await ctx.newPage();

  // ---- 1+2) Trang Kết nối & Xuất hóa đơn — tab Xuất hóa đơn (mặc định) ----
  await page.goto("http://localhost:3000/invoicing/connect", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Cấu hình kết nối" }).waitFor({ timeout: 30000 });
  await page.getByText("2508190SNKXR7T").waitFor();
  await page.waitForTimeout(1200); // đợi font + icon nạp xong

  // Ảnh 1: hàng chờ nguyên trạng (chưa tick)
  await page.screenshot({ path: path.join(OUT, "invoice-issue-tab.png") });

  // Ảnh 2: tick 3 đơn đã đối soát → thanh hành động hàng loạt hiện ra
  for (const code of ["2508190SNKXR7T", "2508200QWE2MHA", "2508210P1L9KDD"]) {
    await page.getByRole("checkbox", { name: `Chọn đơn ${code}` }).check();
  }
  await page.getByRole("button", { name: /Xuất 3 hóa đơn/ }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "invoice-issue-selected.png") });

  // ---- 3) Tab Cấu hình kết nối — form 3 bước đã điền ----
  await page.getByRole("tab", { name: "Cấu hình kết nối" }).click();
  await page.getByText("1 · Thông tin Pháp nhân / Hộ kinh doanh").waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "invoice-config-tab.png") });

  // ---- 4) Bấm Test → badge "Đã kết nối" + ký hiệu kéo về thành dropdown,
  //      rồi cuộn xuống cuối form: ký hiệu + thuế suất GTGT + nút Lưu cấu hình ----
  await page.getByRole("button", { name: "Test" }).click();
  await page.getByText("Đã kết nối").waitFor();
  // đợi toast sonner tự tắt để ảnh sạch
  await page.waitForTimeout(4800);
  await page.getByRole("button", { name: "Lưu cấu hình" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "invoice-config-bottom.png") });

  // ---- 5) Trang Lịch sử & Báo cáo thuế ----
  // Nới viewport để bảng nhật ký hiện trọn cột thao tác (nút Tải PDF) bên phải.
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
