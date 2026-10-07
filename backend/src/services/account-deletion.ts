// ============================================================
// TỰ XÓA TÀI KHOẢN TRONG APP (06/10/2026)
//
// Apple từ chối bản iOS 1.0 theo 5.1.1(v): app có đăng ký thì phải có cách xóa
// tài khoản NGAY TRONG APP, không được chỉ dẫn gửi email. Google Data safety
// cũng khai đường xóa này.
//
// Cách làm: XÓA MỀM + ẨN DANH NGAY. Lúc người dùng bấm, mọi thông tin cá nhân
// (email, username, SĐT, họ tên, ảnh, mật khẩu, liên kết Google, token reset)
// bị xóa khỏi dòng User và đặt deletedAt → không đăng nhập lại được, token
// đang cầm bị requireAuth từ chối. Dữ liệu nghiệp vụ (đơn hàng, hóa đơn, sổ
// quỹ) giữ lại theo nghĩa vụ kế toán, rồi scripts/purge-deleted-accounts.ts
// xóa cứng sau 30 ngày — khớp lời hứa ở hubsell.vn/privacy + /xoa-tai-khoan.
//
// Chủ shop xóa → toàn bộ nhân viên của shop cũng bị ẩn danh + khóa (họ không
// còn chỗ để đăng nhập vào), gian hàng chuyển DISCONNECTED để worker ngừng
// đồng bộ, thuê bao chuyển CANCELLED. Nhân viên xóa → chỉ chính họ.
// ============================================================
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../lib/prisma";

/** Họ tên thay thế sau khi ẩn danh — nhật ký kho/đơn còn tên người làm thì hiện chữ này. */
export const DELETED_USER_NAME = "Tài khoản đã xóa";

/** Dữ liệu ghi đè lên dòng User lúc ẩn danh — thuần, test được. */
export function anonymizedUserData(now: Date) {
  return {
    email: null,
    username: null,
    staffUsername: null,
    phone: null,
    fullName: DELETED_USER_NAME,
    avatar: null,
    googleId: null,
    // Hash của một chuỗi ngẫu nhiên không ai biết → không mật khẩu nào khớp.
    passwordHash: bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 4),
    resetTokenHash: null,
    resetTokenExpiresAt: null,
    permissions: [] as string[],
    billingName: null,
    billingTaxCode: null,
    billingAddress: null,
    billingEmail: null,
    billingPhone: null,
    billingIdNumber: null,
    deletedAt: now,
  };
}

export type DeleteAccountResult =
  | { ok: true; removedUsers: number }
  | { ok: false; status: 401 | 404; error: string };

/**
 * Xóa tài khoản của CHÍNH người đang đăng nhập, đòi mật khẩu hiện tại để
 * chống người khác cầm máy mở khóa bấm nhầm.
 */
export async function deleteOwnAccount(
  userId: string,
  password: string
): Promise<DeleteAccountResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, ownerId: true, passwordHash: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    return { ok: false, status: 404, error: "Tài khoản không còn tồn tại" };
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    return { ok: false, status: 401, error: "Mật khẩu không đúng" };
  }

  const now = new Date();
  const isOwner = user.ownerId === null;

  const removedUsers = await prisma.$transaction(async (tx) => {
    // Chủ shop: ẩn danh cả nhân viên (ownerId = user.id) lẫn chính mình.
    const where = isOwner
      ? { OR: [{ id: user.id }, { ownerId: user.id }] }
      : { id: user.id };
    const targets = await tx.user.findMany({ where, select: { id: true } });
    // Ẩn danh từng dòng (passwordHash ngẫu nhiên riêng từng người).
    for (const t of targets) {
      await tx.user.update({ where: { id: t.id }, data: anonymizedUserData(now) });
    }
    if (isOwner) {
      await tx.channel.updateMany({
        where: { userId: user.id, status: { not: "DISCONNECTED" } },
        data: { status: "DISCONNECTED", disconnectedAt: now },
      });
      await tx.subscription.updateMany({
        where: { userId: user.id, status: "ACTIVE" },
        data: { status: "CANCELLED" },
      });
    }
    return targets.length;
  });

  return { ok: true, removedUsers };
}
