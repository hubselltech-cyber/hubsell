import { Platform, TurboModuleRegistry } from "react-native";
import type { AuthUser } from "@/types/api";

// ============================================================
// AI ĐƯỢC QUAY VIDEO ĐÓNG HÀNG trên app (26/11/2026 — thay cờ bản thử `video-test-flag.ts` của nhánh thử).
//
// Hai điều kiện, thiếu một là ẩn mọi lối vào:
//   1. MÁY CHỦ cho phép — `features.packVideo` + `features.packVideoCaps` trong login / me: chủ shop còn hạn gói đã
//      bấm đồng ý; nhân viên của chủ đó quay theo quyền CÓ SẴN (Đơn hàng → quay đóng; Đối soát đơn hoàn → quay khui,
//      anh Trung chốt 24/11/2026 — không có ô quyền riêng). Tắt gấp ở máy chủ: PACK_VIDEO_GATE=pilot|off.
//   2. BẢN APP có phần gốc camera quay video (react-native-vision-camera + Nitro) — chỉ có từ bản dựng kho đưa thư
//      viện này vào. Mã JS của tính năng có thể tới bản app CŨ qua cập nhật từ xa; ở đó không được mở màn quay (nạp
//      thư viện là văng) → kiểm phần gốc trước, màn quay nạp MUỘN (app/pack-video.tsx).
// ============================================================

export interface PackVideoRecordCaps {
  pack: boolean;
  unbox: boolean;
}

const NONE: PackVideoRecordCaps = { pack: false, unbox: false };

let nativeChecked: boolean | null = null;

/** Bản app này có phần gốc camera quay video không. Web không có. Hỏi một lần rồi nhớ. */
export function hasPackVideoNative(): boolean {
  if (nativeChecked !== null) return nativeChecked;
  let ok = false;
  if (Platform.OS !== "web") {
    try {
      // Nitro là nền của thư viện camera; thiếu nó thì `import "react-native-vision-camera"` ném lỗi ngay lúc nạp.
      ok = TurboModuleRegistry.get("NitroModules") != null;
    } catch {
      ok = false;
    }
  }
  nativeChecked = ok;
  return ok;
}

/** Trạng thái cổng máy chủ trả cho người đang đăng nhập. Phiên cũ chưa có khối này → "locked" (hỏng thì đóng). */
export function packVideoGate(user: AuthUser | null | undefined): "open" | "consent" | "locked" {
  const gate = user?.features?.packVideo;
  return gate === "open" || gate === "consent" ? gate : "locked";
}

/** Người đang đăng nhập quay được kiểu nào TRÊN MÁY NÀY. */
export function packVideoRecordCaps(user: AuthUser | null | undefined): PackVideoRecordCaps {
  if (!hasPackVideoNative() || packVideoGate(user) !== "open") return NONE;
  const c = user?.features?.packVideoCaps;
  return { pack: c?.pack === true, unbox: c?.unbox === true };
}

/**
 * Chủ shop chưa bấm đồng ý lần đầu (máy chủ trả "consent", chưa có quyền nào) → vẫn hiện lối vào cho CHỦ để bấm
 * đồng ý ngay trên app. Nhân viên không bật thay được nên không thấy gì cho tới khi chủ bật.
 */
export function canStartPackVideoConsent(user: AuthUser | null | undefined): boolean {
  return hasPackVideoNative() && packVideoGate(user) === "consent" && user?.role === "ADMIN";
}

/** Có hiện lối vào màn quay không (đã quay được, hoặc chủ shop cần bấm đồng ý). */
export function showPackVideoEntry(user: AuthUser | null | undefined): boolean {
  const caps = packVideoRecordCaps(user);
  return caps.pack || caps.unbox || canStartPackVideoConsent(user);
}
