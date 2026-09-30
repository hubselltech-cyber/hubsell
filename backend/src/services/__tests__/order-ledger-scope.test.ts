// ============================================================
// ledgerScopeSql — mảnh WHERE dùng chung của mọi câu đọc sổ cái. Logic thuần, KHÔNG DB.
//   · Mặc định (từ 30/09/2026 tối): mốc kỳ viết dạng hằng trên tham số số
//     nguyên, không còn ép kiểu từ chuỗi ở từng dòng quét.
//   · Cách cũ ("text", đường lui env LEDGER_SCOPE_PARAMS=text): câu chữ + tham số
//     GIỮ NGUYÊN như bản đã so khớp prod.
// Hai cách ra cùng giá trị trên database thật: integrations/__tests__/order-ledger-params-db.test.ts.
// ============================================================

import { describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { ledgerScopeSql, withLedgerParamStyle } from "../order-ledger";

const range = { gte: new Date("2026-08-31T17:00:00.000Z"), lte: new Date("2026-09-30T10:15:30.123Z") };
const asText = <T>(fn: () => T) => withLedgerParamStyle("text", async () => fn());

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

  it("cách cũ (đường lui): câu chữ và tham số như trước — chuỗi ISO ép ::timestamp, khóa ngày VN ép ::date", async () => {
    const q = await asText(() =>
      ledgerScopeSql({ userId: "u1", id: "c1", channelName: ChannelName.SHOPEE }, range, { alias: "l" })
    );
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
    const many = await asText(() =>
      ledgerScopeSql({ userId: "u1", id: { in: ["c1", "c2"] } }, range, { axis: "delivered" })
    );
    expect(many.sql).toBe(
      `"ownerId" = ? AND "channelId" IN (?,?)` +
        ` AND "deliveredAt" >= ?::timestamp AND "deliveredAt" <= ?::timestamp` +
        ` AND "deliveredDate" >= ?::date AND "deliveredDate" <= ?::date`
    );
  });

  it("withLedgerParamStyle trả lại cách đang dùng sau khi chạy xong, kể cả khi lỗi", async () => {
    const before = ledgerScopeSql({ userId: "u1" }, range).sql;
    await expect(
      withLedgerParamStyle("text", async () => {
        throw new Error("thử");
      })
    ).rejects.toThrow("thử");
    expect(ledgerScopeSql({ userId: "u1" }, range).sql).toBe(before);
  });

  it("không kỳ / không gian: không phụ thuộc cách viết mốc", () => {
    expect(ledgerScopeSql({ userId: "u1", id: { in: [] } }, undefined).sql).toBe(`"ownerId" = ? AND FALSE`);
    expect(ledgerScopeSql({ userId: "u1" }, undefined).sql).toBe(`"ownerId" = ?`);
  });
});
