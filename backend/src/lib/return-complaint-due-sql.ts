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
import { COMPLAINT_WINDOW_HOURS } from "./return-complaint-due";

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
