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
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/capture-live-tour-assets.js [taichinh|giutien|ads|nhansu]
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
  const login = await fetch("https://localhost:4000/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ACCOUNT),
  }).then((res) => res.json());
  if (!login.token) throw new Error("Đăng nhập demo thất bại: " + JSON.stringify(login));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEW, deviceScaleFactor: 2, locale: "vi-VN", ignoreHTTPSErrors: true,
  });
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem("hubsell_token", t);
    localStorage.setItem("hubsell_user", JSON.stringify(u));
    localStorage.setItem("hubsell_onboarding_tour_seen", "1");
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
    await shot("tc-expenses.png");
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
  if (!ONLY || ONLY === "ads") {
    await goto("/ads/shopee", "ROAS hòa vốn");
    await T("navAds", () => pct(page.getByRole("link", { name: "Quảng cáo Shopee" })));
    await T("adsTabs", () => pct(page.getByRole("tablist").first()));
    await T("adsBanner", () => pct(page.getByText(/Trợ lý phát hiện/).first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]")));
    await T("adsKpi", () => pctUnion(cardOf("Chi phí Ads"), cardOf("ROAS")));
    await T("adsBreakeven", () => pctUnion(cardOf("ROAS hòa vốn"), cardOf("Lãi/lỗ ước tính")));
    await shot("ad-overview.png");
    await page.locator("table").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    await T("adsTable", () => pct(page.locator("table").first()));
    await shot("ad-campaigns.png");
    for (const [name, file, key] of [
      ["Gợi ý chạy ads", "ad-suggest.png", "tabSuggest"],
      ["ROAS hòa vốn sản phẩm", "ad-breakeven.png", "tabBreakeven"],
      [/Cấu hình Trợ lý Tự động/, "ad-config.png", "tabConfig"],
    ]) {
      const tab = page.getByRole("tab", { name });
      await T(key, () => pct(tab));
      await tab.click();
      await page.waitForTimeout(3000);
      await T(key + "Content", () => pct(page.locator("main").first()));
      await shot(file);
    }
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
