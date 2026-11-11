// ============================================================
// PHÍ VƯỢT TRẦN ĐƠN — "TÍNH THẲNG" cho MỌI gói (anh Trung chốt 11/11/2026).
//
// Câu hỏi của khách: "Lỡ đang dùng mà vượt thì sao?" → vẫn dùng đủ mọi tính năng; phần
// vượt tính theo đúng đơn giá của gói đang dùng (giá 1 THÁNG ÷ trần đơn — anh: "gói 300
// đơn là 99K vậy vượt là tính 99K/300 × số đơn vượt"), trả trước hết mùng 5 tháng sau.
// KHÔNG có nấc vượt tối đa, KHÔNG có trần phí (anh: "Chốt tính thẳng" — đừng thêm lại).
// Nâng gói trong tháng thì trần gói mới áp cho cả tháng đó.
//
// MỘT câu SQL (overageRowsSql) cho cả hai việc — số tạm tính khách thấy trong tháng và
// phiếu chốt đầu tháng sau không thể lệch nhau vì là cùng một phép tính:
//   - tạm tính cho một chủ shop  → monthOverageFor()
//   - chốt tháng trước cho mọi chủ shop → closeMonthOverage(): INSERT … SELECT … ON
//     CONFLICT DO NOTHING, không vòng for, chạy lại vô hại.
//
// Luật của tháng M (giờ Việt Nam) cho một chủ shop:
//   - chỉ xét các KỲ ĐÃ TRẢ TIỀN (package_payments kind PLAN) có phần nằm trong M;
//   - gói áp cho tháng = kỳ có TRẦN CAO NHẤT trong số đó (nâng gói giữa tháng → trần mới
//     áp cả tháng; hạ gói giữa tháng → khách vẫn hưởng trần cũ hết tháng);
//   - trần tháng = trần gói × phần tháng được kỳ đã trả phủ (mua ngày 20 thì chỉ ~1/3
//     trần, và chỉ đếm đơn phát sinh từ ngày 20), làm tròn LÊN có lợi cho khách;
//   - đếm mọi đơn phát sinh trên sàn trong phần đó, kể cả đơn hủy (đúng định nghĩa trần
//     đang hiển thị — plan-enforcement.ts);
//   - phí = max(0, đơn − trần) × đơn giá, làm tròn tới đồng.
// Dùng thử (chưa trả tiền) không có kỳ nào → không có phí vượt; luật khóa mềm cũ giữ.
//
// Thiết kế + các quyết định: docs/GOI-VUOT-TRAN-TINH-THEO-DON-GIA-GOI.md.
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * Gói THƯỜNG bắt đầu tính phí vượt từ tháng này (em tự chọn 11/11/2026, anh "Làm theo đề
 * xuất"): khách đang trả tiền đã mua theo luật cũ "vượt 120 % / 7 ngày thì khóa" — báo
 * trước rồi mới đổi. Trước tháng này gói thường giữ luật khóa cũ. Gói tính theo đơn
 * (Enterprise tự phục vụ) đã nói rõ phần vượt ngay lúc mua nên tính từ tháng mua.
 */
export const OVERAGE_START_MONTH = "2026-12";

/**
 * Tháng ĐẦU TIÊN có thể có phiếu (11/2026 = tháng Enterprise tự phục vụ lên sóng và khách
 * được báo rõ phần vượt lúc mua). Không bao giờ tính lùi về trước — khách của các tháng đó
 * chưa từng được báo luật này.
 */
export const OVERAGE_FIRST_MONTH = "2026-11";

/**
 * Hạn thanh toán phần vượt: hết ngày này của tháng sau, khóa từ 00:00 ngày kế (anh Trung
 * chốt 11/11/2026: "thanh toán vào mùng 5 của tháng tiếp theo"). Một chỗ duy nhất — /me
 * trả số này cho mọi câu chữ ở FE.
 */
export const OVERAGE_DUE_DAY = 5;

/** Câu thông báo phần vượt dùng cho chuông (FE có bản riêng đọc cùng số từ /me). */
export function overageNoticeText(unitPrice: number | null): string {
  const price = unitPrice != null ? `${unitPrice.toLocaleString("vi-VN")} ₫` : "theo giá gói";
  return `Vượt số đơn đã mua: tính ${price} cho mỗi đơn vượt, thanh toán trước hết ngày mùng ${OVERAGE_DUE_DAY} tháng sau. Mọi tính năng vẫn dùng bình thường.`;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Date → chuỗi 'yyyy-MM-dd HH:mm:ss.SSS' UTC cho cột TIMESTAMP(3) không múi giờ: ép kiểu từ
 *  chuỗi nên không phụ thuộc múi giờ phiên DB (Date gắn thẳng sẽ thành timestamptz). */
function ts(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

/** "yyyy-MM" theo giờ Việt Nam. */
export function vnMonthKey(d: Date): string {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Hai đầu tháng "yyyy-MM" theo giờ VN, trả về Date UTC chuẩn: [start, end). */
export function vnMonthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error(`Tháng không hợp lệ: ${month}`);
  return {
    start: new Date(Date.UTC(y, m - 1, 1) - VN_OFFSET_MS),
    end: new Date(Date.UTC(y, m, 1) - VN_OFFSET_MS),
  };
}

/** Tháng liền trước của một thời điểm, "yyyy-MM" giờ VN. */
export function vnPreviousMonthKey(now: Date): string {
  const { start } = vnMonthBounds(vnMonthKey(now));
  return vnMonthKey(new Date(start.getTime() - 1));
}

/** "11/2026" từ "2026-11" — cho câu chữ. */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${m}/${y}`;
}

/**
 * Mốc KHÓA của phiếu tháng M: 00:00 ngày (OVERAGE_DUE_DAY + 1) tháng sau, giờ VN — tức
 * khách có tới hết ngày mùng 5. Phiếu chốt trễ (worker ngừng vài ngày) thì khách vẫn có
 * ít nhất 3 ngày kể từ lúc phiếu ra.
 */
export function overageDueAt(month: string, createdAt: Date = new Date(0)): Date {
  const { end } = vnMonthBounds(month); // = 00:00 mùng 1 tháng sau, giờ VN
  const standard = new Date(end.getTime() + OVERAGE_DUE_DAY * 24 * 60 * 60 * 1000);
  const lateFloor = new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000);
  return standard.getTime() >= lateFloor.getTime() ? standard : lateFloor;
}

type PlanForOverage = {
  priceMonthly: Prisma.Decimal | number;
  maxOrdersPerMonth: number | null;
  minOrdersPerMonth: number | null;
  pricePerOrder?: Prisma.Decimal | number | null;
};

/**
 * Đơn giá vượt ₫/đơn của một gói = giá 1 tháng ÷ trần đơn. Gói tính theo đơn: giá công bố
 * (pricePerOrder), không có thì giá tháng ÷ mức tối thiểu (Enterprise ra đúng 65 ₫).
 * `floor` = SÀN đơn giá (em đề xuất, anh "Làm theo đề xuất"): gói nào ra thấp hơn giá của
 * gói tính theo đơn thì lấy giá đó — hiện chỉ Scale dính (59,95 → 65), để mua Scale rồi cứ
 * để vượt không rẻ hơn mua Enterprise. Bỏ sàn: gọi với floor = null.
 * null = gói không có trần đơn hoặc giá 0 → không có phí vượt.
 */
export function overageUnitPrice(plan: PlanForOverage, floor: number | null): number | null {
  const perOrder = plan.minOrdersPerMonth != null && plan.minOrdersPerMonth > 0;
  const cap = perOrder ? plan.minOrdersPerMonth : plan.maxOrdersPerMonth;
  const monthly = Number(plan.priceMonthly);
  if (perOrder && plan.pricePerOrder != null && Number(plan.pricePerOrder) > 0) {
    return Number(plan.pricePerOrder);
  }
  if (!cap || cap <= 0 || !(monthly > 0)) return null;
  const raw = Math.round((monthly / cap) * 100) / 100;
  return floor != null && raw < floor ? floor : raw;
}

/**
 * Đơn thứ bao nhiêu trong tháng thì tiền vượt bằng mức chênh lên gói trên — mốc báo khách
 * "từ đây nâng gói rẻ hơn" và báo sale gọi. Chỉ là mốc BÁO, không chặn, không đổi cách
 * tính tiền (anh chốt tính thẳng). null = không có gói trên / gói trên không đắt hơn.
 */
export function upgradeBreakEvenOrder(
  cap: number,
  unitPrice: number,
  priceMonthly: number,
  nextPriceMonthly: number | null
): number | null {
  if (nextPriceMonthly == null || !(nextPriceMonthly > priceMonthly) || !(unitPrice > 0)) return null;
  return cap + Math.floor((nextPriceMonthly - priceMonthly) / unitPrice);
}

/** Sàn đơn giá vượt = giá công bố của gói tính theo đơn đang bán (Enterprise 65 ₫). */
export async function overageFloorPrice(): Promise<number | null> {
  const p = await prisma.servicePlan.findFirst({
    where: { minOrdersPerMonth: { not: null }, pricePerOrder: { not: null } },
    orderBy: { tier: "asc" },
    select: { pricePerOrder: true },
  });
  return p?.pricePerOrder != null ? Number(p.pricePerOrder) : null;
}

export interface MonthOverageRow {
  ownerId: string;
  planCode: string;
  planName: string;
  /** Trần áp cho tháng (đã nhân phần tháng được phủ, làm tròn lên). */
  orderCap: number;
  ordersCounted: number;
  overOrders: number;
  unitPrice: number;
  amount: number;
}

/**
 * Phép tính phí vượt của tháng [start, end) — một dòng cho mỗi chủ shop có kỳ ĐÃ TRẢ TIỀN
 * nằm trong tháng và gói có trần đơn. `ownerId` = chỉ tính một chủ (tạm tính); bỏ trống =
 * mọi chủ. `asOf` chặn đầu trên khi đếm đơn (tháng đang chạy).
 *
 * Tên bảng/cột: User / Channel / Order không @@map (PascalCase), bảng gói có @@map.
 * Đếm đơn đi bằng chỉ mục Order(channelId, createdAt) qua LATERAL theo từng chủ shop.
 */
function overageRowsSql(opts: {
  month: string;
  floor: number | null;
  ownerId?: string;
  /** Bỏ qua chủ shop đã có phiếu tháng đó (lượt chốt) — khỏi đếm đơn của họ lần nữa. */
  skipClosed?: boolean;
  asOf?: Date;
}): Prisma.Sql {
  const { start, end } = vnMonthBounds(opts.month);
  const asOf = opts.asOf && opts.asOf.getTime() < end.getTime() ? opts.asOf : end;
  const monthMs = end.getTime() - start.getTime();
  const floor = opts.floor ?? 0;
  const ownerFilter = Prisma.sql`${
    opts.ownerId ? Prisma.sql`AND pp."userId" = ${opts.ownerId}` : Prisma.empty
  } ${
    opts.skipClosed
      ? Prisma.sql`AND NOT EXISTS (
        SELECT 1 FROM "plan_overage_charges" c WHERE c."ownerId" = pp."userId" AND c."month" = ${opts.month}
      )`
      : Prisma.empty
  }`;
  // Gói thường chỉ tính từ OVERAGE_START_MONTH. Gói tính theo đơn tính từ tháng mua, nhưng
  // CHỈ với kỳ có ghi số đơn đã chọn (committedOrders) — tức kỳ mua từ khi tự phục vụ lên
  // sóng, khách đã đọc câu báo phần vượt; khoản HQ ghi tay kiểu cũ (không có số) thì không.
  // Tháng trước OVERAGE_FIRST_MONTH: không kỳ nào được tính.
  const anyAllowed = opts.month >= OVERAGE_FIRST_MONTH;
  const regularAllowed = opts.month >= OVERAGE_START_MONTH;

  return Prisma.sql`
    WITH paid AS (
      -- Mỗi kỳ đã trả có phần nằm trong tháng: trần + đơn giá (chụp lúc mua, khoản cũ thì
      -- đọc bảng giá hiện hành) và đoạn giao với tháng.
      SELECT
        pp."userId" AS owner_id,
        pp."planCode" AS plan_code,
        pp."planName" AS plan_name,
        pp."periodStart" AS period_start,
        COALESCE(pp."orderCap", pp."committedOrders", sp."minOrdersPerMonth", sp."maxOrdersPerMonth") AS cap,
        COALESCE(
          pp."overageUnitPrice",
          CASE
            WHEN sp."minOrdersPerMonth" IS NOT NULL AND sp."pricePerOrder" IS NOT NULL THEN sp."pricePerOrder"
            WHEN COALESCE(sp."minOrdersPerMonth", sp."maxOrdersPerMonth") > 0 AND sp."priceMonthly" > 0
              THEN GREATEST(ROUND(sp."priceMonthly" / COALESCE(sp."minOrdersPerMonth", sp."maxOrdersPerMonth"), 2), ${floor}::numeric)
          END
        ) AS unit_price,
        GREATEST(pp."periodStart", ${ts(start)}::timestamp) AS seg_start,
        LEAST(pp."periodEnd", ${ts(end)}::timestamp) AS seg_end
      FROM "package_payments" pp
      LEFT JOIN "service_plans" sp ON sp."code" = pp."planCode"
      WHERE pp."kind" = 'PLAN'
        AND pp."periodStart" < ${ts(end)}::timestamp
        AND pp."periodEnd" > ${ts(start)}::timestamp
        AND ${anyAllowed}::boolean
        AND (CASE WHEN sp."minOrdersPerMonth" IS NOT NULL
               THEN pp."committedOrders" IS NOT NULL
               ELSE ${regularAllowed}::boolean END)
        ${ownerFilter}
    ),
    owner_month AS (
      -- Gói áp cho tháng = kỳ có trần cao nhất (trùng trần thì kỳ mua sau); phần tháng
      -- được phủ = từ đầu đoạn sớm nhất tới cuối đoạn muộn nhất.
      SELECT DISTINCT ON (owner_id)
        owner_id, plan_code, plan_name, cap, unit_price,
        MIN(seg_start) OVER (PARTITION BY owner_id) AS covered_from,
        MAX(seg_end) OVER (PARTITION BY owner_id) AS covered_to
      FROM paid
      WHERE cap IS NOT NULL AND cap > 0 AND unit_price IS NOT NULL AND unit_price > 0
      ORDER BY owner_id, cap DESC, period_start DESC
    ),
    counted AS (
      SELECT
        om.*,
        CEIL(om.cap * (EXTRACT(EPOCH FROM (om.covered_to - om.covered_from)) * 1000 / ${monthMs}::numeric))::int AS month_cap,
        oc.n::int AS orders_counted
      FROM owner_month om
      CROSS JOIN LATERAL (
        SELECT COUNT(*) AS n
        FROM "Order" o
        JOIN "Channel" ch ON ch."id" = o."channelId"
        WHERE ch."userId" = om.owner_id
          -- Đơn bán tại quầy (gian OFFLINE) KHÔNG tính (anh Trung chốt 11/11/2026: "Không
          -- tính") — cùng lý với trần số gian: không đồng bộ, không ăn hạn mức API của sàn.
          AND ch."channelName" <> 'OFFLINE'
          AND o."createdAt" >= om.covered_from
          AND o."createdAt" < LEAST(om.covered_to, ${ts(asOf)}::timestamp)
      ) oc
    )
    SELECT
      owner_id AS "ownerId",
      plan_code AS "planCode",
      plan_name AS "planName",
      month_cap AS "orderCap",
      orders_counted AS "ordersCounted",
      GREATEST(orders_counted - month_cap, 0) AS "overOrders",
      unit_price::float8 AS "unitPrice",
      ROUND(GREATEST(orders_counted - month_cap, 0) * unit_price)::float8 AS "amount"
    FROM counted
  `;
}

/**
 * Tạm tính phí vượt của MỘT chủ shop cho một tháng (mặc định tháng này). KHÔNG chặn đầu
 * trên theo đồng hồ máy chủ: đồng hồ Node và đồng hồ DB lệch nhau vài chục mili giây là đơn
 * vừa về bị bỏ sót (đã dẫm ở test 11/11/2026) — đơn thật không có createdAt ở tương lai.
 * `asOf` chỉ dành cho test / xem lại "tới ngày N của tháng đó thì vượt bao nhiêu".
 */
export async function monthOverageFor(
  ownerId: string,
  opts: { month?: string; asOf?: Date } = {}
): Promise<MonthOverageRow | null> {
  const floor = await overageFloorPrice();
  const rows = await prisma.$queryRaw<MonthOverageRow[]>(
    overageRowsSql({ month: opts.month ?? vnMonthKey(new Date()), floor, ownerId, asOf: opts.asOf })
  );
  return rows[0] ?? null;
}

/**
 * CHỐT phí vượt của một tháng cho mọi chủ shop chưa có phiếu — MỘT câu INSERT … SELECT.
 * Chủ không vượt cũng được một dòng status NONE (đánh dấu đã chốt + giữ số đối chiếu) để
 * lượt chạy lại không đếm đơn của họ lần nữa. Trả về các phiếu OPEN vừa sinh (để báo khách).
 * Chỉ chốt tháng ĐÃ QUA: gọi với tháng hiện tại/tương lai là ném lỗi.
 */
export async function closeMonthOverage(
  month: string,
  now: Date = new Date(),
  /** Chỉ chốt cho một chủ shop (HQ chốt tay / test) — bỏ trống = mọi chủ. */
  onlyOwnerId?: string
): Promise<{ created: number; open: Array<MonthOverageRow & { id: string; dueAt: Date }> }> {
  const { end } = vnMonthBounds(month);
  if (end.getTime() > now.getTime()) throw new Error(`Tháng ${month} chưa kết thúc — không chốt phí vượt`);
  const floor = await overageFloorPrice();
  const dueAt = overageDueAt(month, now);
  const rows = await prisma.$queryRaw<Array<MonthOverageRow & { id: string; status: string; dueAt: Date }>>(Prisma.sql`
    INSERT INTO "plan_overage_charges"
      ("id", "ownerId", "month", "planCode", "planName", "orderCap", "ordersCounted", "overOrders",
       "unitPrice", "amount", "status", "dueAt", "createdAt", "updatedAt")
    SELECT
      gen_random_uuid()::text, r."ownerId", ${month}, r."planCode", r."planName", r."orderCap",
      r."ordersCounted", r."overOrders", r."unitPrice", r."amount",
      (CASE WHEN r."amount" > 0 THEN 'OPEN' ELSE 'NONE' END)::"PlanOverageStatus",
      ${ts(dueAt)}::timestamp, ${ts(now)}::timestamp, ${ts(now)}::timestamp
    FROM (${overageRowsSql({ month, floor, ownerId: onlyOwnerId, skipClosed: true })}) r
    ON CONFLICT ("ownerId", "month") DO NOTHING
    RETURNING "id", "ownerId", "planCode", "planName", "orderCap", "ordersCounted", "overOrders",
      "unitPrice"::float8 AS "unitPrice", "amount"::float8 AS "amount", "status"::text AS "status", "dueAt"
  `);
  return { created: rows.length, open: rows.filter((r) => r.status === "OPEN") };
}
