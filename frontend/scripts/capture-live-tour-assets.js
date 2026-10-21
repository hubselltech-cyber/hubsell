/**
 * Chụp ảnh + đo tọa độ cho 4 TOUR làm từ DỮ LIỆU THẬT (25/09/2026): Tài chính,
 * Giữ tiền, Trợ lý quảng cáo Shopee, Nhân viên & gói dịch vụ.
 *
 * Khác capture-guide-tour-assets.js (chặn /api trả mock): script này đăng nhập
 * shop demo "Sunny Closet" trên DB LOCAL rồi chụp trang thật — các trang này có
 * quá nhiều API để giả lập tay. Dữ liệu do 2 seed tạo ra (chạy lại khi số cũ):
 *   cd backend && npx tsx scripts/seed-landing-demo.ts && npx tsx scripts/seed-landing-tour.ts
 * Cần: backend HTTPS localhost:4000 + frontend localhost:3000 đang chạy.
 * Gọi API login bằng fetch của Node → cert tự ký phải tắt kiểm:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/capture-live-tour-assets.js [taichinh|giutien|ads|nhansu|tiktokads]
 *
 * 16/10/2026 — tour `tiktokads` (Trợ lý quảng cáo TikTok) chụp gian "Hubsell Demo Store" của reviewer@hubsell.vn
 * (6 chiến dịch GMV Max demo trên DB local). Mật khẩu reviewer anh Trung giữ → đăng nhập bằng JWT ký tay:
 *   cd backend && node -r dotenv/config -e "console.log(require('jsonwebtoken').sign({sub:'<userId reviewer>'},process.env.JWT_SECRET,{expiresIn:'2d'}))"
 *   TOUR_TOKEN=<jwt> NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/capture-live-tour-assets.js tiktokads
 * Trang chiến dịch (video / chạy thử / đối chiếu) gọi THẲNG TikTok nên được giả lập bằng page.route (mock bên dưới);
 * tổng quan + hòa vốn sản phẩm đọc DB thật. Dời ngày số demo lên hiện tại trước khi chụp (scratch prep-tiktok-demo.ts).
 *
 * Ảnh 1440x960 (khung 3:2 của TourPlayer) → public/guide-assets/tour/{tc,gt,ad,ns}-*.png.
 * In tọa độ % để dán vào lib/guide-tours.ts. Toast thông báo (sonner) + nút N của
 * Next dev bị ẩn để không lọt vào ảnh.
 */
const { chromium } = require("playwright");
const path = require("path");

const OUT = "D:/Claude Code/Hubsell/frontend/public/guide-assets/tour";
const VIEW = { width: 1440, height: 960 };
const ONLY = process.argv[2];
const ACCOUNT = { identifier: "demo@hubsell.tech", password: "demo-hubsell-2026" };

const r = (v) => Math.round(v * 100) / 100;
const pctOf = (b) => ({
  x: r(((b.x + b.width / 2) / VIEW.width) * 100),
  y: r(((b.y + b.height / 2) / VIEW.height) * 100),
  w: r((b.width / VIEW.width) * 100),
  h: r((b.height / VIEW.height) * 100),
});

