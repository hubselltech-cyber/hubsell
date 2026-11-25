// ============================================================
// Hạn khiếu nại: biểu thức SQL (thẻ lọc + sắp xếp) PHẢI cho đúng cùng hạn với hàm thuần
// complaintDueOf (ô hiển thị) trên MỌI tổ hợp cột — lệch là thẻ "Sắp hết hạn" đếm một đằng,
// ô hiện một nẻo. Không ghi database: các ca đi qua jsonb_to_recordset rồi tính trong Postgres.
// Không nối được DB → tự BỎ QUA.
// ============================================================

import "../../integrations/__tests__/load-env";
import { describe, expect, it } from "vitest";
import { Prisma, ReturnStatus } from "@prisma/client";
import { CANCELLED_AFTER_SHIP } from "../../integrations/cancelled-after-ship";
import { prisma } from "../prisma";
import { complaintDueOf } from "../return-complaint-due";
import { complaintDueCandidateSql, complaintDueSql } from "../return-complaint-due-sql";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();

const T0 = new Date("2026-11-20T05:00:00.000Z");
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);

describe.skipIf(!dbReady)("complaintDueSql khớp complaintDueOf", () => {
  it("mọi tổ hợp sàn × tình trạng kho × mốc × trạng thái sàn", async () => {
    const cases: Parameters<typeof complaintDueOf>[0][] = [];
    for (const platform of ["SHOPEE", "TIKTOK", "LAZADA", "KHAC"])
      for (const returnStatus of Object.values(ReturnStatus))
        for (const stored of [null, at(30)])
          for (const returnedAt of [null, at(5)])
            for (const returnDeliveredAt of [null, at(2), at(5), at(9)])
              for (const platformReturnStatus of [null, CANCELLED_AFTER_SHIP, "RTM_RECEIVE_ITEM", "BUYER_SHIPPED_ITEM"])
                cases.push({
                  platform,
                  returnStatus,
                  returnedAt,
                  returnDeliveredAt,
                  platformReturnStatus,
                  returnTrackingCode: null,
                  returnComplaintDueAt: stored,
                  returnComplaintDueProvisional: false,
                });

    const json = JSON.stringify(
      cases.map((c, idx) => ({
        idx,
        channelName: c.platform,
        returnStatus: c.returnStatus,
        returnedAt: c.returnedAt?.toISOString() ?? null,
        returnDeliveredAt: c.returnDeliveredAt?.toISOString() ?? null,
        platformReturnStatus: c.platformReturnStatus,
        returnComplaintDueAt: c.returnComplaintDueAt?.toISOString() ?? null,
      }))
    );
    const rows = await prisma.$queryRaw<{ idx: number; due: Date | null; candidate: boolean }[]>(Prisma.sql`
      SELECT o.idx, ${complaintDueSql("o", "o")} AS due, (${complaintDueCandidateSql("o")}) AS candidate
      FROM jsonb_to_recordset(${json}::jsonb) AS o(
        idx int, "channelName" text, "returnStatus" text, "returnedAt" timestamptz,
        "returnDeliveredAt" timestamptz, "platformReturnStatus" text, "returnComplaintDueAt" timestamptz)
      ORDER BY o.idx`);

    expect(rows).toHaveLength(cases.length);
    const mismatches = rows.filter((r) => {
      const d = complaintDueOf(cases[r.idx]);
      const expected = d.state === "DUE" ? d.dueAt.getTime() : null;
      return (r.due?.getTime() ?? null) !== expected;
    });
    expect(mismatches.map((m) => ({ ...cases[m.idx], sql: m.due }))).toEqual([]);
    // Vị từ của chỉ mục một phần không được loại đơn nào CÓ hạn (loại nhầm = đơn sắp hết hạn biến mất khỏi dải nhắc).
    expect(rows.filter((r) => r.due !== null && !r.candidate).map((r) => cases[r.idx])).toEqual([]);
    expect(rows.some((r) => !r.candidate)).toBe(true);
    // Bộ ca phải có đủ các nhánh: hạn sàn, luật, ước tính, không hạn.
    const states = new Set(cases.map((c) => {
      const d = complaintDueOf(c);
      return d.state === "DUE" ? d.source : d.state;
    }));
    expect([...states].sort()).toEqual(["NOT_NEEDED", "NOT_STARTED", "UNKNOWN", "estimate", "platform", "rule"]);
  });
});
