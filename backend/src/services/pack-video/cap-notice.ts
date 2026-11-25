// ============================================================
// VIDEO ĐÓNG HÀNG — CHUÔNG BÁO TRƯỚC KHI XÓA (26/11/2026, lỗ hổng G7 của thiết kế mục 31.3)
//
// Luật tự xóa đợi tới QUA hạn khiếu nại nên phần lớn video bị xóa lúc đã hết giá trị bằng chứng — báo từng
// lượt như vậy là chuông nhiễu (shop đông đơn sẽ nhận mỗi ngày một cái). Chỉ MỘT trường hợp video còn giá trị
// mà vẫn bị xóa: video đang được GIỮ làm bằng chứng (đơn hoàn chưa xử lý xong, kho báo hỏng đang khiếu nại,
// kiện hủy đang quay về, video khui chưa khớp đơn) chạm TRẦN 60 ngày. Chuông này báo đúng trường hợp đó,
// trước 3 ngày (luật ghi hạn = trần từ trước trần 3 ngày — RETENTION_DAYS.CAP_NOTICE), để chủ shop kịp tải về.
//
// Cách chạy (worker dọn gọi sau pha gán hạn + pha tới hạn, mỗi 6 giờ):
//  · đọc video STORED có luật L6 và hạn rơi vào (mốc đã báo, hôm nay + 3] — theo lô theo khóa, qua chỉ mục một
//    phần "pack_videos_cap_idx"; đọc đơn theo KHÓA CHÍNH; hỏi luật thuần "nếu không có trần thì video này có đang
//    được giữ không" (decideRetention với ignoreCap) — cùng một nguồn luật với việc gán hạn;
//  · gộp theo chủ shop → MỘT chuông / chủ shop / lượt; mỗi video chỉ được báo một lần (mốc ở maintenance_jobs);
//  · CHẠY BÓNG (chưa bật PACK_VIDEO_DELETE_ENABLED) thì chỉ đếm, không phát chuông, không dời mốc — chưa xóa
//    thật mà báo "sắp xóa" là báo sai.
// Chuông chỉ tới CHỦ SHOP (mục `pack_video` — nhân viên không tải về được nên không nhận).
// Không giữ trạng thái ở biến cấp tệp. Phát chuông theo nhóm nhỏ song song, không tuần tự từng chủ shop.
// ============================================================

import { Prisma } from "@prisma/client";
import {
  PACK_VIDEO_JANITOR_BATCH,
  PACK_VIDEO_JANITOR_MAX_BATCHES,
  packVideoDeleteEnabled,
} from "../../config/pack-video";
import { RETENTION_DAYS, addDays, vnDateKey } from "../../lib/pack-video-retention";
import { prisma } from "../../lib/prisma";
import { notify, type NotifyInput } from "../notifications";
import { decideFor, loadOrders, type VideoRow } from "./retention";

export const CAP_NOTICE_JOB_KEY = "pack-cap-notice";
export const CAP_NOTICE_TYPE = "pack-video-cap";
/** Trang video với nhãn "Sắp tự xóa" bật sẵn (frontend videos-tab.tsx đọc ?chip=). */
export const CAP_NOTICE_LINK = "/orders/videos?chip=expiring";

/** Số chủ shop phát chuông cùng lúc. SỐ TỰ CHỌN — nhỏ hơn hồ kết nối database của worker. */
const NOTIFY_CONCURRENCY = 4;

export interface CapNoticeDeps {
  now?: () => Date;
  /** Ghi đè công tắc xóa thật (test). */
  deleteEnabled?: boolean;
  /** Thay cửa phát chuông (test). */
  notifyOwner?: (ownerId: string, input: NotifyInput) => Promise<unknown>;
  batchSize?: number;
  maxBatches?: number;
  /** Chỉ xét một chủ shop (test / chạy tay). Khi đặt, mốc "đã báo" không đọc / ghi. */
  onlyOwnerId?: string;
}

export interface CapNoticeReport {
  /** Video L6 trong cửa sổ đã đọc. */
  scanned: number;
  /** Trong đó: video đang được giữ làm bằng chứng. */
  held: number;
  /** Số chủ shop có video như vậy. */
  owners: number;
  /** Số chuông đã phát (0 khi chạy bóng). */
  notified: number;
  shadow: boolean;
}

const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const ddmm = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

/**
 * Câu chữ chuông — công thức giá trị (docs/CHUONG-THONG-BAO-CAU-CHU-GIA-TRI.md): việc gì, số thật, cần làm gì.
 * Tiêu đề ≤ 70 ký tự (trần tin đẩy, services/push.ts).
 */
export function capNoticeText(count: number, firstDeleteKey: string): { title: string; body: string } {
  return {
    title: `${count} video đơn hoàn chưa xong sắp tự xóa — tải về trước ${ddmm(firstDeleteKey)}`,
    body:
      `Đơn hoàn của ${count === 1 ? "video này" : "các video này"} chưa xử lý xong, nhưng video đã lưu đủ ` +
      `${RETENTION_DAYS.HARD_CAP} ngày nên hệ thống tự xóa từ ${ddmm(firstDeleteKey)}. ` +
      `Cần giữ làm bằng chứng thì tải về ở trang Video đóng hàng, nhãn Sắp tự xóa.`,
  };
}

