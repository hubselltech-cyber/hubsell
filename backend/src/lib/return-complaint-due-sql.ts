// ============================================================
// HẠN KHIẾU NẠI ĐƠN HOÀN — bản SQL (lát 2 giao diện, 25/11/2026)
// docs/HAN-KHIEU-NAI-DON-HOAN.md mục 10.
//
// Thẻ lọc "Sắp hết hạn khiếu nại" + sắp xếp theo hạn phải lọc / sắp trong SQL (đơn hoàn của
// một shop tính bằng nghìn, phân trang theo vị trí) → biểu thức này phải cho ĐÚNG cùng hạn với
// hàm thuần complaintDueOf (return-complaint-due.ts) cho mọi đơn có state DUE, và NULL cho
// NOT_NEEDED / NOT_STARTED / UNKNOWN. Test db `return-complaint-due-sql-db.test.ts` so hai bên
// trên cùng bộ ca — sửa luật ở một bên phải sửa bên kia.
//
// Số giờ đọc từ COMPLAINT_WINDOW_HOURS (một chỗ để đổi số), không viết cứng.
// ============================================================

import { Prisma } from "@prisma/client";
import { CANCELLED_AFTER_SHIP } from "../integrations/cancelled-after-ship";
import type { ChannelScope } from "./channel-filter";
import { prisma } from "./prisma";
import { COMPLAINT_DUE_SOON_HOURS, COMPLAINT_WINDOW_HOURS } from "./return-complaint-due";

/**
 * Hạn khiếu nại hiệu lực (timestamptz hoặc NULL) của đơn `o` thuộc gian `c`.
 *   1. Ca đã đóng (NONE / RECEIVED_INTACT / CLAIM_SETTLED / WRITTEN_OFF) → NULL.
 *   2. Có hạn sàn trả → hạn đó.
 *   3. Kiện đã về (mốc sàn đứng trước mốc kho, hoặc kho đã cầm) → mốc + số giờ luật.
 *      Lazada RTM_RECEIVE_ITEM không có mốc giờ → NULL (UNKNOWN), giống hàm thuần.
 */
export function complaintDueSql(o = "o", c = "c"): Prisma.Sql {
  const O = Prisma.raw(`${o}`);
  const C = Prisma.raw(`${c}`);
  const failed = Prisma.sql`upper(coalesce(${O}."platformReturnStatus", '')) = ${CANCELLED_AFTER_SHIP}`;
  const hours = (pick: "buyerReturn" | "failedDelivery") =>
    Prisma.join(
      Object.entries(COMPLAINT_WINDOW_HOURS).map(
        ([platform, w]) => Prisma.sql`WHEN ${platform} THEN ${w[pick]}::int`
      ),
      " "
    );
  const windowHours = Prisma.sql`(CASE WHEN ${failed}
      THEN (CASE upper(${C}."channelName"::text) ${hours("failedDelivery")} END)
      ELSE (CASE upper(${C}."channelName"::text) ${hours("buyerReturn")} END) END)`;
  // Mốc kiện về — cùng luật returnShippingOf: mốc sàn chỉ tin khi đứng TRƯỚC mốc kho nhận.
  const arrivedAt = Prisma.sql`(CASE
      WHEN ${O}."returnDeliveredAt" IS NOT NULL
       AND NOT (${O}."returnStatus" <> 'AWAITING' AND ${O}."returnedAt" IS NOT NULL
                AND ${O}."returnDeliveredAt" >= ${O}."returnedAt")
        THEN ${O}."returnDeliveredAt"
      WHEN ${O}."returnStatus" <> 'AWAITING' THEN ${O}."returnedAt"
    END)`;
  return Prisma.sql`(CASE
      WHEN ${O}."returnStatus" NOT IN ('AWAITING', 'RECEIVED', 'DAMAGED') THEN NULL
      WHEN ${O}."returnComplaintDueAt" IS NOT NULL THEN ${O}."returnComplaintDueAt"
      ELSE ${arrivedAt} + make_interval(hours => ${windowHours})
    END)`;
}

