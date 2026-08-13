import { Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

/**
 * Âm phản hồi quét cho kho — 3 tiếng PHÂN BIỆT được khi không nhìn màn hình
 * (file WAV tự tổng hợp trong assets/sounds, không dùng asset ngoài):
 *   success   → "ting-ting" đi LÊN: tra thấy đơn hợp lệ / thao tác xong
 *   error     → buzz TRẦM đi xuống: mã không thấy, lỗi mạng, sàn từ chối
 *   duplicate → "boop-boop" 2 nhịp cùng tông: đơn ĐÃ xử lý rồi (quét trùng)
 *
 * Player tạo lười 1 lần rồi giữ suốt phiên app (createAudioPlayer sống ngoài
 * React) — mỗi lượt phát seekTo(0) để bấm liên tục vẫn kêu.
 */

export type ScanSound = "success" | "error" | "duplicate";

const SOURCES: Record<ScanSound, number> = {
  success: require("../../assets/sounds/scan-success.wav"),
  error: require("../../assets/sounds/scan-error.wav"),
  duplicate: require("../../assets/sounds/scan-duplicate.wav"),
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
    p.seekTo(0);
    p.play();
  } catch {
    // Âm thanh là phụ trợ — lỗi audio không được chặn luồng quét
  }
}
