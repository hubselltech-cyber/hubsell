// ledgerScopeSql — mảnh WHERE dùng chung của mọi báo cáo trên sổ cái.
//   · Không bật `constParams`: câu chữ + tham số GIỮ NGUYÊN như trước 30/09/2026
//     (mọi báo cáo đã so khớp prod đang chạy bằng đúng mảnh này).
//   · Bật `constParams` (câu gom biên lãi quảng cáo): mốc kỳ viết dạng hằng, và
//     trên database thật phải ra ĐÚNG giá trị của cách ép kiểu từ chuỗi.
import "../../integrations/__tests__/load-env";
import { describe, expect, it } from "vitest";
import { ChannelName, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { dateConst, ledgerScopeSql, timestampConst } from "../order-ledger";

const range = { gte: new Date("2026-08-31T17:00:00.000Z"), lte: new Date("2026-09-30T10:15:30.123Z") };

describe("ledgerScopeSql", () => {
  it("mặc định: câu chữ và tham số như cũ (chuỗi ISO ép ::timestamp, khóa ngày VN ép ::date)", () => {
    const q = ledgerScopeSql({ userId: "u1", id: "c1", channelName: ChannelName.SHOPEE }, range, { alias: "l" });
    expect(q.sql).toBe(
      `l."ownerId" = ? AND l."channelId" = ? AND l."channelName" = ?::"ChannelName"` +
        ` AND l."createdAt" >= ?::timestamp AND l."createdAt" <= ?::timestamp` +
        ` AND l."createdDate" >= ?::date AND l."createdDate" <= ?::date`
    );
    expect(q.values).toEqual([
      "u1",
      "c1",
      "SHOPEE",
      "2026-08-31T17:00:00.000Z",
      "2026-09-30T10:15:30.123Z",
      "2026-09-01",
      "2026-09-30",
    ]);
  });

  it("mặc định: nhiều gian, trục ngày giao, không kỳ", () => {
    const many = ledgerScopeSql({ userId: "u1", id: { in: ["c1", "c2"] } }, range, { axis: "delivered" });
    expect(many.sql).toBe(
      `"ownerId" = ? AND "channelId" IN (?,?)` +
        ` AND "deliveredAt" >= ?::timestamp AND "deliveredAt" <= ?::timestamp` +
        ` AND "deliveredDate" >= ?::date AND "deliveredDate" <= ?::date`
    );
    expect(ledgerScopeSql({ userId: "u1", id: { in: [] } }, undefined).sql).toBe(`"ownerId" = ? AND FALSE`);
    expect(ledgerScopeSql({ userId: "u1" }, undefined).sql).toBe(`"ownerId" = ?`);
  });

  it("constParams: mốc kỳ là biểu thức trên số nguyên, không còn ép kiểu từ chuỗi", () => {
    const q = ledgerScopeSql({ userId: "u1", id: "c1" }, range, { alias: "l", constParams: true });
    expect(q.sql).not.toContain("::timestamp");
    expect(q.sql).not.toContain("::date");
    expect(q.values).toEqual([
      "u1",
      "c1",
      BigInt(range.gte.getTime()),
      BigInt(range.lte.getTime()),
      20697, // 2026-09-01
      20726, // 2026-09-30
    ]);
  });

  it("constParams trên database: cùng giá trị với cách ép kiểu từ chuỗi, tới từng mili giây", async () => {
    const moments = [
      new Date("2026-09-30T10:15:30.123Z"),
      new Date("2026-08-31T17:00:00.000Z"), // 00:00 ngày 01/09 giờ VN
      new Date("2024-02-29T16:59:59.999Z"), // năm nhuận, sát nửa đêm giờ VN
      new Date("1999-12-31T23:59:59.001Z"),
      new Date("2038-01-19T03:14:08.000Z"),
    ];
    for (const d of moments) {
      const r = await prisma.$queryRaw<{ same: boolean }[]>(
        Prisma.sql`SELECT ${timestampConst(d)} = ${d.toISOString()}::timestamp AS same`
      );
      expect(r[0].same, d.toISOString()).toBe(true);
    }
    for (const key of ["2026-09-01", "2026-09-30", "2024-02-29", "1970-01-01", "2038-01-19"]) {
      const r = await prisma.$queryRaw<{ same: boolean }[]>(
        Prisma.sql`SELECT ${dateConst(key)} = ${key}::date AS same`
      );
      expect(r[0].same, key).toBe(true);
    }
  });
});
