/**
 * DỰNG LẠI trang "Xác nhận đơn hàng" của Lazada Service Marketplace → lz-order-confirm.png
 * (bước 10 tour Kết nối Lazada). Không chụp thật được: shop đã có gói thì bấm
 * "Sử dụng được phép" Lazada không đưa tới trang này nữa (14/09/2026). Bố cục
 * dựng theo đúng những gì đã thấy khi Hi.Bé đặt gói thật: thẻ dịch vụ Hubsell /
 * Hubsell Miễn phí / Nửa năm / ₫0, ô tick "Đang đồng ý và ký kết Term of use",
 * nút Xác nhận. Header + thanh tìm kiếm dùng ảnh THẬT cắt từ lz-marketplace.png
 * (truyền qua data URI vì setContent chặn file://). Cùng cách làm với màn Confirm
 * Shopee (capture-shopee-confirm.js).
 *
 * Chạy: node scripts/capture-lazada-order-confirm.js  (cần scratchpad/mk-header.png
 * — tạo bằng: ffmpeg -i lz-marketplace.png -vf crop=2880:250:0:0 mk-header.png)
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = "D:/Claude Code/Hubsell/frontend/public/guide-assets/tour";
const HEADER = process.argv[2] ||
  "D:/Claude Code/.claude-tmp/claude/D--Claude-Code-Hubsell/e8c4f83c-67f1-405c-bce8-a539da7ec8ac/scratchpad/mk-header.png";
const LOGO = "D:/Claude Code/Hubsell/frontend/public/logo.png";
const VIEW = { width: 1440, height: 960 };

const dataUri = (p) => "data:image/png;base64," + fs.readFileSync(p).toString("base64");
const logoUri = fs.existsSync(LOGO) ? dataUri(LOGO) : "";

const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box} body{margin:0;font-family:Roboto,"Segoe UI",Arial,sans-serif;background:#f0f2f5;color:#333}
  .hdr{display:block;width:1440px;height:125px}
  .wrap{width:1200px;margin:0 auto}
  .crumb{font-size:14px;color:#666;padding:18px 0 14px}
  .crumb b{color:#333;font-weight:400}
  .card{background:#fff;border-radius:10px;padding:26px 30px;margin-bottom:16px}
  h1{font-size:20px;margin:0 0 18px;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th{color:#888;font-weight:400;text-align:left;padding:10px 8px;border-bottom:1px solid #eee}
  td{padding:16px 8px;vertical-align:middle;border-bottom:1px solid #f3f3f3}
  .svc{display:flex;align-items:center;gap:14px}
  .svc img{width:56px;height:56px;border-radius:8px;background:#fff;border:1px solid #eee}
  .svc .n{font-weight:600}
  .svc .s{color:#888;font-size:12px}
  .price{color:#1a66ff;font-weight:600}
  .sum{display:flex;justify-content:flex-end;gap:36px;font-size:14px;padding-top:12px}
  .sum .t{color:#888}
  .sum .v{font-size:22px;color:#1a66ff;font-weight:600}
  .term{display:flex;align-items:center;gap:10px;font-size:14px;padding:6px 0 4px}
  .term input{width:16px;height:16px;margin:0}
  .term a{color:#1a66ff;text-decoration:none}
  .btns{display:flex;justify-content:flex-end;gap:12px;padding-top:8px}
  .btn{height:44px;padding:0 34px;border-radius:6px;font-size:16px;border:1px solid #ddd;background:#fff;color:#555}
  .btn.p{background:#1a66ff;border-color:#1a66ff;color:#fff}
</style></head><body>
<img class="hdr" src="${dataUri(HEADER)}" alt="">
<div class="wrap">
  <div class="crumb">Trang đầu &nbsp;&gt;&nbsp; Tên ứng dùng &nbsp;&gt;&nbsp; <b>Xác nhận đơn hàng</b></div>
  <div class="card">
    <h1>Xác nhận đơn hàng</h1>
    <table>
      <tr><th style="width:44%">Dịch vụ</th><th>Phiên bản</th><th>Chu kỳ</th><th>Số lượng</th><th style="text-align:right">Thành tiền</th></tr>
      <tr>
        <td><div class="svc">${logoUri ? `<img src="${logoUri}" alt="">` : ""}<div><div class="n">Hubsell</div><div class="s">Hubsell · ERP &amp; Omnichannel</div></div></div></td>
        <td>Hubsell Miễn phí</td><td>Nửa năm</td><td>1</td><td style="text-align:right" class="price">₫0</td>
      </tr>
    </table>
    <div class="sum"><span class="t">Thanh toán thực tế:</span><span class="v">₫0</span></div>
  </div>
  <div class="card">
    <label class="term"><input id="term" type="checkbox" checked> Đang đồng ý và ký kết <a href="#">Term of use</a></label>
    <div class="btns"><button class="btn" type="button">Quay lại</button><button id="confirm" class="btn p" type="button">Xác nhận</button></div>
  </div>
</div>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(400);
  const r = (v) => Math.round(v * 100) / 100;
  const pct = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    return { x: r(((b.x + b.width / 2) / VIEW.width) * 100), y: r(((b.y + b.height / 2) / VIEW.height) * 100), w: r((b.width / VIEW.width) * 100), h: r((b.height / VIEW.height) * 100) };
  };
  const targets = { termCheckbox: await pct("#term"), termLabel: await pct(".term"), confirmButton: await pct("#confirm") };
  await page.screenshot({ path: path.join(OUT, "lz-order-confirm.png") });
  await browser.close();
  console.log(JSON.stringify(targets, null, 2));
})();
