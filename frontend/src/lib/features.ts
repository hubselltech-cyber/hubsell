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
/** "consent" = tính năng đã mở cho tài khoản này, còn chờ chủ shop bấm đồng ý lần đầu (chưa gọi API nào). */
export type FeatureState = "open" | "locked" | "consent";

export function featureState(
  user: Pick<AuthUser, "features"> | null | undefined,
  key: FeatureKey
): FeatureState {
  const v = user?.features?.[key];
  return v === "open" || v === "consent" ? v : "locked";
}

/**
 * Người đang đăng nhập được làm gì với Video đóng hàng (máy chủ quyết, `features.packVideoCaps`):
 *  · pack   — quay video đóng hàng (chủ, hoặc nhân viên có quyền Đơn hàng);
 *  · unbox  — quay video khui hàng hoàn (chủ, hoặc nhân viên có quyền Đối soát đơn hoàn);
 *  · manage — việc của CHỦ: tải video về, tab Đơn hoàn, Thống kê, sổ giờ có tiền, mua giờ.
 * Nhân viên quay được thì XEM được danh sách video (không tải về) và thấy số giờ còn lại.
 * HỎNG THÌ ĐÓNG: cổng không mở / thiếu khối → cả ba false.
 */
export interface PackVideoCaps {
  pack: boolean;
  unbox: boolean;
  manage: boolean;
}

export function packVideoCapsOf(user: Pick<AuthUser, "features"> | null | undefined): PackVideoCaps {
  if (featureState(user, "packVideo") !== "open") return { pack: false, unbox: false, manage: false };
  const c = user?.features?.packVideoCaps;
  return { pack: c?.pack === true, unbox: c?.unbox === true, manage: c?.manage === true };
}
