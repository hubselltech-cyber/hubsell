import { describe, expect, it } from "vitest";
import { gmvMaxDailyTotals } from "../tiktok-ads/sync";

describe("gmvMaxDailyTotals — Σ cost chiến dịch GMV Max theo ngày → AdSpend", () => {
  it("cộng mọi chiến dịch cùng ngày, giữ ngày 0 đồng, sắp theo ngày, bỏ dòng thiếu ngày", () => {
    const totals = gmvMaxDailyTotals([
      { date: "2026-09-26", cost: 300_000 },
      { date: "2026-09-25", cost: 0 },
      { date: "2026-09-26", cost: 243_529 },
      { date: "", cost: 999 },
      { date: "2026-09-24", cost: Number.NaN },
    ]);
    expect([...totals.entries()]).toEqual([
      ["2026-09-24", 0],
      ["2026-09-25", 0],
      ["2026-09-26", 543_529],
    ]);
  });
});
