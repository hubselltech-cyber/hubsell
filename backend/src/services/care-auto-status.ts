// ============================================================
// CRM HQ — TỰ CHUYỂN TRẠNG THÁI CHĂM SÓC THEO THUÊ BAO
// (22/10/2026 — anh Trung: "hết dùng thử mà không gia hạn → Đã rời bỏ; đã thanh
// toán → Đang dùng ổn định; đã rời bỏ mà quay lại thanh toán → Đang dùng ổn định";
// docs/HQ-CRM-TU-CHUYEN-TRANG-THAI.md)
//
// Trước 22/10 trạng thái chăm sóc (PlatformCustomerCare.status) hoàn toàn đặt
// tay → 97 % khách nằm ở "Mới đăng ký" dù phần lớn đã hết dùng thử từ lâu, biểu
// đồ phân bố trên HQ Tổng quan không nói lên gì. Nay hai luật tự động:
//
//   1. THANH TOÁN (amount > 0, mọi đường: HQ ghi tay, Ví, payOS, Apple IAP) →
//      ACTIVE, nguồn AUTO_PAYMENT — ghi TRONG giao dịch recordPackagePaymentTx,
//      cùng lúc gia hạn thuê bao + đánh thức gian. Đổi gói 0đ / gói tặng KHÔNG
//      tính là thanh toán. Thanh toán luôn thắng (kể cả đang CHURNED → ACTIVE).
//   2. HẾT GÓI QUÁ ÂN HẠN (currentPeriodEnd < now − EXPIRED_GRACE_DAYS, cùng mốc
//      ngủ đông gian — dùng thử hay gói trả tiền đều thế) → CHURNED, nguồn
//      AUTO_EXPIRED — worker plan-hibernate mỗi 6 giờ. Trong 7 ngày ân hạn
//      trạng thái giữ nguyên để Sale còn cửa gọi.
//
// Luật ưu tiên: quyết định TAY đặt SAU khi kỳ hạn kết thúc thắng luật 2 (Sale
// đang kéo khách rời bỏ về "Đang tư vấn" thì worker không đè lại). Đã CHURNED
// thì không đụng nữa (mỗi kỳ hết hạn chỉ bắn một lần). Ghi chú + người phụ
// trách không bao giờ bị tự động sửa. Mọi lần tự chuyển ghi Nhật ký thao tác
// (action "care.auto", người thao tác = Hệ thống).
// ============================================================

import { PlatformCareStatus, PlatformCareStatusSource, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { EXPIRED_GRACE_DAYS } from "./plan-enforcement";
import { hibernationCutoff } from "./plan-hibernation";

/** Tên người thao tác ghi vào Nhật ký thao tác khi hệ thống tự chuyển. */
export const CARE_AUTO_ACTOR_NAME = "Hệ thống (tự chuyển theo thuê bao)";
export const CARE_AUTO_AUDIT_ACTION = "care.auto";

export interface CareStatusSnapshot {
  status: PlatformCareStatus;
  statusSource: PlatformCareStatusSource;
  statusChangedAt: Date;
}

// ---------- Hàm thuần (export cho vitest) ----------

/** Cột ghi khi thanh toán thành công → Đang dùng ổn định. */
export function careAutoActiveData(occurredAt: Date) {
  return {
    status: PlatformCareStatus.ACTIVE,
    statusSource: PlatformCareStatusSource.AUTO_PAYMENT,
    statusChangedAt: occurredAt,
    updatedById: null,
  } satisfies Prisma.PlatformCustomerCareUpdateManyMutationInput;
}

/** Cột ghi khi hết gói quá ân hạn → Đã rời bỏ. */
export function careAutoChurnData(now: Date) {
  return {
    status: PlatformCareStatus.CHURNED,
    statusSource: PlatformCareStatusSource.AUTO_EXPIRED,
    statusChangedAt: now,
    updatedById: null,
  } satisfies Prisma.PlatformCustomerCareUpdateManyMutationInput;
}

/**
 * Hồ sơ (null = chưa ai đụng, ngầm định NEW) có cần worker chuyển sang CHURNED
 * khi kỳ hạn `periodEnd` đã quá ân hạn không.
 */
export function shouldAutoChurn(profile: CareStatusSnapshot | null, periodEnd: Date): boolean {
  if (!profile) return true;
  if (profile.status === PlatformCareStatus.CHURNED) return false;
  // Sale đặt tay SAU khi kỳ hạn kết thúc = đang chủ động chăm khách này → giữ.
  if (
    profile.statusSource === PlatformCareStatusSource.MANUAL &&
    profile.statusChangedAt.getTime() > periodEnd.getTime()
  ) {
    return false;
  }
  return true;
}

/**
 * Thuê bao ứng viên rời bỏ: kỳ hạn kết thúc trước mốc ân hạn (cùng
 * hibernationCutoff — không lọc status thuê bao, giống ngủ đông), chủ không phải
 * tài khoản điều hành, và hồ sơ chăm sóc chưa CHURNED (hoặc chưa có). Tập này
 * tự co: mỗi chủ chỉ khớp tới khi được chuyển CHURNED; chỉ dòng Sale giữ tay
 * sau hết gói còn nằm lại (lọc tiếp bằng shouldAutoChurn trong JS).
 * Khách cũ chưa được gán thuê bao không có dòng → không bao giờ bị rời bỏ nhầm.
 */
export function careChurnCandidatesWhere(now: Date): Prisma.SubscriptionWhereInput {
  return {
    currentPeriodEnd: { lt: hibernationCutoff(now) },
    user: {
      isPlatformAdmin: false,
      OR: [{ careProfile: null }, { careProfile: { status: { not: PlatformCareStatus.CHURNED } } }],
    },
  };
}

function targetLabel(u: { fullName: string; email: string | null; id: string }): string {
  return `${u.fullName} (${u.email ?? u.id})`;
}

// ---------- Đụng DB ----------

/**
 * Thanh toán thành công → Đang dùng ổn định. Gọi TRONG giao dịch
 * recordPackagePaymentTx (sau khi upsert thuê bao) để "đã trả tiền" và "đang dùng
 * ổn định" là một sự thật. Trả true khi trạng thái thực sự đổi (ghi nhật ký).
 */
export async function markCarePaidTx(
  tx: Prisma.TransactionClient,
  userId: string,
  occurredAt: Date
): Promise<boolean> {
  const before = await tx.platformCustomerCare.findUnique({
    where: { userId },
    select: { status: true },
  });
  const data = careAutoActiveData(occurredAt);
  await tx.platformCustomerCare.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
    select: { id: true },
  });
  const changed = before?.status !== PlatformCareStatus.ACTIVE;
  if (changed) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, email: true },
    });
    await tx.platformAuditLog.create({
      data: {
        actorId: null,
        actorName: CARE_AUTO_ACTOR_NAME,
        action: CARE_AUTO_AUDIT_ACTION,
        targetUserId: userId,
        targetLabel: user ? targetLabel(user) : userId,
        detail: {
          status: PlatformCareStatus.ACTIVE,
          reason: "PAYMENT",
          from: before?.status ?? null,
          occurredAt: occurredAt.toISOString(),
        },
      },
    });
  }
  return changed;
}