type CapRow = VideoRow & { deleteAfter: Date };

export async function notifyCapExpiring(deps: CapNoticeDeps = {}): Promise<CapNoticeReport> {
  const now = (deps.now ?? (() => new Date()))();
  const today = vnDateKey(now);
  const through = addDays(today, RETENTION_DAYS.CAP_NOTICE);
  const size = deps.batchSize ?? PACK_VIDEO_JANITOR_BATCH;
  const maxBatches = deps.maxBatches ?? PACK_VIDEO_JANITOR_MAX_BATCHES;
  const shadow = !(deps.deleteEnabled ?? packVideoDeleteEnabled());
  const persist = !deps.onlyOwnerId;
  const report: CapNoticeReport = { scanned: 0, held: 0, owners: 0, notified: 0, shadow };

  // Mốc = ngày hạn xa nhất ĐÃ báo. Video tới hạn hôm nay trở về trước thì pha tới hạn đã xử lý trong cùng lượt.
  const job = persist
    ? await prisma.maintenanceJob.findUnique({ where: { key: CAP_NOTICE_JOB_KEY }, select: { cursor: true } })
    : null;
  const from = job?.cursor && job.cursor > today ? job.cursor : today;
  if (from >= through) return report;

  const owner = deps.onlyOwnerId ? Prisma.sql`AND v."ownerId" = ${deps.onlyOwnerId}` : Prisma.empty;
  const perOwner = new Map<string, { count: number; first: string }>();
  let after: { d: string; rd: string; id: string } | null = null;
  let complete = false;

  for (let batch = 0; batch < maxBatches; batch++) {
    const rows: CapRow[] = await prisma.$queryRaw<CapRow[]>(Prisma.sql`
      SELECT v."recordedDate", v."id", v."ownerId", v."kind", v."orderId", v."objectKey", v."holdReason", v."deleteAfter"
      FROM "pack_videos" v
      WHERE v."status" = 'STORED' AND v."deleteRule" = 'L6'
        AND v."deleteAfter" > ${from}::date AND v."deleteAfter" <= ${through}::date ${owner}
        ${after ? Prisma.sql`AND (v."deleteAfter", v."recordedDate", v."id") > (${after.d}::date, ${after.rd}::date, ${after.id})` : Prisma.empty}
      ORDER BY v."deleteAfter", v."recordedDate", v."id"
      LIMIT ${size}`);
    if (rows.length === 0) {
      complete = true;
      break;
    }
    report.scanned += rows.length;
    const orders = await loadOrders(rows);
    for (const row of rows) {
      // Bỏ trần ra mà luật vẫn bảo GIỮ = video còn đang là bằng chứng. Video chạm trần vì lý do khác (đơn treo
      // không bao giờ giao, ca hoàn đã đóng sát trần) thì không báo.
      if (decideFor(row, orders, now, { ignoreCap: true }).kind !== "HOLD") continue;
      report.held += 1;
      const key = dateKey(row.deleteAfter);
      const cur = perOwner.get(row.ownerId);
      if (cur) {
        cur.count += 1;
        if (key < cur.first) cur.first = key;
      } else {
        perOwner.set(row.ownerId, { count: 1, first: key });
      }
    }
    const last: CapRow = rows[rows.length - 1];
    after = { d: dateKey(last.deleteAfter), rd: dateKey(last.recordedDate), id: last.id };
    if (rows.length < size) {
      complete = true;
      break;
    }
  }
  report.owners = perOwner.size;
  if (shadow) return report;

  const send = deps.notifyOwner ?? notify;
  const targets = [...perOwner.entries()];
  for (let i = 0; i < targets.length; i += NOTIFY_CONCURRENCY) {
    const sent = await Promise.all(
      targets.slice(i, i + NOTIFY_CONCURRENCY).map(async ([ownerId, v]) => {
        const text = capNoticeText(v.count, v.first);
        // dedupe tắt: mỗi video chỉ lọt cửa sổ một lần (mốc bên dưới), hai lượt khác nhau là hai nhóm video khác nhau.
        const res = await send(ownerId, { type: CAP_NOTICE_TYPE, ...text, link: CAP_NOTICE_LINK, dedupe: false });
        return res ? 1 : 0;
      })
    );
    report.notified += sent.reduce<number>((a, b) => a + b, 0);
  }

  // Đọc chưa hết cửa sổ (chạm trần số lô) → KHÔNG dời mốc: lượt sau đọc lại từ đầu, thà báo trùng còn hơn sót.
  if (persist && complete) {
    await prisma.maintenanceJob.upsert({
      where: { key: CAP_NOTICE_JOB_KEY },
      create: { key: CAP_NOTICE_JOB_KEY, cursor: through, processed: report.notified },
      update: { cursor: through, processed: { increment: report.notified }, updatedAt: new Date() },
    });
  }
  return report;
}
