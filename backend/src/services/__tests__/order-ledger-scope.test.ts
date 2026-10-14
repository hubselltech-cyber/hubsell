// ============================================================
// ledgerScopeSql — mảnh WHERE dùng chung của mọi câu đọc sổ cái. Logic thuần, KHÔNG DB.
// Mốc kỳ viết dạng hằng trên tham số số nguyên (từ 30/09/2026 tối), không ép
// kiểu từ chuỗi ở từng dòng quét. Cách cũ chuỗi ép kiểu và công tắc
// LEDGER_SCOPE_PARAMS đã gỡ 14/10/2026 (so prod 2.976 lượt 0 lệch trước đó).
// ============================================================

import { describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { ledgerScopeSql } from "../order-ledger";

const range = { gte: new Date("2026-08-31T17:00:00.000Z"), lte: new Date("2026-09-30T10:15:30.123Z") };

describe("ledgerScopeSql", () => {
  it("mặc định: mốc kỳ là biểu thức trên số nguyên, không còn ép kiểu từ chuỗi", () => {
    const q = ledgerScopeSql({ userId: "u1", id: "c1", channelName: ChannelName.SHOPEE }, range, { alias: "l" });
    expect(q.sql).toBe(
      `l."ownerId" = ? AND l."channelId" = ? AND l."channelName" = ?::"ChannelName"` +
        ` AND l."createdAt" >= (TIMESTAMP '1970-01-01 00:00:00' + ? * INTERVAL '1 millisecond')` +
        ` AND l."createdAt" <= (TIMESTAMP '1970-01-01 00:00:00' + ? * INTERVAL '1 millisecond')` +
        ` AND l."createdDate" >= (DATE '1970-01-01' + ?::int) AND l."createdDate" <= (DATE '1970-01-01' + ?::int)`
    );
    expect(q.values).toEqual([
      "u1",
      "c1",
      "SHOPEE",
      BigInt(range.gte.getTime()),
      BigInt(range.lte.getTime()),
      20697, // 2026-09-01
      20726, // 2026-09-30
    ]);
  });

  it("nhiều gian + trục ngày giao: đúng cột và đủ mốc", () => {
    const many = ledgerScopeSql({ userId: "u1", id: { in: ["c1", "c2"] } }, range, { axis: "delivered" });
    expect(many.sql).toBe(
      `"ownerId" = ? AND "channelId" IN (?,?)` +
        ` AND "deliveredAt" >= (TIMESTAMP '1970-01-01 00:00:00' + ? * INTERVAL '1 millisecond')` +
        ` AND "deliveredAt" <= (TIMESTAMP '1970-01-01 00:00:00' + ? * INTERVAL '1 millisecond')` +
        ` AND "deliveredDate" >= (DATE '1970-01-01' + ?::int) AND "deliveredDate" <= (DATE '1970-01-01' + ?::int)`
    );
  });

  it("không kỳ / không gian: không có mốc", () => {
    expect(ledgerScopeSql({ userId: "u1", id: { in: [] } }, undefined).sql).toBe(`"ownerId" = ? AND FALSE`);
    expect(ledgerScopeSql({ userId: "u1" }, undefined).sql).toBe(`"ownerId" = ?`);
  });
});