export interface CareChurnRunResult {
  /** Thuê bao quá ân hạn chưa CHURNED đã đọc. */
  scanned: number;
  /** Hồ sơ chuyển sang CHURNED (tạo mới + cập nhật). */
  churned: number;
  /** Giữ nguyên vì Sale đã đặt tay sau khi hết gói. */
  keptManual: number;
}

/**
 * Một lượt worker: đọc thuê bao quá ân hạn THEO TRANG (cursor id), lọc luật ưu
 * tiên trong JS, rồi mỗi trang MỘT giao dịch: createMany hồ sơ còn thiếu +
 * updateMany hồ sơ có sẵn + nhật ký thao tác. Dây an toàn chống đua với thanh
 * toán vừa ghi giữa lúc đọc và ghi: updateMany đòi thuê bao VẪN quá ân hạn;
 * createMany skipDuplicates nên hồ sơ thanh toán vừa tạo không bị đè.
 * Idempotent: chạy lặp vô hại.
 */
export async function churnExpiredOwners(
  now: Date = new Date(),
  pageSize = 200
): Promise<CareChurnRunResult> {
  const where = careChurnCandidatesWhere(now);
  const cutoff = hibernationCutoff(now);
  const result: CareChurnRunResult = { scanned: 0, churned: 0, keptManual: 0 };
  let cursor: string | undefined;

  for (;;) {
    // Phân trang bằng `id > cursor` trong WHERE, KHÔNG dùng cursor + skip 1 của
    // Prisma: tập ứng viên TỰ CO (dòng vừa chuyển CHURNED rơi khỏi điều kiện lọc)
    // nên dòng cursor không còn khớp → skip 1 sẽ bỏ qua một ứng viên thật mỗi trang
    // (bắt được 22/10 ở care-auto-status-db.test pageSize nhỏ).
    const page = await prisma.subscription.findMany({
      where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
      select: {
        id: true,
        userId: true,
        currentPeriodEnd: true,
        isTrial: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            careProfile: { select: { status: true, statusSource: true, statusChangedAt: true } },
          },
        },
      },
      orderBy: { id: "asc" },
      take: pageSize,
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1]!.id;
    result.scanned += page.length;

    const toCreate: typeof page = [];
    const toUpdate: typeof page = [];
    for (const s of page) {
      if (!shouldAutoChurn(s.user.careProfile, s.currentPeriodEnd!)) {
        result.keptManual += 1;
        continue;
      }
      (s.user.careProfile ? toUpdate : toCreate).push(s);
    }

    if (toCreate.length + toUpdate.length > 0) {
      const data = careAutoChurnData(now);
      const [created, updated] = await prisma.$transaction(async (tx) => {
        const c = toCreate.length
          ? await tx.platformCustomerCare.createMany({
              data: toCreate.map((s) => ({ userId: s.userId, ...data })),
              skipDuplicates: true,
            })
          : { count: 0 };
        const u = toUpdate.length
          ? await tx.platformCustomerCare.updateMany({
              where: {
                userId: { in: toUpdate.map((s) => s.userId) },
                status: { not: PlatformCareStatus.CHURNED },
                user: { subscription: { currentPeriodEnd: { lt: cutoff } } },
              },
              data,
            })
          : { count: 0 };
        await tx.platformAuditLog.createMany({
          data: [...toCreate, ...toUpdate].map((s) => ({
            actorId: null,
            actorName: CARE_AUTO_ACTOR_NAME,
            action: CARE_AUTO_AUDIT_ACTION,
            targetUserId: s.userId,
            targetLabel: targetLabel(s.user),
            detail: {
              status: PlatformCareStatus.CHURNED,
              reason: "EXPIRED",
              from: s.user.careProfile?.status ?? null,
              isTrial: s.isTrial,
              periodEnd: s.currentPeriodEnd!.toISOString(),
              graceDays: EXPIRED_GRACE_DAYS,
            },
          })),
        });
        return [c.count, u.count];
      });
      result.churned += created + updated;
    }

    if (page.length < pageSize) break;
  }
  return result;
}
