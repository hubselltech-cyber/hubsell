// ============================================================
// NGỦ ĐÔNG GIAN HÀNG CỦA CHỦ SHOP HẾT GÓI QUÁ ÂN HẠN
// (15/10/2026 — anh Trung chốt: "hết gói rồi quá 7 ngày ân hạn thì ngừng luôn
// việc cập nhật đơn hàng, tốn hạ tầng mà chẳng được gì";
// docs/GOI-NGU-DONG-GIAN-HET-HAN.md)
//
// Trước 15/10: luật 22/08 ở plan-enforcement.ts là "đơn + tồn kho KHÔNG BAO GIỜ
// ngắt đồng bộ", chỉ khóa tầng giá trị gia tăng. Gói mặc định là dùng thử 14
// ngày nên phần lớn gian hết hạn là người thử rồi bỏ: mỗi gian vẫn tốn tầng
// nhanh (tới 60'), tầng giờ đối soát, webhook ghi đơn, đẩy tồn, ghi sổ cái.
// Ở mốc 50.000 khách thì gian "ma" có thể nhiều hơn gian trả tiền.
//
// Nay: chủ shop hết gói quá EXPIRED_GRACE_DAYS (cùng mốc khóa tầng giá trị
// gia tăng, lý do EXPIRED — vượt trần đơn KHÔNG ngủ đông) → mọi gian sàn của
// chủ đó được đặt Channel.hibernatedAt:
//   · worker quét đơn / đối soát / ads / đối soát tồn / đẩy tồn BỎ QUA gian;
//   · webhook sàn: vẫn trả 200 (sàn tắt push nếu mình trả lỗi) nhưng bộ xử lý
//     việc bỏ qua, không ghi đơn;
//   · CHỈ worker làm mới token còn chạy — refresh token Shopee sống 30 ngày,
//     không xoay thì khách quay lại phải ủy quyền lại từng gian.
// Lúc đặt cờ, mọi next*SyncAt đẩy về 2100 để gian rơi khỏi vùng quét của chỉ
// mục (status, next*At): hàng nghìn gian ngủ đông không bị đọc lại mỗi tick 20s.
//
// ĐÁNH THỨC: mọi đường ghi kỳ hạn mới (recordPackagePaymentTx — payOS, Ví,
// Apple IAP, HQ ghi tay) xóa cờ + kéo hạn về ngay trong CÙNG giao dịch. Mốc
// nước (ordersWatermarkAt, lát 3.2) KHÔNG đụng: lượt quét đầu sau khi thức đọc
// từ mốc cũ, tự chia cửa sổ 15 ngày, trần WATERMARK_FLOOR_DAYS (90 ngày — số
// tự chọn, trùng trần nạp lịch sử gian mới). Ngủ lâu hơn thì phần cũ hơn coi
// như nối mới; đối soát phí thật chỉ vét SETTLE_DAYS_BACK ngày (hạn chế đã biết).
//
// KHÔNG xóa gì của khách — cam kết "không xóa dữ liệu" với Bộ Công Thương
// (docs/THONG-BAO-BO-CONG-THUONG.md khoản 16) giữ nguyên.
// Đường lui: env PLAN_HIBERNATE_OFF=1 tắt worker đặt cờ (đánh thức vẫn chạy).
// ============================================================

import { ChannelName, type Prisma } from "@prisma/client";
import type { Response } from "express";
import { prisma } from "../lib/prisma";
import { EXPIRED_GRACE_DAYS } from "./plan-enforcement";
import { WATERMARK_FLOOR_DAYS } from "./order-watermark";
import { notify } from "./notifications";

/** Gian sàn thật — gian OFFLINE/mock không có gì để quét nên không đụng. */
export const HIBERNATE_SYNC_CHANNELS = [ChannelName.SHOPEE, ChannelName.LAZADA, ChannelName.TIKTOK] as const;

