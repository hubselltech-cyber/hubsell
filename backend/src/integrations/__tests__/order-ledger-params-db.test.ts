// ============================================================
// SỔ CÁI ĐƠN trên DB dev: mọi câu đọc sổ cho kết quả GIỐNG HỆT ở hai cách viết
// mốc kỳ — chuỗi ép ::timestamp / ::date (cách cũ, đường lui) và mốc dạng hằng
// trên tham số số nguyên (mặc định từ 30/09/2026 tối). Dữ liệu thật của DB dev,
// mọi chủ shop và mọi gian. Chưa áp migration sổ cái → cả file tự BỎ QUA.
// ============================================================

import "./load-env";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { dateConst, ensureLedgerFresh, timestampConst } from "../../services/order-ledger";
import { compareLedgerParamStyles, defaultCompareRanges } from "../../services/order-ledger-params-compare";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ledgerReady) {
  console.log("[order-ledger-params-db.test] BỎ QUA: DB dev chưa có bảng order_ledger");
}

describe.skipIf(!ledgerReady)("Sổ cái đơn — mốc kỳ dạng hằng = mốc ép kiểu từ chuỗi, trên DB dev", () => {
  it("mốc dạng hằng bằng mốc ép kiểu từ chuỗi, tới từng mili giây", async () => {
    const moments = [
      new Date("2026-09-30T10:15:30.123Z"),
      new Date("2026-08-31T17:00:00.000Z"), // 00:00 ngày 01/09 giờ VN
      new Date("2024-02-29T16:59:59.999Z"), // năm nhuận, sát nửa đêm giờ VN
      new Date("1999-12-31T23:59:59.001Z"),
      new Date("1969-12-31T23:59:59.999Z"), // trước mốc 1970
      new Date("2038-01-19T03:14:08.000Z"),
    ];
    for (const d of moments) {
      const r = await prisma.$queryRaw<{ same: boolean }[]>(
        Prisma.sql`SELECT ${timestampConst(d)} = ${d.toISOString()}::timestamp AS same`
      );
      expect(r[0].same, d.toISOString()).toBe(true);
    }
    for (const key of ["2026-09-01", "2026-09-30", "2024-02-29", "1970-01-01", "1969-12-31", "2038-01-19"]) {
      const r = await prisma.$queryRaw<{ same: boolean }[]>(
        Prisma.sql`SELECT ${dateConst(key)} = ${key}::date AS same`
      );
      expect(r[0].same, key).toBe(true);
    }
  });

  it("mọi chủ shop × 6 kỳ và mọi gian × 2 kỳ: từng câu đọc trả kết quả giống hệt", { timeout: 600_000 }, async () => {
    const channels = await prisma.channel.findMany({
      select: { id: true, userId: true, channelName: true, shopName: true },
      orderBy: [{ userId: "asc" }, { id: "asc" }],
    });
    const owners = [...new Set(channels.map((c) => c.userId))];
    for (const userId of owners) {
      const fresh = await ensureLedgerFresh({ userId }, undefined, { maxInline: 20_000 });
      expect(fresh.dirty, `${userId} còn dòng bẩn`).toBe(0);
    }
    const ranges = defaultCompareRanges();
    let probes = 0;
    for (const userId of owners) {
      const r = await compareLedgerParamStyles({ userId }, ranges, { label: userId });
      expect(r.mismatches, `chủ shop ${userId}`).toEqual([]);
      probes += r.probes;
    }
    const channelRanges = ranges.filter((r) => r.label === "thangnay" || r.label === "400ngay");
    for (const ch of channels) {
      const r = await compareLedgerParamStyles(
        { userId: ch.userId, id: ch.id, channelName: ch.channelName },
        channelRanges,
        { channel: ch, label: ch.shopName }
      );
      expect(r.mismatches, `gian ${ch.shopName}`).toEqual([]);
      probes += r.probes;
    }
    expect(probes).toBeGreaterThan(0);
  });

  it("các kỳ mặc định: biên theo ngày giờ VN, tháng trước đúng trọn tháng kể cả qua năm", () => {
    const ranges = new Map(defaultCompareRanges(new Date("2026-01-15T03:00:00Z")).map((r) => [r.label, r.range]));
    // 00:00 ngày 01/12/2025 giờ VN = 17:00 ngày 30/11 UTC; hết 31/12 giờ VN = 16:59:59.999 ngày 31/12 UTC.
    expect(ranges.get("thangtruoc")!.gte.toISOString()).toBe("2025-11-30T17:00:00.000Z");
    expect(ranges.get("thangtruoc")!.lte.toISOString()).toBe("2025-12-31T16:59:59.999Z");
    expect(ranges.get("thangnay")!.gte.toISOString()).toBe("2025-12-31T17:00:00.000Z");
    expect(ranges.get("quynay")!.gte.toISOString()).toBe("2025-12-31T17:00:00.000Z");
    expect(ranges.get("7ngay")!.gte.toISOString()).toBe("2026-01-08T17:00:00.000Z");
    expect(ranges.get("7ngay")!.lte.toISOString()).toBe("2026-01-15T16:59:59.999Z");
  });
});
