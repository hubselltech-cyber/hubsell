// ============================================================
// THƯ THÔNG BÁO TÍNH NĂNG TỚI MỌI CHỦ SHOP — phần dùng chung của
// scripts/feature-announce-once.ts (chạy tay) và workers/feature-announce-drip.ts
// (worker tự gửi mỗi ngày một lô, anh Trung 06/11/2026).
//
// Ai nhận: CHỦ SHOP (ownerId null) có email, không phải quản trị nền tảng, chưa
// tự xóa tài khoản. KHÔNG xét gói / hết hạn / ngủ đông → khách đã rời bỏ vẫn nhận
// (anh dặn 06/11). Tài khoản tự xóa có email = null nên không còn địa chỉ để gửi.
// Nhân viên không nhận. Bỏ email nội bộ / demo / test.
//
// CHỐNG TRÙNG: vé onboarding_reminders kind "feature-<tên>" (unique chủ shop + kind)
// → chạy lại bao nhiêu lần cũng không ai nhận hai thư; gửi hỏng thì nhả vé.
//
// ZOHO: Zoho Mail Lite chặn cả hộp gửi khi gửi dồn (29/10: ~200 thư / 5 luồng;
// 06/11: 51 thư dù 1 luồng, nghỉ 3 giây). Vì vậy: 1 luồng, nghỉ giữa thư, và DỪNG
// NGAY ở thư lỗi đầu tiên — Zoho đã chặn thì gửi tiếp chỉ làm hỏng thêm thư hệ thống.
// ============================================================

import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { sendFeatureMobileAppMail } from "./customer-mails";

export interface AnnounceFeature {
  kind: string;
  send: (to: string, fullName: string) => Promise<boolean>;
}

export const ANNOUNCE_FEATURES: Record<string, AnnounceFeature> = {
  // 06/11/2026: app điện thoại 1.4.2 (quét đóng gói, phiếu nhặt hàng, tồn kho theo mẫu).
  // Lần 29/10 (copy-listing) đã gửi xong và gỡ mẫu thư; vé cũ vẫn nằm trong onboarding_reminders.
  "mobile-1-4-2": {
    kind: "feature-mobile-1-4-2",
    send: (to, fullName) => sendFeatureMobileAppMail(to, { fullName }),
  },
};

export interface AnnounceCandidate {
  id: string;
  email: string;
  fullName: string;
  createdAt: Date;
}

const PAGE_SIZE = 500;
const INTERNAL_DOMAINS = new Set(["hubsell.vn", "hubsell.tech", "hubsell.test", "example.com"]);

export function isInternalEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return INTERNAL_DOMAINS.has(domain) || domain.endsWith(".test") || domain.endsWith(".local");
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  const head = user.length <= 2 ? (user[0] ?? "") : user.slice(0, 2);
  return `${head}***@${domain ?? ""}`;
}

/** Chủ shop nhận được thư, đọc theo trang (id tăng dần). */
export async function* announceCandidates(): AsyncGenerator<AnnounceCandidate[]> {
  let cursor = "";
  for (;;) {
    const rows = await prisma.user.findMany({
      where: {
        ownerId: null,
        email: { not: null },
        isPlatformAdmin: false,
        deletedAt: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, email: true, fullName: true, createdAt: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
    });
    if (rows.length === 0) return;
    yield rows.map((r) => ({ id: r.id, email: r.email!, fullName: r.fullName, createdAt: r.createdAt }));
    if (rows.length < PAGE_SIZE) return;
    cursor = rows[rows.length - 1].id;
  }
}

/** Giành vé cho cả trang — trả về những khách LƯỢT NÀY giành được (chưa từng nhận). */
async function claim(kind: string, page: AnnounceCandidate[]): Promise<AnnounceCandidate[]> {
  const batchId = randomUUID();
  await prisma.onboardingReminder.createMany({
    data: page.map((c) => ({ userId: c.id, kind, batchId })),
    skipDuplicates: true,
  });
  const mine = await prisma.onboardingReminder.findMany({ where: { batchId }, select: { userId: true } });
  const won = new Set(mine.map((m) => m.userId));
  return page.filter((c) => won.has(c.id));
}

async function releaseTicket(kind: string, userId: string): Promise<void> {
  await prisma.onboardingReminder.deleteMany({ where: { userId, kind } }).catch(() => undefined);
}

export interface AnnounceRunResult {
  sent: number;
  failed: number;
  /** Dừng giữa chừng vì thư lỗi (thường là Zoho chặn). */
  stoppedOnError: boolean;
  /** Chủ shop của thư lỗi làm dừng lượt (để worker ghi dấu "nghỉ hôm nay" vào DB). */
  failedUserId?: string;
}

/**
 * Gửi tối đa `limit` thư, từng thư một, nghỉ `pauseMs` giữa hai thư. Vé giành TỪNG
 * NGƯỜI ngay trước khi gửi (không giành cả lô rồi gửi dần) để dừng giữa chừng không
 * để lại vé treo. Thư đầu tiên lỗi → nhả vé, dừng cả lượt.
 */
export async function sendAnnounceBatch(
  feature: AnnounceFeature,
  opts: { limit: number; pauseMs: number; log?: (line: string) => void }
): Promise<AnnounceRunResult> {
  const log = opts.log ?? (() => undefined);
  const sentBefore = new Set(
    (await prisma.onboardingReminder.findMany({ where: { kind: feature.kind }, select: { userId: true } })).map(
      (r) => r.userId
    )
  );
  let sent = 0;
  let failed = 0;
  for await (const page of announceCandidates()) {
    for (const c of page) {
      if (sent >= opts.limit) return { sent, failed, stoppedOnError: false };
      if (isInternalEmail(c.email) || sentBefore.has(c.id)) continue;
      const won = await claim(feature.kind, [c]);
      if (won.length === 0) continue; // tiến trình khác vừa giành
      const ok = await feature.send(c.email, c.fullName);
      if (!ok) {
        await releaseTicket(feature.kind, c.id);
        failed += 1;
        log(`  x ${maskEmail(c.email)} gui loi, da nha ve — DUNG luot nay`);
        return { sent, failed, stoppedOnError: true, failedUserId: c.id };
      }
      sent += 1;
      log(`  + ${maskEmail(c.email)}`);
      await new Promise((r) => setTimeout(r, opts.pauseMs));
    }
  }
  return { sent, failed, stoppedOnError: false };
}
