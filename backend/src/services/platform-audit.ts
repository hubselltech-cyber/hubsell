import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";

/**
 * NHẬT KÝ THAO TÁC KHU ĐIỀU HÀNH (PlatformAuditLog) — ghi mọi thao tác GHI
 * của khu /admin và thao tác nhân sự của chủ nền tảng: ai làm, làm gì, trên
 * đối tượng nào. Sổ append-only, chỉ chủ nền tảng đọc (GET /api/admin/audit-logs).
 *
 * Ghi log KHÔNG được làm hỏng nghiệp vụ chính: lỗi ghi chỉ console.error —
 * nghiệp vụ đã commit xong mới gọi hàm này, rollback vì log là phạt oan người dùng.
 */
export async function writeAuditLog(
  req: AuthRequest,
  entry: {
    /** Mã hành động phẳng: "care.update", "withdrawal.approve", "staff.create"… */
    action: string;
    targetUserId?: string | null;
    /** Nhãn snapshot của đối tượng (email/tên/loginName) — log còn đọc được sau khi đối tượng bị xoá. */
    targetLabel?: string | null;
    detail?: Prisma.InputJsonValue;
  }
): Promise<void> {
  try {
    const actor = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { fullName: true, email: true, staffUsername: true },
    });
    await prisma.platformAuditLog.create({
      data: {
        actorId: req.userId!,
        actorName: actor
          ? `${actor.fullName}${actor.staffUsername ? ` (${actor.staffUsername})` : actor.email ? ` (${actor.email})` : ""}`
          : "(không rõ)",
        action: entry.action,
        targetUserId: entry.targetUserId ?? null,
        targetLabel: entry.targetLabel ?? null,
        ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
      },
    });
  } catch (err) {
    console.error("[platform-audit] Không ghi được nhật ký thao tác:", err);
  }
}
