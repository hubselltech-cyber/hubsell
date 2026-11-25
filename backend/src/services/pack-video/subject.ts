// ============================================================
// VIDEO ĐÓNG HÀNG — dựng "chủ thể" cho cổng (access.ts) từ người đang đăng nhập.
//
// Cổng mở theo email của CHỦ SHOP (24/11/2026: nhân viên của chủ đã mở được quay). Nhân viên đăng nhập bằng
// email của chính họ → phải tra email chủ: một câu theo khóa chính, chỉ chạy khi người gọi là NHÂN VIÊN, kèm
// đệm 60 giây trong máy (upload một video ≈ 4 lượt gọi). Đệm chỉ là lối tắt — sai cùng lắm 60 giây sau khi chủ
// đổi email; quyền của nhân viên (permissions) KHÔNG đệm, luôn đọc tươi trong requireAuth.
// ============================================================

import { prisma } from "../../lib/prisma";
import { getOwnerPlanState } from "../plan-enforcement";
import { capsAccess, featuresOf, packVideoCaps, type PackVideoCaps, type UserFeatures } from "./access";
import { ownerPackVideoConsented } from "./consent";

const OWNER_EMAIL_TTL_MS = 60_000;
const OWNER_EMAIL_CACHE_MAX = 20_000;
const ownerEmailCache = new Map<string, { email: string | null; at: number }>();

/** Chỉ cho test: quên đệm. */
export function forgetOwnerEmails(): void {
  ownerEmailCache.clear();
}

export async function ownerEmailOf(ownerId: string): Promise<string | null> {
  const hit = ownerEmailCache.get(ownerId);
  if (hit && Date.now() - hit.at < OWNER_EMAIL_TTL_MS) return hit.email;
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { email: true, deletedAt: true } });
  const email = owner && !owner.deletedAt ? owner.email : null;
  if (ownerEmailCache.size >= OWNER_EMAIL_CACHE_MAX) ownerEmailCache.clear();
  ownerEmailCache.set(ownerId, { email, at: Date.now() });
  return email;
}

export interface LoggedInUser {
  id: string;
  email: string | null;
  /** null = chủ tài khoản; có giá trị (khác id) = nhân viên của chủ đó. */
  ownerId: string | null;
  permissions?: readonly string[] | null;
}

function staffOwnerOf(user: LoggedInUser): string | null {
  return user.ownerId && user.ownerId !== user.id ? user.ownerId : null;
}

/**
 * Gói của chủ shop còn dùng được không — cùng nguồn với việc khóa các tính năng nâng cao (plan-enforcement.ts, đệm 60
 * giây): chỉ đóng khi gói HẾT HẠN quá ân hạn. Dùng thử, đang ân hạn, tài khoản cũ chưa có thuê bao đều tính là còn.
 */
export async function ownerPlanActive(ownerId: string): Promise<boolean> {
  return !(await getOwnerPlanState(ownerId)).expiry.locked;
}

export interface PackVideoGateResult {
  caps: PackVideoCaps;
  /** Cổng mở nhưng chủ shop chưa đồng ý lần đầu (consent.ts). Luôn false khi cổng khóa. */
  needsConsent: boolean;
}

/** Cổng cho MỘT lượt gọi API: quyền thao tác + có còn chờ chủ shop đồng ý không. */
export async function gateForUser(user: LoggedInUser): Promise<PackVideoGateResult> {
  const staffOwner = staffOwnerOf(user);
  const ownerId = staffOwner ?? user.id;
  const ownerEmail = staffOwner ? await ownerEmailOf(staffOwner) : user.email;
  const caps = packVideoCaps({
    ownerEmail,
    isStaff: staffOwner !== null,
    permissions: user.permissions,
    ownerPlanActive: await ownerPlanActive(ownerId),
  });
  if (capsAccess(caps) !== "open") return { caps, needsConsent: false };
  return { caps, needsConsent: !(await ownerPackVideoConsented(ownerId, ownerEmail)) };
}

export async function capsForUser(user: LoggedInUser): Promise<PackVideoCaps> {
  return (await gateForUser(user)).caps;
}

/**
 * Khối `features` cho /api/auth (login, /me, …). Tra email chủ hỏng (database trục trặc) → coi như khóa,
 * không làm hỏng đăng nhập.
 */
export async function userFeatures(user: LoggedInUser): Promise<UserFeatures> {
  const staffOwner = staffOwnerOf(user);
  const ownerId = staffOwner ?? user.id;
  let ownerEmail: string | null = user.email;
  let planActive = false;
  let consented = false;
  try {
    if (staffOwner) ownerEmail = await ownerEmailOf(staffOwner);
    planActive = await ownerPlanActive(ownerId);
    consented = await ownerPackVideoConsented(ownerId, ownerEmail);
  } catch (err) {
    // Hỏng thì đóng: không làm hỏng đăng nhập, tính năng coi như khóa cho tới lượt /me sau.
    console.error("[pack-video] tra cổng tính năng hỏng:", err instanceof Error ? err.message : err);
    if (staffOwner) ownerEmail = null;
    planActive = false;
  }
  return featuresOf(
    { ownerEmail, isStaff: staffOwner !== null, permissions: user.permissions, ownerPlanActive: planActive },
    { consented }
  );
}