/** Mốc "không bao giờ": đẩy next*SyncAt tới đây để rơi khỏi vùng quét của chỉ mục. */
export const HIBERNATE_FAR_FUTURE = new Date("2100-01-01T00:00:00.000Z");

/** Khách gia hạn thì tự vét bù tối đa bấy nhiêu ngày (trần mốc nước, lát 3.2). */
export const WAKE_CATCHUP_MAX_DAYS = WATERMARK_FLOOR_DAYS;

/** Ghi chú trả về cho hàng đợi webhook: việc xong, không thử lại. */
export const HIBERNATED_SKIP_NOTE = "gian đang ngủ đông (gói hết hạn quá ân hạn) — không đồng bộ";

const DAY_MS = 86_400_000;

// ---------- Hàm thuần (export cho vitest) ----------

/** Kỳ hạn kết thúc TRƯỚC mốc này là đã quá ân hạn → ngủ đông. */
export function hibernationCutoff(now: Date, graceDays: number = EXPIRED_GRACE_DAYS): Date {
  return new Date(now.getTime() - graceDays * DAY_MS);
}

export function isHibernated(ch: { hibernatedAt: Date | null } | null | undefined): boolean {
  return !!ch?.hibernatedAt;
}

/** Câu báo cho nút Đồng bộ tay / API khi gian đang ngủ đông. */
export const HIBERNATED_HTTP_MESSAGE =
  "Gói dịch vụ đã hết hạn quá ân hạn nên gian này đang tạm ngừng đồng bộ. Gia hạn gói là nối lại ngay và tự kéo bù đơn phát sinh trong lúc tạm ngừng.";

/** Gian ngủ đông → trả 403 PLAN_LOCKED/EXPIRED (cùng mã với requirePlanUnlocked) và báo true; thức → false. */
export function respondHibernated(res: Response, ch: { hibernatedAt: Date | null }): boolean {
  if (!isHibernated(ch)) return false;
  res.status(403).json({ error: HIBERNATED_HTTP_MESSAGE, code: "PLAN_LOCKED", reason: "EXPIRED" });
  return true;
}

/** Cột ghi khi đặt cờ ngủ đông cho một gian. */
export function hibernateChannelData(now: Date) {
  return {
    hibernatedAt: now,
    nextFastSyncAt: HIBERNATE_FAR_FUTURE,
    nextHourlySyncAt: HIBERNATE_FAR_FUTURE,
    nextAdsSyncAt: HIBERNATE_FAR_FUTURE,
    nextAdsPulseAt: HIBERNATE_FAR_FUTURE,
  } satisfies Prisma.ChannelUpdateManyMutationInput;
}

/** Cột ghi khi đánh thức: xóa cờ, mọi tầng đến hạn ngay, nhịp về gốc. Mốc nước giữ nguyên. */
export function wakeChannelData(now: Date) {
  return {
    hibernatedAt: null,
    nextFastSyncAt: now,
    nextHourlySyncAt: now,
    nextAdsSyncAt: now,
    nextAdsPulseAt: now,
    syncBackoffLevel: 0,
  } satisfies Prisma.ChannelUpdateManyMutationInput;
}

/** Gian còn thức của một (hoặc nhiều) chủ shop — cùng điều kiện cho cả đếm lẫn đặt cờ. */
export function awakeChannelsWhere(ownerIds: string[]): Prisma.ChannelWhereInput {
  return {
    userId: { in: ownerIds },
    status: "ACTIVE",
    hibernatedAt: null,
    channelName: { in: [...HIBERNATE_SYNC_CHANNELS] },
  };
}

/**
 * Thuê bao cần ngủ đông: kỳ hạn kết thúc trước mốc ân hạn (ACTIVE hết hạn, EXPIRED,
 * hay CANCELLED có kỳ hạn — cùng cách suy `expired` của getOwnerPlanState), chủ
 * không phải tài khoản điều hành nền tảng, và còn ít nhất một gian sàn đang thức.
 * Khách cũ chưa được gán thuê bao không có dòng → không bao giờ bị ngủ đông nhầm.
 */
