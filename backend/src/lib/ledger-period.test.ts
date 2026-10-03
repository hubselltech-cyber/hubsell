import { describe, expect, it } from "vitest";

import { parseLedgerPeriod } from "./ledger-period";

describe("parseLedgerPeriod", () => {
  it("from/to trọn một tháng → nhận ra tháng, cắt mốc theo giờ VN", () => {
    const p = parseLedgerPeriod({ from: "2026-10-01", to: "2026-10-31" });
    expect(p.month).toBe("2026-10");
    expect(p.from).toBe("2026-10-01");
    expect(p.to).toBe("2026-10-31");
    // 00:00 ngày 01/10 giờ VN = 17:00 UTC ngày 30/09
    expect(p.range.gte.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(p.range.lte.toISOString()).toBe("2026-10-31T16:59:59.999Z");
  });

  it("quý / năm / khoảng lẻ → month = null", () => {
    expect(parseLedgerPeriod({ from: "2026-10-01", to: "2026-12-31" }).month).toBeNull();
    expect(parseLedgerPeriod({ from: "2026-01-01", to: "2026-12-31" }).month).toBeNull();
    expect(parseLedgerPeriod({ from: "2026-10-01", to: "2026-10-15" }).month).toBeNull();
    expect(parseLedgerPeriod({ from: "2026-10-02", to: "2026-10-31" }).month).toBeNull();
  });

  it("tháng 2 năm nhuận và năm thường", () => {
    expect(parseLedgerPeriod({ from: "2028-02-01", to: "2028-02-29" }).month).toBe("2028-02");
    expect(parseLedgerPeriod({ from: "2028-02-01", to: "2028-02-28" }).month).toBeNull();
    expect(parseLedgerPeriod({ from: "2027-02-01", to: "2027-02-28" }).month).toBe("2027-02");
  });

  it("chọn ngược thì tự đảo", () => {
    const p = parseLedgerPeriod({ from: "2026-10-31", to: "2026-10-01" });
    expect(p.from).toBe("2026-10-01");
    expect(p.to).toBe("2026-10-31");
    expect(p.month).toBe("2026-10");
  });

  it("tham số month đời đầu vẫn chạy", () => {
    const p = parseLedgerPeriod({ month: "2026-09" });
    expect(p.month).toBe("2026-09");
    expect(p.from).toBe("2026-09-01");
    expect(p.to).toBe("2026-09-30");
  });

  it("không tham số → tháng hiện tại theo giờ VN", () => {
    // 30/09 18:00 UTC = 01/10 01:00 giờ VN → phải là tháng 10
    const p = parseLedgerPeriod({}, new Date("2026-09-30T18:00:00.000Z"));
    expect(p.month).toBe("2026-10");
  });

  it("from/to sai định dạng → lùi về tháng hiện tại", () => {
    const p = parseLedgerPeriod(
      { from: "2026-02-31", to: "abc" },
      new Date("2026-10-03T05:00:00.000Z")
    );
    expect(p.month).toBe("2026-10");
  });
});