(async () => {
  let login;
  if (process.env.TOUR_TOKEN) {
    const me = await fetch("https://localhost:4000/api/auth/me", {
      headers: { authorization: `Bearer ${process.env.TOUR_TOKEN}` },
    }).then((res) => res.json());
    if (!me.user) throw new Error("TOUR_TOKEN không hợp lệ: " + JSON.stringify(me));
    login = { token: process.env.TOUR_TOKEN, user: me.user };
  } else {
    login = await fetch("https://localhost:4000/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ACCOUNT),
    }).then((res) => res.json());
    if (!login.token) throw new Error("Đăng nhập demo thất bại: " + JSON.stringify(login));
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEW, deviceScaleFactor: 2, locale: "vi-VN", ignoreHTTPSErrors: true,
  });
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem("hubsell_token", t);
    localStorage.setItem("hubsell_user", JSON.stringify(u));
    localStorage.setItem("hubsell_onboarding_tour_seen", "1");
    // Dải "Ứng dụng Hubsell đã có trên Google Play" (mobile-app-launch-notice.tsx) — ẩn khi chụp.
    localStorage.setItem("hubsell_mobile_app_notice_dismissed", "live-android-2026-10");
    const st = document.createElement("style");
    st.textContent =
      "nextjs-portal{display:none!important}[data-sonner-toaster]{display:none!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st));
  }, [login.token, login.user]);
  const page = await ctx.newPage();

  const pct = async (locator) => {
    const b = await locator.boundingBox();
    if (!b) throw new Error("Không lấy được boundingBox");
    return pctOf(b);
  };
  const pctUnion = async (...locs) => {
    const bs = [];
    for (const l of locs) {
      const b = await l.boundingBox();
      if (!b) throw new Error("Không lấy được boundingBox (union)");
      bs.push(b);
    }
    const x1 = Math.min(...bs.map((b) => b.x)), y1 = Math.min(...bs.map((b) => b.y));
    const x2 = Math.max(...bs.map((b) => b.x + b.width)), y2 = Math.max(...bs.map((b) => b.y + b.height));
    return pctOf({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
  };
  /** Thẻ (Card) chứa một đoạn chữ — ancestor gần nhất có bo góc + viền. */
  const cardOf = (text) =>
    page.getByText(text, { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  const goto = async (p, waitText) => {
    await page.goto("http://localhost:3000" + p, { waitUntil: "domcontentloaded" });
    if (waitText) await page.getByText(waitText).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(2500);
  };
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });
  const targets = {};
  const T = (key, fn) => fn().then((v) => (targets[key] = v)).catch((e) => (targets[key] = "FAIL " + e.message.slice(0, 60)));

  // ================= TOUR TÀI CHÍNH =================
  if (!ONLY || ONLY === "taichinh") {
    // Ảnh 1: Tổng quan — KPI hôm nay + phễu đơn
    await goto("/", "Báo cáo tài chính");
    await T("navDashboard", () => pct(page.getByRole("link", { name: "Tổng quan" })));
    await T("rangeChips", () => pctUnion(page.getByRole("button", { name: "Hôm nay", exact: true }).first(), page.getByRole("button", { name: "30 ngày qua", exact: true }).first()));
    await T("kpiRow", () => pctUnion(cardOf("Doanh thu hôm nay"), cardOf("Lợi nhuận dự kiến")));
    await T("funnel", () => pctUnion(page.getByText("Chờ xác nhận").first(), page.getByText("Đơn hủy").first()));
    await shot("tc-dashboard.png");
    // Ảnh 2: cuộn tới 2 biểu đồ
    // scrollIntoViewIfNeeded coi phần tử lộ một nửa là "đã thấy" → cuộn hẳn lên đầu khung.
    await page.getByText("Tỷ trọng kênh bán hàng").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -24));
    await page.waitForTimeout(1200);
    await T("channelChart", () => pct(cardOf("Tỷ trọng kênh bán hàng")));
    await T("waterfall", () => pct(cardOf("Bóc tách dòng tiền")));
    await shot("tc-dashboard-charts.png");

    // Ảnh 3: Lãi/Lỗ Thực Hiện — KPI + chip + tab sàn
    await goto("/finance/realized-pnl", "Lợi nhuận ròng thực nhận");
    await T("navPnl", () => pct(page.getByRole("link", { name: "Lãi/Lỗ Thực Hiện" })));
    await T("pnlTabs", () => pct(page.getByRole("tablist").first()));
    await T("pnlKpi", () => pctUnion(cardOf("Lợi nhuận ròng thực nhận"), cardOf("Sàn tỷ lệ hoàn cao nhất")));
    await T("chipLoss", () => pct(page.getByRole("button", { name: /Lợi nhuận âm/ })));
    await T("lossDonut", () => pct(cardOf("Bóc tách nguyên nhân thất thu")));
    await shot("tc-pnl.png");
    // Ảnh 4: tab Shopee — bảng phí từng đơn
    await page.getByRole("tab", { name: /^Shopee/ }).click();
    await page.waitForTimeout(3000);
    await page.locator("table").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await T("pnlTable", () => pct(page.locator("table").first()));
    await shot("tc-pnl-shopee.png");

    // Ảnh 5: Báo cáo dòng tiền — 4 cột
    await goto("/finance/analytics", "Tổng giá trị sản phẩm");
    await T("navCashflow", () => pct(page.getByRole("link", { name: "Báo cáo dòng tiền" })));
    await T("cfDeductions", () => pct(cardOf("Tổng giá trị sản phẩm")));
    await T("cfRevenue", () => pct(cardOf("Doanh thu")));
    await T("cfCost", () => pct(cardOf("Chi phí")));
    await T("cfNet", () => pct(page.getByText("Lợi nhuận ròng tạm tính").first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]")));
    await shot("tc-cashflow.png");

    // Ảnh 6: Thu chi vận hành — hộp Thêm chi phí
    await goto("/finance/expenses", "Dòng tiền thuần vận hành");
    await T("navExpenses", () => pct(page.getByRole("link", { name: "Thu chi vận hành" })));
    const addExp = page.getByRole("button", { name: "Thêm chi phí" });
    await T("btnAddExpense", () => pct(addExp));
    await T("expenseTable", () => pct(page.locator("table").first()));
    await addExp.click();
    await page.getByRole("dialog").waitFor({ timeout: 10000 });
    await page.waitForTimeout(700);
    await T("expenseDialog", () => pct(page.getByRole("dialog")));
    await shot("tc-expense-dialog.png");
    await page.keyboard.press("Escape");

    // Ảnh 7: Thuế bổ sung
    await goto("/invoicing/tax-settings", "Thuế bổ sung ước tính");
    await T("navTax", () => pct(page.getByRole("link", { name: "Thuế bổ sung" })));
    await T("taxCard", () => pct(cardOf("Thuế bổ sung ước tính")));
    await T("taxPlatform", () => pct(cardOf("Thuế sàn TMĐT (khấu trừ tại nguồn)")));
    await shot("tc-tax.png");

    // Ảnh 8: Cảnh báo & P&L sản phẩm
    await goto("/operations-assistant/loss-orders", "Hiệu quả kinh doanh theo sản phẩm");
    await T("navSkuPnl", () => pct(page.getByRole("link", { name: /Cảnh báo & P&L/ })));
    await T("skuChips", () => pctUnion(page.getByRole("button", { name: /Tất cả sản phẩm/ }), page.getByRole("button", { name: /Chưa nhập giá vốn/ })));
    await T("skuTable", () => pct(page.locator("table").first()));
    await shot("tc-sku-pnl.png");
  }

  // ================= TOUR GIỮ TIỀN =================
  if (!ONLY || ONLY === "giutien") {
    await goto("/warehouse/returns", "Nhập kho tất cả");
    await T("navReturns", () => pct(page.getByRole("link", { name: "Đối soát đơn hoàn" })));
    await T("scanBox", () => pct(page.getByPlaceholder(/Bấm máy quét/)));
    await T("btnBulkReceive", () => pct(page.getByRole("button", { name: /Nhập kho tất cả/ })));
    await T("returnCards", () => pctUnion(cardOf("Chờ về tay"), cardOf("Chờ khiếu nại sàn")));
    await T("returnWarning", () => pct(page.getByText(/quá 14 ngày chưa về tay/).first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]")));
    await T("returnTabs", () => pctUnion(page.getByRole("button", { name: /^Tất cả/ }).first(), page.getByRole("button", { name: /Hao hụt\/Khiếu nại/ })));
    await shot("gt-returns.png");
    await page.locator("table").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await T("returnTable", () => pct(page.locator("table").first()));
    await shot("gt-returns-table.png");

    await goto("/warehouse/shipping-alerts", "Tổng số tiền cần đòi lại");
    await T("navShipping", () => pct(page.getByRole("link", { name: "Đối soát phí ship" })));
    await T("shipKpi", () => pctUnion(cardOf("Tổng số đơn lệch"), cardOf("Tổng số tiền cần đòi lại")));
    await T("btnExportClaim", () => pct(page.getByRole("button", { name: /Xuất file khiếu nại sàn/ })));
    await T("shipRowAction", () => pct(page.getByRole("button", { name: /Đang khiếu nại/ }).first()));
    await T("shipTable", () => pct(page.locator("table").first()));
    await shot("gt-shipping.png");

    await goto("/finance/fee-audit", "Truy thu phí ship");
    await T("navFeeAudit", () => pct(page.getByRole("link", { name: "Kiểm toán phí sàn" })));
    await T("feeKpi", () => pctUnion(cardOf("Truy thu phí ship"), cardOf("Chờ sàn trả tiền")));
    await T("feeTabs", () => pctUnion(page.getByRole("button", { name: "Truy thu phí ship" }), page.getByRole("button", { name: "Chờ sàn trả tiền" })));
    await T("feeStatusSelect", () => pct(page.getByRole("combobox").filter({ hasText: "Chờ khiếu nại" }).first()));
    await shot("gt-fee-audit.png");

    await goto("/operations-assistant/ai-rules", "Cứu đơn giao thất bại");
    const rescueTab = page.getByRole("button", { name: "Cứu đơn giao thất bại" }).or(page.getByRole("tab", { name: "Cứu đơn giao thất bại" }));
    await T("rescueTab", () => pct(rescueTab.first()));
    await rescueTab.first().click();
    await page.waitForTimeout(1500);
    await T("rescueContent", () => pct(page.locator("main").first()));
    await shot("gt-rescue.png");
  }

  // ================= TOUR TRỢ LÝ QUẢNG CÁO SHOPEE =================
  // 16/10/2026 làm lại (anh Trung: tính năng đổi nhiều, cấu hình phải chi tiết):
  // 8 ảnh / 15 bước — thêm hộp chi tiết chiến dịch, tách từng khối Cấu hình,
  // Sổ hành động & bảng điểm. Dải "app đã lên Google Play" bị ẩn qua localStorage
  // (hubsell_mobile_app_notice_dismissed) để không lọt vào ảnh.
  if (!ONLY || ONLY === "ads") {
    const scrollTo = async (locator, dy = -24) => {
      await locator.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.evaluate((d) => window.scrollBy(0, d), dy);
      await page.waitForTimeout(900);
    };
    // Ảnh 1: Tổng quan — thanh điều khiển + dải đỏ + 5 thẻ số
    await goto("/ads/shopee", "ROAS hòa vốn");
    await T("navAds", () => pct(page.getByRole("link", { name: "Quảng cáo Shopee" })));
    await T("adsToolbar", () => pctUnion(page.getByRole("combobox", { name: /Chọn gian hàng Shopee/ }), page.getByRole("button", { name: "Làm mới" })));
    await T("adsLinkBtn", () => pct(page.getByRole("button", { name: /Kết nối Hubsell Ads/ })));
    await T("adsTabs", () => pct(page.getByRole("tablist").first()));
    await T("adsBanner", () => pct(page.getByText(/Trợ lý phát hiện/).first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]")));
    await T("adsKpi", () => pctUnion(cardOf("Chi phí Ads"), cardOf("Lãi/lỗ ước tính")));
    await shot("ad-overview.png");
    // Ảnh 2: bảng chiến dịch
    await scrollTo(page.getByText("Chiến dịch quảng cáo", { exact: true }).first());
    await T("adsTable", () => pct(page.locator("table").first()));
    await shot("ad-campaigns.png");
    // Ảnh 3: hộp chi tiết một chiến dịch "Đề xuất tạm dừng" (căn cứ + từ khóa + nút quyết định)
    await page.locator("table tbody tr").filter({ hasText: /Áo thun cotton/ }).first().click();
    await page.getByRole("dialog").waitFor({ timeout: 10000 });
    await page.waitForTimeout(1200);
    await T("adsDetail", () => pct(page.getByRole("dialog")));
    await T("adsDetailButtons", () => pctUnion(page.getByRole("button", { name: "Mở Seller Center" }), page.getByRole("button", { name: "Bỏ qua cảnh báo" })));
    await shot("ad-detail.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    // Ảnh 4–5: tab Gợi ý chạy ads, ROAS hòa vốn sản phẩm
    for (const [name, file, key] of [
      ["Gợi ý chạy ads", "ad-suggest.png", "tabSuggest"],
      ["ROAS hòa vốn sản phẩm", "ad-breakeven.png", "tabBreakeven"],
    ]) {
      const tab = page.getByRole("tab", { name });
      await T(key, () => pct(tab));
      await tab.click();
      await page.waitForTimeout(3000);
      await T(key + "Content", () => pct(page.locator("main").first()));
      await shot(file);
    }
    // Ảnh 6: Cấu hình — nửa trên (bật, sàn dữ liệu, tự thực thi, quy tắc 1–2)
    const cfgTab = page.getByRole("tab", { name: /Cấu hình Trợ lý Tự động/ });
    await T("tabConfig", () => pct(cfgTab));
    await cfgTab.click();
    await page.waitForTimeout(3000);
    await T("cfgEnable", () => pct(cardOf("Bật Trợ lý cho gian này")));
    await T("cfgFloor", () => pct(cardOf("Sàn dữ liệu")));
    await T("cfgAuto", () => pct(cardOf("Tự thực thi (GĐ3)")));
    await T("cfgRule1", () => pct(cardOf("Quy tắc 1 — Loại thẳng")));
    await T("cfgRule2", () => pct(cardOf("Quy tắc 2 — Vùng vàng chờ duyệt")));
    await shot("ad-config.png");
    // Ảnh 7: Cấu hình — nửa dưới (quy tắc 3–4, hạ mục tiêu ROAS, Lưu)
    await scrollTo(cardOf("Quy tắc 3 — Vọt chi trong ngày"), -40);
    await T("cfgRule3", () => pct(cardOf("Quy tắc 3 — Vọt chi trong ngày")));
    await T("cfgRule4", () => pct(cardOf("Quy tắc 4 — Bảo vệ công thần")));
    await T("cfgProfit", () => pct(cardOf("Hạ mục tiêu ROAS — lãi tối thiểu giữ lại")));
    await T("cfgSave", () => pct(page.getByRole("button", { name: "Lưu cấu hình" })));
    await T("cfgProfitSave", () => pctUnion(cardOf("Hạ mục tiêu ROAS — lãi tối thiểu giữ lại"), page.getByRole("button", { name: "Lưu cấu hình" })));
    await shot("ad-config-2.png");
    // Ảnh 8: Sổ hành động & bảng điểm Trợ lý
    await scrollTo(page.getByText("Sổ hành động & bảng điểm Trợ lý", { exact: true }).first(), -60);
    await T("adsLog", () => pct(page.getByText("Sổ hành động & bảng điểm Trợ lý", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]")));
    await shot("ad-log.png");
  }

  // ================= TOUR TRỢ LÝ QUẢNG CÁO TIKTOK (16/10/2026) =================
  if (ONLY === "tiktokads") {
    const scrollTo = async (locator, dy = -24) => {
      await locator.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.evaluate((d) => window.scrollBy(0, d), dy);
      await page.waitForTimeout(900);
    };
    const ymd = (d) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const daysAgo = (n) => ymd(new Date(Date.now() - n * 86_400_000));
    // ---- Mock trang chiến dịch "Áo sơ mi lụa — đang lỗ" (DEMO-GMV-F) — số bịa nhưng khớp luật thật ----
    const CAMP = {
      id: "cmuz8pn0r00uftrrwtca3rdl4", campaignId: "DEMO-GMV-F", name: "Áo sơ mi lụa — đang lỗ", shopName: "Hubsell Demo Store",
      channelId: "cmuz8ls3m0006trn0c2wqpl5f", status: "ongoing", biddingMethod: "target_roi", roasTarget: 6, budget: 800000,
      spend: 1355000, orders: 13, gmv: 2839000, estProfit: -325730,
      auto: { mode: "dry_run", lastRunOn: daysAgo(1), lastRunMode: "dry_run", lastRunSummary: "Diễn tập: định loại 2 video (tiêu 318.000đ, 1 đơn) · 1 công thần ân hạn · 4 cần xem · 1 ổn", lastRunExclude: 2, lastRunSkipped: null, lastRunError: null },
      breakeven: { roi: 2.76, margin: 0.363, negativeMargin: false, source: "campaign", orders: 55, cancelledOrders: 4, pendingOrders: 7, costCoveragePct: 100, check: { revenuePlaced: 2910000, tiktokGmv: 2839000, from: daysAgo(7), to: daysAgo(1) } },
      advice: {
        kind: "losing", label: "Quảng cáo đang lỗ", tone: "warn",
        points: ["ROI thực 2,1 · hòa vốn 2,76.", "Mỗi 100đ doanh thu lỗ khoảng 11,5đ sau quảng cáo.", "ROI mục tiêu đang đặt 6 — chưa đạt."],
        conclusion: "Quảng cáo đang ăn vào vốn. Loại bớt video tiêu tiền mà ROI thấp trong bảng video của chiến dịch (hoặc bật tự động loại).",
        text: "ROI thực 2,1 dưới hòa vốn 2,76 — loại bớt video tiêu tiền mà ROI thấp.", budgetUsedPct: 34, keepPer100: -11.5, editInSellerCenter: true,
        nextTarget: null, keepAtNextTarget: null, safeTarget: 3.8, minKeepPer100: 10, watchHoursLeft: null, nextBudget: null,
      },
    };
    const V = (videoId, deliveryStatus, cost, orders, gmv, verdict, reason, extra = {}) => ({
      spuId: "1729000000000000001", videoId, deliveryStatus, cost, orders, gmv, impressions: Math.round(cost / 38), clicks: Math.round(cost / 1350),
      ctr: 1.9, cvr: orders > 0 ? Math.round((orders / Math.max(1, cost / 1350)) * 10000) / 100 : 0,
      roi: orders > 0 ? Math.round((gmv / cost) * 100) / 100 : null, noOrder: orders === 0, excluded: false, pending: null,
      auto: verdict ? { verdict, reason, on: daysAgo(1), graduatedOn: "" } : null, ...extra,
    });
    const VIDEOS = [
      V("7421000000000000101", "DELIVERING", 212000, 0, 0, "exclude", "tiêu 212.000đ mà 0 đơn (ngưỡng 200.000đ)"),
      V("7421000000000000102", "DELIVERING", 106000, 1, 148000, "exclude", "ROI 1,4 dưới mức loại 3,0 (50% mục tiêu 6,0)"),
      V("7421000000000000103", "DELIVERING", 268000, 2, 562000, "grace", "công thần 26 đơn/30 ngày — ROI 2,1 dưới mức loại, ân hạn ngày 1/2"),
      V("7421000000000000104", "DELIVERING", 154000, 2, 495000, "flag", "ROI 3,2 giữa mức loại 3,0 và mục tiêu 6,0 — cần xem"),
      V("7421000000000000105", "DELIVERING", 232000, 4, 914000, "flag", "ROI 3,9 giữa mức loại 3,0 và mục tiêu 6,0 — cần xem"),
      V("7421000000000000106", "DELIVERING", 171000, 2, 648000, "flag", "ROI 3,8 giữa mức loại 3,0 và mục tiêu 6,0 — cần xem"),
      V("7421000000000000107", "DELIVERING", 98000, 0, 0, "healthy", "tiêu 98.000đ, dưới ngưỡng 0 đơn 200.000đ"),
      V("7421000000000000108", "LEARNING", 41000, 0, 0, "learning", "TikTok còn đang học — chưa xét"),
      V("7421000000000000109", "DELIVERING", 26000, 0, 0, "insufficient", "tiêu 26.000đ dưới sàn dữ liệu 50.000đ"),
      V("7421000000000000110", "EXCLUDED", 112000, 0, 0, "exclude", "đã loại tay 3 ngày trước", { excluded: true }),
      V("7421000000000000111", "DELIVERING", 100000, 2, 349000, "flag", "ROI 3,5 giữa mức loại 3,0 và mục tiêu 6,0 — cần xem"),
    ];
    const noOrderRows = VIDEOS.filter((v) => v.noOrder && !v.excluded);
    const ACTIONS = [
      { id: "al1", action: "exclude_video", mode: "dry_run", status: "PLANNED", error: null, source: "auto", createdAt: new Date(Date.now() - 86_400_000 + 5 * 3600_000).toISOString(),
        videos: [{ videoId: "7421000000000000101", note: "chi 212.000đ · 0 đơn" }, { videoId: "7421000000000000102", note: "chi 106.000đ · 1 đơn · ROI 1,4" }],
        grounds: ["Cửa sổ 7 ngày tới hôm qua", "Luật: tiêu từ 200.000đ mà 0 đơn; ROI dưới 50% mục tiêu (3,0)", "Chế độ Diễn tập — chưa gửi lệnh"] },
      { id: "al2", action: "restore_video", mode: "live", status: "SUCCESS", error: null, source: "manual", createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        videos: [{ videoId: "7421000000000000106", note: "chi 171.000đ · 1 đơn" }], grounds: ["Chủ shop khôi phục tay"] },
      { id: "al3", action: "exclude_video", mode: "live", status: "SUCCESS", error: null, source: "manual", createdAt: new Date(Date.now() - 3 * 86_400_000 - 3600_000).toISOString(),
        videos: [{ videoId: "7421000000000000110", note: "chi 112.000đ · 0 đơn" }], grounds: ["Chủ shop loại tay"] },
      { id: "al4", action: "config_change", mode: "dry_run", status: "SUCCESS", error: null, source: "manual", createdAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
        videos: [], grounds: ["Chế độ: Tắt → Diễn tập", "ROI mục tiêu: 5 → 6", "Tiêu từ … mà 0 đơn: 150.000 → 200.000"] },
    ];
    const videosPayload = (from, to) => ({
      campaign: CAMP, from, to,
      products: [{ spuId: "1729000000000000001", name: "Áo sơ mi lụa công sở", cost: 1355000, orders: 13, gmv: 2839000 }],
      videos: VIDEOS, actions: ACTIONS,
      totals: { videoCount: VIDEOS.length, spendingCount: VIDEOS.filter((v) => v.cost > 0 && !v.excluded).length, excludedCount: 1,
        videoSpend: VIDEOS.filter((v) => !v.excluded).reduce((a, v) => a + v.cost, 0),
        noOrderCount: noOrderRows.length, noOrderSpend: noOrderRows.reduce((a, v) => a + v.cost, 0) },
    });
    const PV = (v, verdict, reason) => ({ videoId: v.videoId, spuId: v.spuId, cost: v.cost, orders: v.orders, gmv: v.gmv, roi: v.roi, verdict, reason });
    const previewPayload = (config) => ({
      config, windowFrom: daysAgo(7), windowTo: daysAgo(1),
      summary: "Nếu áp hôm nay: loại 2 video (tiêu 318.000đ, 1 đơn) · 1 công thần ân hạn · 4 cần xem · 1 ổn · 1 đang học · 1 chưa đủ số",
      counts: { exclude: 2, grace: 1, flag: 4, healthy: 1, learning: 1, insufficient: 1, protected: 0 },
      excludeSpend: 318000, excludeOrders: 1,
      exclude: [PV(VIDEOS[0], "exclude", VIDEOS[0].auto.reason), PV(VIDEOS[1], "exclude", VIDEOS[1].auto.reason)],
      heldByCap: [], heldByFloor: [], grace: [PV(VIDEOS[2], "grace", VIDEOS[2].auto.reason)], flag: [3, 4, 5, 10].map((i) => PV(VIDEOS[i], "flag", VIDEOS[i].auto.reason)), protected: [],
      tracking: { seen: 11, newVideos: 1, graduated: 0, relearning: 0 }, dataProblem: "",
      hard: { hardRoi: 3, basis: "pct", fallbackReason: "", label: "50% ROI mục tiêu (6,0)" },
    });
    const backtestPayload = () => ({
      firstPlanOn: daysAgo(3),
      videos: [
        { videoId: "7421000000000000101", spuId: "1729000000000000001", firstPlannedOn: daysAgo(3), lastPlannedOn: daysAgo(1), plannedDays: 3, noteAtPlan: "chi 164.000đ · 0 đơn", deliveryStatus: "DELIVERING", daysSince: 3, cost: 96000, orders: 0, gmv: 0, roi: null, verdict: "right" },
        { videoId: "7421000000000000102", spuId: "1729000000000000001", firstPlannedOn: daysAgo(2), lastPlannedOn: daysAgo(1), plannedDays: 2, noteAtPlan: "chi 71.000đ · 1 đơn · ROI 1,4", deliveryStatus: "DELIVERING", daysSince: 2, cost: 48000, orders: 1, gmv: 190000, roi: 3.96, verdict: "middle" },
      ],
      totals: { videos: 2, cost: 144000, orders: 1, gmv: 190000, roi: 1.32 }, counts: { right: 1, middle: 1, recovered: 0, insufficient: 0 },
      marks: { roiTarget: 6, hardRoi: 3, hardBasis: "pct", minSpend: 50000 }, from: daysAgo(2), to: daysAgo(1), truncated: false, planDays: 3, configChangedOn: null, plansBeforeChange: 0,
    });
    const META = Object.fromEntries(VIDEOS.map((v, i) => [v.videoId, { videoId: v.videoId, author: "sunnycloset.vn", authorName: "Sunny Closet", caption: ["Áo sơ mi lụa công sở mặc là mát", "Thử 3 cách phối áo sơ mi lụa", "Unbox áo sơ mi lụa 199k", "Áo sơ mi lụa đi làm đi chơi", "Review chất vải lụa thật", "Sơ mi lụa mix chân váy", "Top 5 áo công sở", "Sơ mi lụa cho nàng mũm mĩm", "Phối đồ đi phỏng vấn", "Áo sơ mi lụa tông pastel", "Sale cuối tuần áo sơ mi"][i], thumbnailUrl: "/logo-hubsell.png" }]));
    const q = (url) => Object.fromEntries(new URL(url).searchParams.entries());
    // Token demo không gọi được TikTok → mỗi lượt kéo số backend đánh dấu REVOKED; vá lại trong phản hồi tổng quan.
    await page.route(/\/api\/quang-cao\/tiktok\?/, async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      if (j.link) Object.assign(j.link, { status: "ACTIVE", lastSyncError: "" });
      for (const c of j.channels ?? []) if (c.ads) Object.assign(c.ads, { status: "ACTIVE", problem: "" });
      await route.fulfill({ json: j });
    });
    await page.route(/\/api\/quang-cao\/tiktok\/campaigns\/[^/]+\/videos\?/, (route) => { const p = q(route.request().url()); route.fulfill({ json: videosPayload(p.from, p.to) }); });
    await page.route(/\/api\/quang-cao\/tiktok\/campaigns\/[^/]+\/videos\/outside\?/, (route) => { const p = q(route.request().url()); route.fulfill({ json: { from: p.from, to: p.to, groups: [] } }); });
    await page.route(/\/api\/quang-cao\/tiktok\/video-meta\?/, (route) => route.fulfill({ json: { items: META } }));
    await page.route(/\/api\/quang-cao\/tiktok\/campaigns\/[^/]+\/auto-rule\/preview/, async (route) => { const body = route.request().postDataJSON?.() ?? {}; route.fulfill({ json: previewPayload(body.config ?? body) }); });
    await page.route(/\/api\/quang-cao\/tiktok\/campaigns\/[^/]+\/auto-rule\/backtest/, (route) => route.fulfill({ json: backtestPayload() }));

    // Ảnh 1: tab Kết nối tài khoản quảng cáo
    await goto("/ads/tiktok", "Chiến dịch GMV Max");
    await T("navTiktok", () => pct(page.getByRole("link", { name: "Quảng cáo TikTok" })));
    const connectTab = page.getByRole("tab", { name: /Kết nối tài khoản quảng cáo/ });
    await T("tabConnect", () => pct(connectTab));
    await connectTab.click();
    await page.waitForTimeout(2000);
    await T("connectCard", () => pct(cardOf("Tài khoản quảng cáo của từng gian")));
    await shot("tt-connect.png");
    // Ảnh 2: Tổng quan — thanh điều khiển + 5 thẻ
    await page.getByRole("tab", { name: "Tổng quan chiến dịch" }).click();
    await page.waitForTimeout(2500);
    await T("ttToolbar", () => pctUnion(page.getByRole("combobox", { name: "Chọn gian hàng TikTok" }), page.getByRole("button", { name: /Làm mới/ })));
    await T("ttKpi", () => pctUnion(cardOf("Chi phí quảng cáo"), cardOf("Lãi/lỗ ước tính")));
    await shot("tt-overview.png");
    // Ảnh 3: bảng chiến dịch GMV Max
    await scrollTo(page.getByText("Chiến dịch GMV Max", { exact: true }).first());
    await T("ttTable", () => pct(page.locator("table").first()));
    await T("ttMinKeep", () => pct(page.getByText("Lãi tối thiểu giữ lại sau quảng cáo", { exact: true }).first().locator("xpath=ancestor::div[1]")));
    await shot("tt-campaigns.png");
    // Ảnh 3b: bảng cuộn sang phải — ROI mục tiêu · Hòa vốn · ROI thực · Lãi/lỗ · Nhận định (bảng rộng hơn khung 1440)
    await page.locator("table").first().evaluate((t) => { const sc = t.closest("[class*=overflow]") || t.parentElement; sc.scrollLeft = sc.scrollWidth; });
    await page.waitForTimeout(600);
    await T("ttTableRight", () => pct(page.locator("table").first().locator("thead")));
    await shot("tt-campaigns-2.png");
    // Ảnh 4: popover Nhận định (chiến dịch Áo sơ mi lụa — đang lỗ)
    const lossRow = page.locator("table tbody tr").filter({ hasText: /Áo sơ mi lụa/ }).first();
    const adviceBtn = lossRow.getByRole("button", { name: /^Nhận định:/ }).first();
    await adviceBtn.scrollIntoViewIfNeeded();
    await adviceBtn.click();
    await page.waitForTimeout(900);
    await T("ttAdvicePop", () => pct(page.locator("[data-slot=popover-content], [data-radix-popper-content-wrapper], [role=dialog]").last()));
    await shot("tt-advice.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    // Ảnh 5: tab Hòa vốn sản phẩm
    await page.evaluate(() => window.scrollTo(0, 0));
    const beTab = page.getByRole("tab", { name: "Hòa vốn sản phẩm" });
    await T("tabBreakevenTt", () => pct(beTab));
    await beTab.click();
    await page.waitForTimeout(4000);
    await T("ttBreakevenMain", () => pct(page.locator("main").first()));
    await shot("tt-breakeven.png");
    // Ảnh 6: trang chiến dịch — 3 thẻ + lọc nhanh + bảng video
    await goto(`/ads/tiktok/campaign?id=${CAMP.id}`, "Video đang tiêu tiền");
    await page.waitForTimeout(1500);
    await T("ttCampHead", () => pct(page.locator("header, [class*=PageHeaderBand]").first()).catch(() => pct(page.locator("h1").first())));
    await T("ttCampStats", () => pctUnion(cardOf("Video đang tiêu tiền"), cardOf("Tiền vào các video đó")));
    await T("ttVideoTable", () => pct(page.locator("table").first()));
    await T("ttChips", () => pct(page.getByRole("button", { name: /^Tất cả/ }).first()));
    await shot("tt-campaign.png");
    // Ảnh 7: tick 2 video → thanh công cụ Loại
    const boxes = page.locator("table tbody input[type=checkbox]");
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.waitForTimeout(700);
    await T("ttPickBar", () => pct(page.getByRole("button", { name: /Loại/ }).last().locator("xpath=ancestor::div[1]")));
    await shot("tt-campaign-pick.png");
    await page.getByRole("button", { name: /Bỏ chọn|Bỏ tick/ }).first().click().catch(() => {});
    // Ảnh 8–9: hộp Tự động loại video (nửa trên: chế độ + ROI mục tiêu + sàn; nửa dưới: luật nâng cao)
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("button", { name: "Tự động loại video" }).click();
    await page.getByRole("dialog").waitFor({ timeout: 10000 });
    await page.waitForTimeout(2500);
    const dlg = page.getByRole("dialog");
    await T("ttRuleDialog", () => pct(dlg));
    await T("ttRuleMode", () => pct(dlg.getByRole("radiogroup", { name: "Chế độ tự động loại video" })));
    await shot("tt-rule.png");
    const adv = dlg.getByText("Nâng cao", { exact: true }).first();
    if (await adv.count()) { await adv.click(); await page.waitForTimeout(600); }
    await dlg.getByText("Loại thẳng tay", { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(600);
    await T("ttRuleHard", () => pct(dlg.getByText("Loại thẳng tay", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]")));
    await T("ttRuleGrace", () => pct(dlg.getByText("Bảo vệ video công thần", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]")));
    await T("ttRuleCap", () => pct(dlg.getByText("Chốt an toàn mỗi ngày", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]")));
    await shot("tt-rule-2.png");
    await dlg.getByRole("button", { name: /Chạy thử với cấu hình này/ }).click();
    await dlg.getByText("Nếu áp hôm nay").first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await dlg.getByText("Nếu áp hôm nay").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(600);
    await T("ttRulePreview", () => pct(dlg.getByText("Nếu áp hôm nay").first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]")));
    await shot("tt-rule-3.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    // Ảnh 10: tab Đối chiếu diễn tập
    const btTab = page.getByRole("tab", { name: "Đối chiếu diễn tập" });
    await T("tabBacktest", () => pct(btTab));
    await btTab.click();
    await page.waitForTimeout(2500);
    await T("ttBacktest", () => pct(page.getByText("Đối chiếu diễn tập — máy định loại có đúng không?").first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]")));
    await shot("tt-backtest.png");
    // Ảnh 11: tab Lịch sử loại / khôi phục
    const hisTab = page.getByRole("tab", { name: /Lịch sử loại \/ khôi phục/ });
    await hisTab.click();
    await page.waitForTimeout(1500);
    await T("ttHistory", () => pct(page.getByText("Lịch sử loại / khôi phục video").first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]")));
    await shot("tt-history.png");
  }

  // ================= TOUR NHÂN VIÊN & GÓI DỊCH VỤ =================
  if (!ONLY || ONLY === "nhansu") {
    await goto("/staff", "Thêm nhân viên");
    await T("navStaff", () => pct(page.getByRole("link", { name: "Nhân viên" })));
    const addStaff = page.getByRole("button", { name: "Thêm nhân viên" });
    await T("btnAddStaff", () => pct(addStaff));
    await shot("ns-staff.png");
    await addStaff.click();
    await page.getByRole("dialog").waitFor({ timeout: 10000 });
    await page.waitForTimeout(800);
    await T("staffDialog", () => pct(page.getByRole("dialog")));
    await shot("ns-staff-dialog.png");
    await page.keyboard.press("Escape");

    await goto("/settings/plan", "Chọn gói & thanh toán");
    await T("navPlan", () => pct(page.getByRole("link", { name: "Gói dịch vụ" })));
    await T("planUsage", () => pct(page.getByText("Đơn hàng tháng này").first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]")));
    await shot("ns-plan.png");
    await page.getByText("Chọn gói & thanh toán").scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await T("planCards", () => pct(page.getByText("Business", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]")));
    await shot("ns-plan-cards.png");

    await goto("/settings/general", "Chế độ hiển thị");
    await T("navGeneral", () => pct(page.getByRole("link", { name: "Cấu hình chung" })));
    await T("themeCard", () => pct(cardOf("Chế độ hiển thị")));
    await T("accentCard", () => pct(cardOf("Giao diện hệ thống")));
    await shot("ns-general.png");
  }

  await browser.close();
  console.log("TOA DO MUC TIEU (% khung 1440x960):");
  console.log(JSON.stringify(targets, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
