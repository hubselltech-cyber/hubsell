/**
 * Chụp 5 màn LAZADA SERVICE MARKETPLACE cho tour Kết nối Lazada (cần phiên seller):
 *   lz-marketplace.png     trang gói Hubsell ₫0 (chọn phiên bản + chu kỳ, nút Sử dụng được phép)
 *   lz-order-confirm.png   trang Xác nhận đơn hàng (tick Term of use + Xác nhận) — KHÔNG bấm Xác nhận
 *   lz-order-success.png   Đặt hàng thành công (nút Được phép sử dụng dịch vụ)
 *   lz-subscribed.png      Dịch vụ đã mua (nút Dịch vụ sử dụng trên thẻ Hubsell)
 *   lz-agree-modal.png     hộp Đồng ý truyền dữ liệu (tick + Đồng ý) — KHÔNG bấm Đồng ý
 *
 * Extension Claude in Chrome không nối được (14/09) nên dùng Chromium HIỆN HÌNH của
 * Playwright với hồ sơ riêng: lần đầu người dùng tự đăng nhập Seller Center trong
 * cửa sổ này (script chờ tới khi URL sang marketplace.lazada.vn), các lần sau hồ sơ
 * còn phiên. Ảnh 1440x960 → public/guide-assets/tour/; in tọa độ % để dán vào LAZADA_TOUR.
 *
 * Chạy: node scripts/capture-lazada-marketplace.js
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = "D:/Claude Code/Hubsell/frontend/public/guide-assets/tour";
const PROFILE = "D:/Claude Code/.claude-tmp/lazada-marketplace-profile";
const VIEW = { width: 1440, height: 960 };
const DETAIL =
  "https://marketplace.lazada.vn/web/detail.html?articleCode=FW_GOODS-1000034551&itemCode=FW_GOODS-1000034551-1";
const SUCCESS = "https://marketplace.lazada.vn/web/trade/order-pay-result.html?orderId=9000000072403008522";
const LIST = "https://marketplace.lazada.vn/web/subscribe/list.html";

const r = (v) => Math.round(v * 100) / 100;
const pct = async (locator) => {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Không lấy được boundingBox: " + locator);
  return {
    x: r(((b.x + b.width / 2) / VIEW.width) * 100),
    y: r(((b.y + b.height / 2) / VIEW.height) * 100),
    w: r((b.width / VIEW.width) * 100),
    h: r((b.height / VIEW.height) * 100),
  };
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

(async () => {
  fs.mkdirSync(PROFILE, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: VIEW,
    deviceScaleFactor: 2,
    locale: "vi-VN",
    args: ["--window-size=1470,1060"],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const targets = {};

  // ---- Đăng nhập (người dùng tự làm trong cửa sổ) ----
  await page.goto(
    "https://sellercenter.lazada.vn/apps/seller/login?login=1&redirect_url=" + encodeURIComponent(LIST),
    { waitUntil: "domcontentloaded" }
  );
  // So theo HOSTNAME — URL đăng nhập cũng chứa chữ marketplace.lazada.vn trong redirect_url.
  const onMarketplace = (u) => new URL(String(u)).hostname === "marketplace.lazada.vn";
  if (!onMarketplace(page.url())) {
    console.log("ĐANG CHỜ ĐĂNG NHẬP Seller Center (Hi.Bé) trong cửa sổ Chromium vừa mở… (tối đa 15 phút)");
    await page.waitForURL(onMarketplace, { timeout: 15 * 60 * 1000 });
  }
  console.log("Đã vào Marketplace:", page.url());

  // ---- lz-subscribed: Dịch vụ đã mua ----
  await page.goto(LIST, { waitUntil: "domcontentloaded" });
  const useBtn = page.getByText(/Dịch vụ sử d[uù]ng/).first();
  await useBtn.waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  targets.useServiceButton = await pct(useBtn);
  await shot(page, "lz-subscribed.png");

  // ---- lz-agree-modal: bấm Dịch vụ sử dụng → hộp Đồng ý (không bấm Đồng ý) ----
  await useBtn.click();
  const agreeBtn = page.getByRole("button", { name: /^Đồng ý$/ }).first();
  await agreeBtn.waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const agreeCheckbox = page.locator(".next-dialog input[type=checkbox], [role=dialog] input[type=checkbox], input[type=checkbox]").last();
  targets.agreeCheckbox = await pct(agreeCheckbox);
  targets.agreeButton = await pct(agreeBtn);
  await shot(page, "lz-agree-modal.png");
  await page.keyboard.press("Escape").catch(() => {});

  // ---- lz-order-success: Đặt hàng thành công ----
  await page.goto(SUCCESS, { waitUntil: "domcontentloaded" });
  const allowBtn = page.getByText(/Được phép sử dụng dịch vụ/).first();
  await allowBtn.waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  targets.allowUseButton = await pct(allowBtn);
  await shot(page, "lz-order-success.png");

  // ---- lz-marketplace: trang gói ----
  await page.goto(DETAIL, { waitUntil: "domcontentloaded" });
  const subscribeBtn = page.getByText(/Sử dụng được phép/).first();
  await subscribeBtn.waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  const versionChip = page.getByText(/Hubsell Miễn phí/).first();
  const cycleChip = page.getByText(/^Nửa năm$/).first();
  targets.versionChip = await pct(versionChip);
  targets.cycleChip = await pct(cycleChip);
  targets.subscribeButton = await pct(subscribeBtn);
  await shot(page, "lz-marketplace.png");

  // ---- lz-order-confirm: chọn gói + chu kỳ → Sử dụng được phép → trang Xác nhận (KHÔNG bấm Xác nhận) ----
  await versionChip.click().catch(() => {});
  await cycleChip.click().catch(() => {});
  await subscribeBtn.click();
  const confirmBtn = page.getByRole("button", { name: /^Xác nhận$/ }).first();
  // Shop ĐÃ có gói có thể không được đưa tới trang Xác nhận nữa → bỏ qua ảnh này,
  // báo ra để dựng bằng cách khác (ảnh chụp tay / dựng HTML).
  const hasConfirm = await confirmBtn.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (hasConfirm) {
    await page.waitForTimeout(1200);
    const termCheckbox = page.locator("input[type=checkbox]").first();
    targets.termCheckbox = (await termCheckbox.count()) ? await pct(termCheckbox) : null;
    targets.termText = await pct(page.getByText(/Term of use/i).first()).catch(() => null);
    targets.confirmButton = await pct(confirmBtn);
    await shot(page, "lz-order-confirm.png");
  } else {
    console.log("⚠ Không tới được trang Xác nhận đơn hàng (URL hiện tại: " + page.url() + ") — thiếu lz-order-confirm.png");
    await shot(page, "lz-after-subscribe-click.png");
  }

  await ctx.close();
  console.log("TOA DO MUC TIEU (% khung 1440x960) — dan vao LAZADA_TOUR:");
  console.log(JSON.stringify(targets, null, 2));
})().catch((e) => {
  console.error(e);
  // Đóng mọi Chromium còn treo kẻo hồ sơ bị khóa ở lần chạy sau.
  process.exit(1);
});
