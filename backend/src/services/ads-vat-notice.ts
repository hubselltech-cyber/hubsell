// ============================================================
// CHUÔNG MỘT LẦN: báo chủ shop rằng báo cáo có thêm dòng "Thuế GTGT quảng cáo" (26/11/2026).
// Anh Trung duyệt câu chữ + phạm vi ("Gửi chuông"): chỉ chủ shop có tiền quảng cáo TikTok /
// Shopee trong 30 ngày qua và đang để tính thuế vào chi phí — shop khác báo cáo không đổi
// nên không nhận. Chỉ CHUÔNG (web + danh sách thông báo trong app), không đẩy về điện thoại.
// Bối cảnh: docs/TAI-CHINH-VAT-QUANG-CAO.md mục 8–9.
//
// Chạy đúng MỘT lần cho cả hệ thống, nhớ ở maintenance_jobs:
//   · giữ việc bằng một câu UPDATE có điều kiện → hai tiến trình (bản cũ + bản mới lúc deploy)
//     không cùng gửi; việc bị bỏ dở quá 10 phút thì lượt sau nhận lại;
//   · trước khi gửi, bỏ qua chủ shop ĐÃ có chuông này (bất kể đã đọc hay chưa) → nhận lại
//     việc dở cũng không ai nhận hai lần;
//   · xong thì ghi doneAt, các lần khởi động sau chỉ đọc một dòng rồi thôi.
// Việc một lần — khi đã thấy doneAt trên prod thì gỡ worker này khỏi workers/index.ts.
// ============================================================

import { Prisma } from "@prisma/client";
import { adsVatGloballyOff } from "../config/ads-vat";
import { toBusinessDateKey } from "../lib/date-range";
import { prisma } from "../lib/prisma";
import { notify } from "./notifications";

export const ADS_VAT_NOTICE_KEY = "ads-vat-notice-2026-11-26";

/** Loại "system" → mục "Thông báo hệ thống" (luôn bật, khách không tắt được). */
export const ADS_VAT_NOTICE_TYPE = "system";
export const ADS_VAT_NOTICE_TITLE = 'Báo cáo có thêm dòng "Thuế GTGT quảng cáo"';
export const ADS_VAT_NOTICE_BODY =
  "Khi bạn nạp tiền quảng cáo, sàn cộng thêm thuế GTGT (TikTok 10%, Shopee 8%) ngoài số tiền quảng cáo. " +
  "Từ hôm nay, Báo cáo dòng tiền, Tổng quan và Lãi/Lỗ tính thêm khoản thuế này vào chi phí, nên lợi nhuận " +
  "hiển thị sẽ thấp hơn trước đúng bằng tiền thuế, kể cả khi bạn xem lại các kỳ cũ. Shop là công ty được " +
  "khấu trừ thuế GTGT có thể tắt ở Hóa đơn & Thuế › Thuế bổ sung.";
export const ADS_VAT_NOTICE_LINK = "/finance/analytics";

/** Chỉ báo shop có tiền quảng cáo trong ngần này ngày gần nhất — phạm vi anh Trung duyệt. */
const RECENT_DAYS = 30;
/** Việc đã có người giữ mà quá ngần này không xong → coi là bỏ dở, lượt sau nhận lại. */
const STALE_CLAIM_MS = 10 * 60 * 1000;
const SEND_BATCH = 20;
const DAY_MS = 86_400_000;

export interface AdsVatNoticeResult {
  /** "done" đã xong từ trước · "busy" tiến trình khác đang gửi · "off" tính năng đang tắt · "sent" vừa gửi. */
  outcome: "done" | "busy" | "off" | "sent";
  recipients: number;
  sent: number;
}

/**
 * Chủ shop thuộc diện nhận: Σ AdSpend > 0 trên gian TikTok / Shopee trong RECENT_DAYS ngày
 * (tới hôm nay giờ VN) và KHÔNG tắt "tính thuế GTGT quảng cáo vào chi phí".
 * `onlyOwnerIds` chỉ dùng trong test (không đụng chủ shop thật của DB dev).
 */
