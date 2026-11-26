import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { resumeUploads, setUploadOwner } from "@/lib/pack-video-upload";

/**
 * VIDEO ĐÓNG HÀNG — thẻ RỖNG đặt ở gốc app (anh Trung 20/11: "làm hàng chờ"; lên bản app thật 26/11/2026).
 *
 * Video quay xong mà chưa lên hệ thống (mất mạng, tắt app, máy hết pin) nằm trong sổ hàng chờ trên máy
 * (`lib/pack-video-upload.ts`). Thẻ này cho hàng chờ biết AI đang đăng nhập và bảo nó gửi tiếp:
 *   · lúc app mở lên và phiên đăng nhập đã rõ,
 *   · mỗi lần app trở lại màn hình.
 * Đặt ở gốc để khách KHÔNG phải mở lại màn quay thì video mới lên (cùng ý với thẻ `PackVideoQueueResume` của web).
 * Clip chỉ được gửi bằng đúng tài khoản đã quay.
 */
export function PackVideoQueueResume() {
  const { status, user } = useAuth();
  // Phiên đăng nhập còn đang nạp thì chưa biết là ai — chưa đụng hàng chờ.
  const ownerId = status === "loading" ? undefined : (user?.id ?? null);

  useEffect(() => {
    if (ownerId === undefined) return;
    setUploadOwner(ownerId);
  }, [ownerId]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") resumeUploads();
    });
    return () => sub.remove();
  }, []);

  return null;
}
