/**
 * Sinh MP3 thuyết minh cho 3 tour động của trang Hướng dẫn sử dụng (/guide):
 * Quản lý kho (6), Đơn hàng & dòng tiền (6), Hóa đơn (7) — giọng NỮ tiếng Việt
 * vi-VN-HoaiMyNeural, cùng giọng với tour onboarding.
 * (Tour Liên kết gian hàng tái dùng public/onboarding/voice/ — không sinh ở đây.)
 *
 * Ra file public/guide-assets/voice/{kho|donhang|hoadon}/step-N.mp3.
 * LỜI THOẠI phải khớp title/desc trong lib/guide-tours.ts — sửa bước nào thì
 * sửa câu tương ứng rồi chạy lại script.
 *
 * Cần CLI edge-tts (Python): pip install edge-tts. Cùng các gotcha đã bisect ở
 * generate-onboarding-voice.js: truyền câu qua --file UTF-8 (qua --text argv
 * bị NoAudioReceived), dịch vụ flaky nên retry 4 lượt + nghỉ giữa các call.
 *
 * Chạy: node scripts/generate-guide-voice.js
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = "D:/Claude Code/frontend/public/guide-assets/voice";
const VOICE = "vi-VN-HoaiMyNeural";

const TOURS = {
  kho: [
    "Bước 1. Mở Quản lý Kho, chọn Hàng hóa. Toàn bộ sản phẩm và tồn kho nằm ở đây — một kho duy nhất cho mọi gian hàng.",
    "Bước 2. Mở tab Chờ liên kết rồi bấm Đồng bộ từ sàn. Sản phẩm của mọi gian đã kết nối được kéo về đây, kèm cả giá bán và tồn kho trên sàn.",
    "Bước 3. Bấm Tự khớp và tạo SKU toàn bộ. SKU trùng mã tự nối vào kho, phần còn lại hệ thống tạo SKU kho mới rồi nối luôn. Tồn kho ban đầu tự lấy theo số trên sàn.",
    "Bước 4. Muốn tự quyết, tick các dòng thuộc cùng một mẫu. Thanh công cụ hiện dưới đáy: chọn SKU gốc rồi bấm Liên kết, hoặc bấm Tạo SKU kho cho hàng chưa có trong kho.",
    "Bước 5. Tab Tồn kho là một nguồn số duy nhất. Cột Bán trên cho biết mỗi SKU đang nối những gian nào — đơn từ gian nào về cũng trừ chung một tồn kho.",
    "Bước 6. Bấm Cài đặt rồi gạt Tự động đồng bộ: mọi biến động kho tự đẩy tồn mới lên mọi gian. Chỉ bật khi số tồn trong Hubsell đã đúng.",
  ],
  donhang: [
    "Bước 1. Mở menu Đơn hàng. Đơn của mọi sàn gom về một chỗ — lọc theo sàn, gian hàng, và trạng thái giao.",
    "Bước 2. Đơn tự chảy về, không cần làm gì. Hệ thống tự quét đơn mới mười phút một lần, chạy cả khi bạn không mở phần mềm.",
    "Bước 3. Muốn lấy đơn ngay, sang trang Kênh bán và bấm Đồng bộ đơn trên gian hàng.",
    "Bước 4. Vào Quản lý Tài chính, chọn Cấu hình Giá vốn, rồi điền giá vốn từng sản phẩm — điều kiện để báo cáo lãi lỗ tính đúng.",
    "Bước 5. Bấm Đồng bộ đối soát để biết từng đơn thực nhận bao nhiêu sau khi sàn trừ phí. Hệ thống cũng tự chạy mỗi giờ cho cả ba sàn.",
    "Bước 6. Lợi nhuận từng đơn xem ở Lãi Lỗ Thực Hiện, dòng tiền về ngân hàng xem ở Báo cáo dòng tiền — cùng trong nhóm Quản lý Tài chính.",
  ],
  hoadon: [
    "Bước 1. Vào Hóa đơn và Thuế, chọn Kết nối và Xuất hóa đơn, rồi mở tab Cấu hình kết nối. Việc thiết lập chỉ làm một lần.",
    "Bước 2. Điền mã số thuế, tên hộ kinh doanh, địa chỉ, rồi tài khoản meInvoice của shop. Chưa có tài khoản thì bấm link Đăng ký ngay trong form.",
    "Bước 3. Bấm Test để kiểm tra kết nối. Kết nối thành công thì hệ thống tự tải ký hiệu hóa đơn từ meInvoice về cho bạn chọn.",
    "Bước 4. Chọn ký hiệu hóa đơn và thuế suất mặc định, rồi bấm Lưu cấu hình. Từ giờ xuất hóa đơn chỉ còn một cú tick.",
    "Bước 5. Tab Xuất hóa đơn liệt kê các đơn đã giao thành công. Tick những đơn cần xuất rồi bấm nút — hóa đơn được phát hành và gửi Cơ quan Thuế.",
    "Bước 6. Gạt Tự động phát hành: đơn giao thành công và đã đối soát tự ra hóa đơn. Tự động điều chỉnh khi hoàn lo nốt phần hàng trả lại.",
    "Bước 7. Trang Lịch sử và Báo cáo thuế lưu mọi hóa đơn đã phát hành — bấm Tải để lấy bản PDF đã ký.",
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (const [tour, lines] of Object.entries(TOURS)) {
    const dir = path.join(BASE, tour);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < lines.length; i++) {
      const dest = path.join(dir, `step-${i + 1}.mp3`);
      const txt = path.join(dir, `line-${i + 1}.txt`);
      fs.writeFileSync(txt, lines[i], "utf8");
      let ok = false;
      for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
        const r = spawnSync(
          "python",
          ["-m", "edge_tts", "--voice", VOICE, "--file", txt, "--write-media", dest],
          { encoding: "utf8" }
        );
        ok = r.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 5000;
        if (!ok) {
          console.warn(`  ${tour}/step-${i + 1} lượt ${attempt} hỏng, thử lại…`);
          await sleep(2000 * attempt);
        }
      }
      fs.rmSync(txt, { force: true });
      if (!ok) {
        console.error(`FAIL: ${tour}/step-${i + 1}.mp3 sinh hỏng sau 4 lượt`);
        process.exit(1);
      }
      const kb = Math.round(fs.statSync(dest).size / 1024);
      console.log(`${tour}/step-${i + 1}.mp3  ${kb} KB`);
      await sleep(1500);
    }
  }
  console.log("DONE:", BASE);
})();
