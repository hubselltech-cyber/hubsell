/**
 * Sinh 8 file MP3 thuyết minh cho tour onboarding (onboarding-overlay.tsx)
 * bằng giọng NỮ tiếng Việt vi-VN-HoaiMyNeural (Microsoft Edge neural TTS —
 * giọng nữ phổ biến, anh Trung chốt 25/08 sau khi Web Speech đọc ngọng trên
 * máy thiếu giọng Việt).
 *
 * File tĩnh đóng gói vào public/onboarding/voice/step-N.mp3 → mọi máy nghe
 * MỘT giọng như nhau, không phụ thuộc trình duyệt. LỜI THOẠI phải khớp nội
 * dung TOUR_STEPS — sửa bước nào thì sửa câu tương ứng rồi chạy lại script.
 *
 * Cần CLI edge-tts (Python): pip install edge-tts
 * (npm msedge-tts 2.0.7 đã thử nhưng chết "no turn.end received" — endpoint
 * Microsoft đổi token, bản Python được vá đều đặn nên tin cậy hơn.)
 *
 * Chạy: node scripts/generate-onboarding-voice.js
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const OUT = "D:/Claude Code/Hubsell/frontend/public/onboarding/voice";
const VOICE = "vi-VN-HoaiMyNeural";

const LINES = [
  "Bước 1. Mở menu Kênh bán ở thanh điều hướng bên trái. Đây là trung tâm quản lý mọi gian hàng của bạn.",
  "Bước 2. Bấm nút Kết nối gian hàng ở góc phải phía trên. Một sàn có thể kết nối nhiều gian hàng khác nhau.",
  "Bước 3. Chọn sàn bạn đang bán trong ô Sàn thương mại: Shopee, Lazada, hay TikTok Shop.",
  "Bước 4. Bấm Tiếp tục với Shopee. Bạn sẽ được chuyển sang trang của Shopee để đăng nhập và cho phép Hubsell truy cập gian hàng.",
  "Bước 5. Trên trang đăng nhập chính chủ của Shopee, chọn khu vực Việt Nam ở ô đầu tiên.",
  "Bước 6. Điền tên đăng nhập và mật khẩu Shopee của shop, rồi bấm Đăng Nhập. Bạn nhập trực tiếp trên trang Shopee, Hubsell không nhìn thấy mật khẩu của bạn.",
  "Bước 7. Shopee liệt kê các quyền cần cấp cho Hubsell. Bấm Confirm Authorization để hoàn tất kết nối.",
  "Bước 8. Xong rồi! Đơn hàng sẽ tự động đồng bộ về Hubsell. Muốn kéo về ngay, bấm Đồng bộ đơn trên gian hàng vừa kết nối.",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (let i = 0; i < LINES.length; i++) {
    const dest = path.join(OUT, `step-${i + 1}.mp3`);
    let ok = false;
    // Dịch vụ hay nhả NoAudioReceived thoáng qua khi gọi dồn dập → retry + nghỉ.
    // Truyền câu qua FILE UTF-8 thay vì --text: vài câu tiếng Việt truyền qua
    // argument bị NoAudioReceived ổn định (lỗi encoding tầng argv), qua --file
    // thì chạy — đã bisect 25/08.
    const txt = path.join(OUT, `line-${i + 1}.txt`);
    fs.writeFileSync(txt, LINES[i], "utf8");
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      // python -m edge_tts: chạy được cả khi Scripts/ của Python không trong PATH
      const r = spawnSync(
        "python",
        ["-m", "edge_tts", "--voice", VOICE, "--file", txt, "--write-media", dest],
        { encoding: "utf8" }
      );
      ok = r.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 5000;
      if (!ok) {
        console.warn(`  step-${i + 1} lượt ${attempt} hỏng, thử lại…`);
        await sleep(2000 * attempt);
      }
    }
    fs.rmSync(txt, { force: true });
    if (!ok) {
      console.error(`FAIL: step-${i + 1}.mp3 sinh hỏng sau 4 lượt`);
      process.exit(1);
    }
    const kb = Math.round(fs.statSync(dest).size / 1024);
    console.log(`step-${i + 1}.mp3  ${kb} KB  — ${LINES[i].slice(0, 50)}…`);
    await sleep(1500);
  }
  console.log("DONE:", OUT);
})();
