import type { AuthUser } from "./api";

/**
 * CỔNG TÍNH NĂNG phía web (docs/VIDEO-DONG-HANG-THIET-KE.md mục 3).
 *
 * Máy chủ là nơi DUY NHẤT quyết ai được mở một tính năng; nó trả kết quả trong
 * `user.features` (login + /api/auth/me). Web chỉ hiển thị theo câu trả lời đó:
 * mục sidebar mờ + ổ khóa, trang tự hiện thẻ "chưa mở". Lớp chặn thật vẫn là
 * 403 FEATURE_LOCKED ở backend.
 *
 * HỎNG THÌ ĐÓNG: thiếu `features`, thiếu khóa, giá trị lạ → coi như "locked".
 */
export type FeatureKey = "packVideo";
export type FeatureState = "open" | "locked";

export function featureState(
  user: Pick<AuthUser, "features"> | null | undefined,
  key: FeatureKey
): FeatureState {
  return user?.features?.[key] === "open" ? "open" : "locked";
}