export function hibernationCandidatesWhere(now: Date): Prisma.SubscriptionWhereInput {
  return {
    currentPeriodEnd: { lt: hibernationCutoff(now) },
    user: {
      isPlatformAdmin: false,
      channels: {
        some: { status: "ACTIVE", hibernatedAt: null, channelName: { in: [...HIBERNATE_SYNC_CHANNELS] } },
      },
    },
  };
}

// ---------- Đụng DB ----------

export interface HibernationRunResult {
  owners: number;
  channels: number;
}

/**
 * Một lượt: đọc thuê bao quá ân hạn THEO TRANG (cursor id), mỗi trang MỘT câu
 * UPDATE đặt cờ cho mọi gian của các chủ trong trang + một chuông cho mỗi chủ.
 * Idempotent: gian đã có cờ không khớp điều kiện nên chạy lặp vô hại; chủ vừa
 * gia hạn có currentPeriodEnd tương lai nên không bị đặt lại.
 */
export async function hibernateExpiredOwners(now: Date = new Date(), pageSize = 200): Promise<HibernationRunResult> {
  const where = hibernationCandidatesWhere(now);
  let cursor: string | undefined;
  let owners = 0;
  let channels = 0;

  for (;;) {
    // `id > cursor` trong WHERE, KHÔNG dùng cursor + skip 1 của Prisma: sau UPDATE,
    // thuê bao của trang trước hết "còn gian thức" → rơi khỏi điều kiện lọc → dòng
    // cursor không khớp nữa và skip 1 bỏ sót một chủ thật mỗi trang (lượt sau mới
    // nhặt lại). Bắt được 22/10 ở care-auto-status (cùng kiểu tập tự co).
    const page = await prisma.subscription.findMany({
      where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
      select: { id: true, userId: true, plan: { select: { name: true } } },
      orderBy: { id: "asc" },
      take: pageSize,
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1]!.id;

    const ownerIds = page.map((s) => s.userId);
    const r = await prisma.channel.updateMany({
      where: awakeChannelsWhere(ownerIds),
      data: hibernateChannelData(now),
    });
    channels += r.count;
    owners += page.length;

    // Chuông cho chủ shop (title cố định theo gói → notify() tự khử trùng 24h).
    await Promise.allSettled(
      page.map((s) =>
        notify(s.userId, {
          type: "plan_expiry",
          title: `Đồng bộ đơn hàng và tồn kho đã tạm ngừng — gói ${s.plan.name} hết hạn quá ${EXPIRED_GRACE_DAYS} ngày`,
          body: `Gia hạn là nối lại ngay và tự kéo bù đơn phát sinh trong lúc tạm ngừng (tối đa ${WAKE_CATCHUP_MAX_DAYS} ngày). Dữ liệu cũ giữ nguyên, không mất gì.`,
          link: "/settings/plan",
        })
      )
    );

    if (page.length < pageSize) break;
  }
  return { owners, channels };
}

/**
 * Đánh thức mọi gian ngủ đông của một chủ shop — gọi TRONG giao dịch ghi kỳ hạn
 * mới (recordPackagePaymentTx) để "trả tiền xong là quét lại" là một sự thật
 * duy nhất. Trả số gian đã thức (0 = chủ này không có gian nào ngủ).
 */
export async function wakeHibernatedChannelsTx(
  tx: Prisma.TransactionClient,
  ownerId: string,
  now: Date = new Date()
): Promise<number> {
  const r = await tx.channel.updateMany({
    where: { userId: ownerId, hibernatedAt: { not: null } },
    data: wakeChannelData(now),
  });
  if (r.count > 0) {
    console.log(`[plan-hibernation] Chủ ${ownerId} gia hạn → đánh thức ${r.count} gian, quét lại ngay (vét bù tối đa ${WAKE_CATCHUP_MAX_DAYS} ngày)`);
  }
  return r.count;
}
