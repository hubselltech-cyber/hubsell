import { Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

/**
 * Âm phản hồi quét cho kho — 3 tiếng PHÂN BIỆT được khi không nhìn màn hình
 * (file WAV tự tổng hợp trong assets/sounds, không dùng asset ngoài):
 *   success   → "ting-ting" đi LÊN: tra thấy đơn hợp lệ / thao tác xong
 *   error     → buzz TRẦM đi xuống: mã không thấy, lỗi mạng, sàn từ chối
 *   duplicate → "boop-boop" 2 nhịp cùng tông: đơn ĐÃ xử lý rồi (quét trùng)
 *   cancelled → còi HAI TÔNG cao–thấp lặp 3 lần, ~1 giây: ĐƠN ĐÃ HỦY ở màn Quét đóng
 *               gói — bỏ kiện lại (05/11/2026; tạo bằng scripts/gen-scan-cancelled-sound.mjs)
 *
 * Player tạo lười 1 lần rồi giữ suốt phiên app (createAudioPlayer sống ngoài
 * React) — mỗi lượt phát CHỜ seekTo(0) xong rồi mới play() để bấm liên tục vẫn kêu.
 */

export type ScanSound = "success" | "error" | "duplicate" | "cancelled";

const SOURCES: Record<ScanSound, number> = {
  success: require("../../assets/sounds/scan-success.wav"),
  error: require("../../assets/sounds/scan-error.wav"),
  duplicate: require("../../assets/sounds/scan-duplicate.wav"),
  cancelled: require("../../assets/sounds/scan-cancelled.wav"),
};

const players: Partial<Record<ScanSound, AudioPlayer>> = {};
let audioModeReady = false;

export function playScanSound(kind: ScanSound) {
  // Web-sim: expo-audio native — bỏ qua cho giả lập trình duyệt khỏi vỡ
  if (Platform.OS === "web") return;
  try {
    if (!audioModeReady) {
      audioModeReady = true;
      // Kho quét hàng cả ca, iPhone thường gạt im lặng — vẫn phải kêu
      void setAudioModeAsync({ playsInSilentMode: true });
    }
    let p = players[kind];
    if (!p) {
      p = createAudioPlayer(SOURCES[kind]);
      p.volume = 1;
      players[kind] = p;
    }
    // seekTo là BẤT ĐỒNG BỘ trên iPhone: gọi play() ngay sau seekTo(0) thì lượt phát thứ hai rơi vào lúc player
    // còn đứng ở CUỐI tệp → "phát" xong tức thì, không ra tiếng; lượt thứ ba tua xong rồi nên lại kêu → nhạc nhảy
    // cóc tem 1 có / tem 2 mất / tem 3 có (anh Trung thử màn quay video 18/11). Phải chờ tua xong rồi mới phát.
    const player = p;
    player
      .seekTo(0)
      .then(() => player.play())
      .catch(() => {
        try {
          player.play();
        } catch {
          // bỏ qua
        }
      });
  } catch {
    // Âm thanh là phụ trợ — lỗi audio không được chặn luồng quét
  }
}
