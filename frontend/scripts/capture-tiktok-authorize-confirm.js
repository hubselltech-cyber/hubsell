/**
 * DỰNG LẠI màn "02 Ủy quyền" của trang custom-authorize TikTok Shop Seller Center
 * → public/guide-assets/tour/tk-authorize-confirm.png (tour Kết nối TikTok).
 *
 * Không chụp thật được: trang này chỉ hiện sau khi seller đăng nhập Seller
 * Center và bấm "Xác nhận cài đặt" ở bước 01; shop nhà đã ủy quyền rồi nên
 * TikTok không cho đi lại. Bố cục dựng theo trang thật đã thấy 16/09/2026
 * (stepper 01 Cài đặt → 02 Ủy quyền, thẻ trắng giữa trang, logo + tên app,
 * nút teal góc phải) + danh sách quyền = đúng 11 scope app Hubsell đang xin.
 * Header đen dùng ảnh THẬT cắt từ màn bước 01 (tk-authorize-settings.png).
 * Cùng cách làm với capture-lazada-order-confirm.js / capture-shopee-confirm.js.
 *
 * Chạy: node scripts/capture-tiktok-authorize-confirm.js [header.png]
 *   header mặc định: cắt tự động từ tk-authorize-settings.png (56px trên cùng).
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const OUT = "D:/Claude Code/Hubsell/frontend/public/guide-assets/tour";
const LOGO = "D:/Claude Code/Hubsell/frontend/public/logo-hubsell.png";
const VIEW = { width: 1440, height: 960 };
const SHOP = "DarkMan";

const dataUri = (buf) => "data:image/png;base64," + buf.toString("base64");

const SCOPES = [
  ["Thông tin cửa hàng", "Tên gian hàng, mã gian hàng, khu vực bán."],
  ["Thông tin ủy quyền", "Danh sách cửa hàng bạn đã cấp quyền cho Hubsell."],
  ["Thông tin đơn hàng", "Đơn mới, trạng thái giao, người nhận — để gom đơn về một chỗ."],
  ["Thông tin tài chính", "Bản kê quyết toán, phí sàn, tiền về — để tính lãi/lỗ từng đơn."],
  ["Hoàn tất đơn hàng cơ bản", "Chuẩn bị hàng, in vận đơn, xếp lịch lấy hàng."],
  ["Vận chuyển cơ bản", "Hãng vận chuyển, mã vận đơn, hành trình kiện hàng."],
  ["Sản phẩm cơ bản", "Danh mục sản phẩm, SKU, tồn kho trên sàn."],
  ["Trả hàng & hoàn tiền cơ bản", "Yêu cầu trả hàng, hoàn tiền — để đối soát đơn hoàn."],
  ["Tách & gộp kiện hàng", "Tách hoặc gộp kiện khi chuẩn bị hàng."],
  ["Phân tích", "Số liệu hiệu quả bán hàng của gian."],
  ["Thông tin khuyến mãi", "Chương trình khuyến mãi đang chạy trên gian."],
];

(async () => {
  const headerSrc =
    process.argv[2] ||
    (await sharp(path.join(OUT, "tk-authorize-settings.png"))
      .extract({ left: 0, top: 0, width: 1440, height: 56 })
      .png()
      .toBuffer());
  const headerUri = dataUri(Buffer.isBuffer(headerSrc) ? headerSrc : fs.readFileSync(headerSrc));
  const logoUri = fs.existsSync(LOGO) ? dataUri(fs.readFileSync(LOGO)) : "";

  const rows = SCOPES.map(
    ([t, d]) => `<li><span class="ck">✓</span><div><b>${t}</b><small>${d}</small></div></li>`
  ).join("");

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box} body{margin:0;font-family:"Segoe UI",Roboto,Arial,sans-serif;background:#f5f5f5;color:#222}
  .hdr{display:block;width:1440px;height:56px}
  h1{text-align:center;font-size:27px;font-weight:700;margin:42px 0 26px}
  .steps{display:flex;justify-content:center;align-items:center;gap:14px;font-size:17px;margin-bottom:30px}
  .steps .done{color:#0e9a8f;font-weight:600}
  .steps .cur{font-weight:700}
  .steps .dots{width:330px;border-top:3px dotted #0e9a8f;height:0}
  .card{width:612px;margin:0 auto;background:#fff;border-radius:6px;padding:26px 24px 22px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .app{text-align:center;margin-bottom:12px}
  .app img{width:40px;height:40px;border-radius:8px}
  .app .n{font-weight:700;font-size:15px;margin-top:6px}
  .app .s{font-size:12px;color:#666}
  .lead{font-size:14px;color:#333;margin:0 0 12px}
  ul{list-style:none;margin:0;padding:0;border:1px solid #eee;border-radius:6px;max-height:412px;overflow:hidden}
  li{display:flex;gap:10px;padding:9px 12px;border-bottom:1px solid #f0f0f0;align-items:flex-start}
  li:last-child{border-bottom:0}
  .ck{color:#0e9a8f;font-weight:700;font-size:13px;line-height:18px;flex:0 0 14px}
  li b{display:block;font-size:13px;font-weight:600;line-height:18px}
  li small{display:block;font-size:11.5px;color:#777;line-height:15px}
  .note{font-size:11.5px;color:#777;margin:12px 0 0;line-height:16px}
  .note a{color:#0e9a8f;text-decoration:none}
  .btns{display:flex;justify-content:flex-end;gap:12px;margin-top:16px}
  .btn{height:44px;padding:0 26px;border-radius:4px;font-size:14px;font-weight:600;display:inline-flex;align-items:center;border:1px solid #ccc;background:#fff;color:#333}
  .btn.p{background:#0e9a8f;border-color:#0e9a8f;color:#fff}
</style></head><body>
<img class="hdr" src="${headerUri}" alt="">
<h1>Ủy quyền</h1>
<div class="steps"><span class="done">01 Cài đặt ✓</span><span class="dots"></span><span class="cur">02 Ủy quyền</span></div>
<div class="card">
  <div class="app">${logoUri ? `<img src="${logoUri}" alt="">` : ""}<div class="n">Hubsell</div><div class="s">Hubsell</div></div>
  <p class="lead"><b>Hubsell</b> muốn truy cập cửa hàng <b>${SHOP}</b> của bạn với các quyền sau:</p>
  <ul>${rows}</ul>
  <p class="note">Bằng cách bấm Ủy quyền, bạn cho phép đối tác truy cập dữ liệu cửa hàng theo thời hạn đã chọn ở bước Cài đặt (Không giới hạn). Bạn có thể thu hồi bất cứ lúc nào tại Trung tâm nhà bán hàng → Dịch vụ → Quản lý ủy quyền. Xem <a href="#">Chính sách quyền riêng tư của đối tác</a>.</p>
  <div class="btns"><span class="btn">Quay lại</span><span class="btn p" id="authorize">Ủy quyền</span></div>
</div>
</body></html>`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(400);
  const b = await page.locator("#authorize").boundingBox();
  const ul = await page.locator("ul").boundingBox();
  const r = (v) => Math.round(v * 100) / 100;
  const pct = (bb) => ({
    x: r(((bb.x + bb.width / 2) / VIEW.width) * 100),
    y: r(((bb.y + bb.height / 2) / VIEW.height) * 100),
    w: r((bb.width / VIEW.width) * 100),
    h: r((bb.height / VIEW.height) * 100),
  });
  await page.screenshot({ path: path.join(OUT, "tk-authorize-confirm.png") });
  await browser.close();
  console.log("OK tk-authorize-confirm.png — authorizeBtn:", JSON.stringify(pct(b)), "scopeList:", JSON.stringify(pct(ul)));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
