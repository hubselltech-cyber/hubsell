// ============================================================
// THẤT THU HÀNG MẤT/HỎNG — luật SQL chạy thẳng trên Postgres (DB dev).
// Hai hằng DAMAGED_LOSS_WHERE_SQL / DAMAGED_LOSS_AMOUNT_SQL là thứ báo cáo thật
// dùng (services/order-ledger.ts ledgerDamagedLoss); kiểm bằng bảng VALUES nên
// không phụ thuộc dữ liệu có sẵn. Không nối được DB → cả file tự BỎ QUA.
// docs/DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md mục 5.7 + 10
// ============================================================

import "./load-env";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { DAMAGED_LOSS_AMOUNT_SQL, DAMAGED_LOSS_WHERE_SQL } from "../../lib/damaged-loss";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();

/** [mã ca, returnStatus, returnType, costSnapshot, returnLossCost] */
const CASES: [string, string, string | null, number, number][] = [
  ["hong-ca-don", "DAMAGED", "FULL_RETURN", 140_000, 140_000],
  // Trả một phần: chỉ phần bị trả (45k), không tính phần khách giữ và đã trả tiền.
  ["hong-mot-phan", "DAMAGED", "PARTIAL_RETURN", 90_000, 45_000],
  // Đơn sàn đã hủy (giao thất bại) kiện về hỏng: sổ không bóc thất thu đơn hủy → cả đơn.
  ["hong-don-san-huy", "DAMAGED", null, 130_000, 0],
  ["xoa-so", "WRITTEN_OFF", "FULL_RETURN", 80_000, 80_000],
  // Không phải thất thu: nguyên vẹn, đang chờ về, đã nhận, đã được đền, đơn thường.
  ["nhap-kho", "RECEIVED_INTACT", "FULL_RETURN", 0, 0],
  ["cho-ve", "AWAITING", "FULL_RETURN", 70_000, 70_000],
  ["da-nhan", "RECEIVED", "FULL_RETURN", 0, 0],
  ["da-den", "CLAIM_SETTLED", "FULL_RETURN", 0, 0],
  ["don-thuong", "NONE", null, 60_000, 0],
];

describe.skipIf(!dbReady)("Thất thu hàng mất/hỏng — luật SQL trên Postgres", () => {
  it("chỉ đơn kho báo hỏng / xóa sổ được tính; đúng số từng ca", async () => {
    const values = Prisma.join(
      CASES.map(
        ([k, rs, rt, cost, loss]) =>
          Prisma.sql`(${k}, ${rs}, ${rt}::text, ${cost}::numeric, ${loss}::numeric)`
      )
    );
    const rows = await prisma.$queryRaw<{ k: string; v: unknown }[]>(Prisma.sql`
      SELECT k, ${Prisma.raw(DAMAGED_LOSS_AMOUNT_SQL)} AS v
      FROM (VALUES ${values}) AS t(k, "returnStatus", "returnType", "costSnapshot", "returnLossCost")
      WHERE ${Prisma.raw(DAMAGED_LOSS_WHERE_SQL)}
      ORDER BY k
    `);
    expect(Object.fromEntries(rows.map((r) => [r.k, Number(r.v)]))).toEqual({
      "hong-ca-don": 140_000,
      "hong-don-san-huy": 130_000,
      "hong-mot-phan": 45_000,
      "xoa-so": 80_000,
    });
  });
});