export async function adsVatNoticeRecipients(
  now: Date = new Date(),
  onlyOwnerIds?: string[]
): Promise<string[]> {
  const today = toBusinessDateKey(now);
  const since = toBusinessDateKey(new Date(now.getTime() - (RECENT_DAYS - 1) * DAY_MS));
  const only =
    onlyOwnerIds && onlyOwnerIds.length > 0
      ? Prisma.sql`AND c."userId" = ANY(${onlyOwnerIds})`
      : Prisma.empty;
  const rows = await prisma.$queryRaw<{ ownerId: string }[]>(Prisma.sql`
    SELECT c."userId" AS "ownerId"
      FROM "AdSpend" s
      JOIN "Channel" c ON c."id" = s."channelId"
      LEFT JOIN "ShopTaxSetting" t ON t."ownerId" = c."userId"
     WHERE s."date" BETWEEN ${since}::date AND ${today}::date
       AND c."channelName" IN ('SHOPEE', 'TIKTOK')
       AND COALESCE(t."adsVatAsCost", true)
       ${only}
     GROUP BY c."userId"
    HAVING sum(s."amount") > 0
     ORDER BY c."userId"
  `);
  return rows.map((r) => r.ownerId);
}

/** Gửi chuông một lần. `key` / `onlyOwnerIds` chỉ đổi trong test. */
export async function runAdsVatNotice(
  opts: { now?: Date; key?: string; onlyOwnerIds?: string[] } = {}
): Promise<AdsVatNoticeResult> {
  const now = opts.now ?? new Date();
  const key = opts.key ?? ADS_VAT_NOTICE_KEY;
  // Báo cáo đang tắt thuế toàn hệ thống (đường lui) thì chưa báo gì — bật lại rồi mới gửi.
  if (adsVatGloballyOff()) return { outcome: "off", recipients: 0, sent: 0 };

  const job = await prisma.maintenanceJob.upsert({ where: { key }, update: {}, create: { key } });
  if (job.doneAt) return { outcome: "done", recipients: 0, sent: job.processed };

  // Giữ việc: chỉ MỘT tiến trình cập nhật được dòng này (chưa ai giữ, hoặc người giữ đã bỏ dở).
  const claimed = await prisma.maintenanceJob.updateMany({
    where: {
      key,
      doneAt: null,
      OR: [{ cursor: null }, { updatedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
    },
    data: { cursor: "sending", updatedAt: now },
  });
  if (claimed.count === 0) return { outcome: "busy", recipients: 0, sent: 0 };

  const recipients = await adsVatNoticeRecipients(now, opts.onlyOwnerIds);
  // Ai đã có chuông này (lượt trước gửi dở) thì bỏ qua.
  const had = new Set(
    recipients.length === 0
      ? []
      : (
          await prisma.notification.findMany({
            where: { ownerId: { in: recipients }, type: ADS_VAT_NOTICE_TYPE, title: ADS_VAT_NOTICE_TITLE },
            select: { ownerId: true },
          })
        ).map((n) => n.ownerId)
  );
  const todo = recipients.filter((id) => !had.has(id));

  let sent = 0;
  for (let i = 0; i < todo.length; i += SEND_BATCH) {
    const results = await Promise.all(
      todo.slice(i, i + SEND_BATCH).map((ownerId) =>
        notify(ownerId, {
          type: ADS_VAT_NOTICE_TYPE,
          title: ADS_VAT_NOTICE_TITLE,
          body: ADS_VAT_NOTICE_BODY,
          link: ADS_VAT_NOTICE_LINK,
          push: false, // chỉ chuông, không đẩy về điện thoại
        })
      )
    );
    sent += results.filter((r) => r !== null).length;
    // Còn đang làm — đẩy mốc để tiến trình khác không tưởng việc bị bỏ dở.
    await prisma.maintenanceJob.update({ where: { key }, data: { updatedAt: new Date() } });
  }

  await prisma.maintenanceJob.update({
    where: { key },
    data: { doneAt: new Date(), updatedAt: new Date(), processed: had.size + sent },
  });
  return { outcome: "sent", recipients: recipients.length, sent };
}