/**
 * Tham số Date → `timestamp` UTC. Cột thời gian của Order là `timestamp` KHÔNG múi giờ (giờ UTC); so thẳng
 * với tham số Date thì Postgres đổi cột theo múi giờ của phiên → lệch 7 giờ khi phiên chạy giờ VN.
 */
export function utcTs(d: Date): Prisma.Sql {
  return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** Điều kiện "sắp hết hạn khiếu nại": còn hạn (> bây giờ) và còn ≤ COMPLAINT_DUE_SOON_HOURS giờ. */
export function complaintDueSoonSql(now: Date, o = "o", c = "c"): Prisma.Sql {
  const due = complaintDueSql(o, c);
  const until = new Date(now.getTime() + COMPLAINT_DUE_SOON_HOURS * 3_600_000);
  return Prisma.sql`(${due} > ${utcTs(now)} AND ${due} <= ${utcTs(until)})`;
}

/**
 * Đơn CÓ THỂ có hạn khiếu nại: ca hoàn còn mở và có ít nhất một mốc (hạn sàn / sàn báo kiện về / kho quét).
 * `complaintDueSql` khác NULL thì vị từ này luôn đúng (test db so trên mọi tổ hợp) — thêm vào WHERE không làm
 * mất dòng nào, chỉ để Postgres dùng được chỉ mục một phần "Order_return_complaint_due_idx".
 *
 * ⚠️ PHẢI khớp TỪNG CHỮ với vị từ của chỉ mục trong migration 20261125210000_order_return_complaint_due_idx.
 * Đo prod 25/11/2026: không có chỉ mục, câu "sắp hết hạn" của shop đông đơn hoàn nhất quét hết đơn của gian
 * qua Order_channelId_idx — 6,9 giây, 36.344 trang đệm (docs/HAN-KHIEU-NAI-DON-HOAN.md mục 16).
 */
export function complaintDueCandidateSql(o = "o"): Prisma.Sql {
  const O = Prisma.raw(`${o}`);
  return Prisma.sql`${O}."returnStatus" IN ('AWAITING', 'RECEIVED', 'DAMAGED')
      AND (${O}."returnComplaintDueAt" IS NOT NULL OR ${O}."returnDeliveredAt" IS NOT NULL OR ${O}."returnedAt" IS NOT NULL)`;
}

/** Trần số đơn "sắp hết hạn khiếu nại" đọc mỗi lượt — cửa 24 giờ nên tập này vốn nhỏ; trần chỉ để chặn ca lạ. */
const DUE_SOON_MAX = 500;

/**
 * Các đơn hoàn SẮP HẾT HẠN KHIẾU NẠI (còn hạn, còn ≤ 24 giờ) trong phạm vi gian của người xem, hạn gần nhất
 * trước. Một câu SQL cho cả ba việc của trang Đối soát đơn hoàn: số trên dải nhắc, hạn gần nhất, và danh sách
 * của bộ lọc ?status=DUE_SOON. KHÔNG theo bộ lọc ngày / ô tìm — việc gấp không được biến mất vì đang lọc kỳ khác.
 */
export async function loadComplaintDueSoon(scope: ChannelScope, now: Date): Promise<{ id: string; dueAt: Date }[]> {
  const conds: Prisma.Sql[] = [
    Prisma.sql`c."userId" = ${scope.userId}`,
    complaintDueCandidateSql("o"),
    complaintDueSoonSql(now, "o", "c"),
  ];
  if (typeof scope.id === "string") conds.push(Prisma.sql`c."id" = ${scope.id}`);
  else if (scope.id) {
    conds.push(scope.id.in.length ? Prisma.sql`c."id" IN (${Prisma.join(scope.id.in)})` : Prisma.sql`FALSE`);
  }
  if (scope.channelName) conds.push(Prisma.sql`c."channelName"::text = ${scope.channelName}`);
  const due = complaintDueSql("o", "c");
  return prisma.$queryRaw<{ id: string; dueAt: Date }[]>(Prisma.sql`
    SELECT o."id", ${due} AS "dueAt"
    FROM "Order" o JOIN "Channel" c ON c."id" = o."channelId"
    WHERE ${Prisma.join(conds, " AND ")}
    ORDER BY ${due} ASC, o."id" ASC
    LIMIT ${DUE_SOON_MAX}`);
}
