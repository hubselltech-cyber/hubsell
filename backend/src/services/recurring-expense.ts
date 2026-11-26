// ============================================================
// CHI PHÍ ĐỊNH KỲ — GHI các khoản tới hạn thành dòng OperatingExpense (26/11/2026).
// Thiết kế + lý do chọn "ghi dòng thật": docs/THU-CHI-VAN-HANH-CHI-PHI-DINH-KY.md mục 4–5.
//
// MỘT câu SQL cho cả lô luật (không vòng for từng chủ shop):
//   1. `due`  — khóa (FOR UPDATE SKIP LOCKED) tối đa `batch` luật ACTIVE có mốc
//               generatedThrough < hôm nay. Hai tiến trình chạy cùng lúc (worker + chủ
//               shop vừa tạo luật) không bao giờ cầm chung một luật.
//   2. `occ`  — bung các NGÀY TỚI HẠN trong (generatedThrough, min(hôm nay, endDay)].
//               Tháng / năm tính từ ngày gốc: startDay + n × 1 tháng — KHÔNG dùng
//               generate_series bước 1 tháng (cộng dồn: 31/01 → 28/02 → 28/03, lệch mãi).
//   3. `ins`  — chèn dòng chi; (recurringId, expenseDate) duy nhất + ON CONFLICT DO
//               NOTHING là chốt chặn cuối chống ghi trùng.
//   4. `upd`  — đẩy mốc; luật có ngày kết thúc đã tới → ENDED (ra khỏi tập quét).
//
// Đi theo MỐC chứ không theo "hôm nay đã chạy chưa": worker ngừng 3 ngày thì lượt kế ghi
// bù đủ 3 ngày; dòng chủ shop đã xóa tay (ngày kho nghỉ) nằm sau mốc nên không bị ghi lại.
// Chỉ ghi tới HÔM NAY giờ VN — không có dòng ngày tương lai.
//
// expenseDate = 00:00 UTC của ngày đó, đúng như khoản nhập tay chọn ngày ở web
// (`new Date("yyyy-mm-dd")`), nên hai loại xếp lẫn nhau theo ngày bình thường.
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toBusinessDateKey } from "../lib/date-range";

/** Số luật xử lý trong một câu SQL — giữ giao dịch ngắn. */
export const RECURRING_BATCH = 500;

type Db = Prisma.TransactionClient | typeof prisma;

export interface RecurringGenerateResult {
  /** Số dòng chi vừa ghi. */
  created: number;
  /** Số luật vừa được đẩy mốc. */
  rules: number;
}

/**
 * Ghi các khoản tới hạn (tới hết `todayKey`) cho tối đa `batch` luật.
 * `ruleId` / `ownerId` thu hẹp phạm vi (tạo luật mới, bấm Dừng).
 */
export async function generateRecurringExpenses(
  input: { todayKey?: string; ruleId?: string; ownerId?: string; batch?: number } = {},
  db: Db = prisma
): Promise<RecurringGenerateResult> {
  const today = input.todayKey ?? toBusinessDateKey(new Date());
  const batch = input.batch ?? RECURRING_BATCH;
  const ruleFilter = input.ruleId ? Prisma.sql`AND r."id" = ${input.ruleId}` : Prisma.empty;
  const ownerFilter = input.ownerId ? Prisma.sql`AND r."userId" = ${input.ownerId}` : Prisma.empty;

  const rows = await db.$queryRaw<{ created: number; rules: number }[]>(Prisma.sql`
    WITH due AS (
      SELECT r."id", r."userId", r."name", r."category", r."type", r."appliedSku", r."amount",
             r."cadence", r."startDay", r."endDay", r."fundChannelId", r."fundPlatform",
             r."fundSource", r."note", r."generatedThrough",
             LEAST(${today}::date, COALESCE(r."endDay", ${today}::date)) AS "upTo"
        FROM "recurring_expenses" r
       WHERE r."status" = 'ACTIVE'
         AND r."generatedThrough" < ${today}::date
         ${ruleFilter}
         ${ownerFilter}
       ORDER BY r."generatedThrough", r."id"
       LIMIT ${batch}::int
         FOR UPDATE SKIP LOCKED
    ), occ AS (
      SELECT d.*, o."day"
        FROM due d
       CROSS JOIN LATERAL (
              SELECT g::date AS "day"
                FROM generate_series(d."generatedThrough" + 1, d."upTo", interval '1 day') g
               WHERE d."cadence" = 'DAILY'
              UNION ALL
              SELECT (d."startDay" + n * interval '1 month')::date
                FROM generate_series(
                       0,
                       GREATEST(0, (date_part('year', d."upTo")::int - date_part('year', d."startDay")::int) * 12
                                 + (date_part('month', d."upTo")::int - date_part('month', d."startDay")::int))
                     ) n
               WHERE d."cadence" = 'MONTHLY'
              UNION ALL
              SELECT (d."startDay" + n * interval '1 year')::date
                FROM generate_series(
                       0,
                       GREATEST(0, date_part('year', d."upTo")::int - date_part('year', d."startDay")::int)
                     ) n
               WHERE d."cadence" = 'YEARLY'
            ) o
       WHERE o."day" > d."generatedThrough" AND o."day" <= d."upTo"
    ), ins AS (
      INSERT INTO "OperatingExpense"
             ("id", "userId", "name", "direction", "category", "type", "appliedSku", "amount",
              "fundChannelId", "fundPlatform", "fundSource", "note", "expenseDate", "recurringId")
      SELECT gen_random_uuid()::text, o."userId", o."name", 'EXPENSE'::"TransactionDirection",
             o."category", o."type", o."appliedSku", o."amount",
             o."fundChannelId", o."fundPlatform", o."fundSource", o."note", o."day"::timestamp, o."id"
        FROM occ o
          ON CONFLICT ("recurringId", "expenseDate") DO NOTHING
      RETURNING 1
    ), upd AS (
      UPDATE "recurring_expenses" r
         SET "generatedThrough" = d."upTo",
             "status" = CASE WHEN d."endDay" IS NOT NULL AND d."upTo" >= d."endDay"
                             THEN 'ENDED'::"RecurringStatus" ELSE r."status" END,
             "updatedAt" = (now() AT TIME ZONE 'UTC')
        FROM due d
       WHERE r."id" = d."id"
      RETURNING 1
    )
    SELECT (SELECT count(*)::int FROM ins) AS "created",
           (SELECT count(*)::int FROM upd) AS "rules"
  `);
  return { created: rows[0]?.created ?? 0, rules: rows[0]?.rules ?? 0 };
}

/**
 * Lượt của worker: gọi lô cho tới khi hết luật tới hạn. Mỗi lô một câu SQL / một giao dịch
 * ngắn; `maxBatches` chặn vòng lặp vô hạn nếu có luật kẹt (lượt giờ sau làm tiếp).
 */
export async function runRecurringExpenseSweep(
  input: { todayKey?: string; maxBatches?: number } = {}
): Promise<RecurringGenerateResult & { batches: number }> {
  const todayKey = input.todayKey ?? toBusinessDateKey(new Date());
  const maxBatches = input.maxBatches ?? 200;
  let created = 0;
  let rules = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const r = await generateRecurringExpenses({ todayKey });
    batches++;
    created += r.created;
    rules += r.rules;
    if (r.rules < RECURRING_BATCH) break;
  }
  return { created, rules, batches };
}
