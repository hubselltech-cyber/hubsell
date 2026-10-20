import { describe, expect, it } from "vitest";
import { tiktokAdSpendByDay } from "../tiktok-ads/sync";

describe("tiktokAdSpendByDay — AdSpend theo ngày lấy Σ chiến dịch trong DB", () => {
  it("số tiền lấy từ DB, ngày = hợp ngày báo cáo + ngày DB, sắp tăng dần, bỏ dòng thiếu ngày", () => {
    const out = tiktokAdSpendByDay(
      [{ date: "2026-09-26" }, { date: "2026-09-25" }, { date: "" }],
      new Map([
        ["2026-09-26", 543_529],
        ["2026-09-24", Number.NaN],
      ])
    );
    expect([...out.entries()]).toEqual([
      ["2026-09-24", 0],
      ["2026-09-25", 0],
      ["2026-09-26", 543_529],
    ]);
  });

  it("chiến dịch đã XÓA (sàn không trả nữa) vẫn giữ tiền: dòng 0₫ của chiến dịch còn sống không đè về 0", () => {
    // Ca 69Minh Đương 20/10: chiến dịch 13/10 bị xóa → báo cáo chỉ còn dòng 0₫ của chiến dịch 09/10 ngày 13–18,
    // còn DB vẫn giữ số của chiến dịch đã xóa.
    const reportRows = [
      { date: "2026-10-13" },
      { date: "2026-10-14" },
      { date: "2026-10-19" },
    ];
    const db = new Map([
      ["2026-10-13", 580_472],
      ["2026-10-14", 1_165_503],
      ["2026-10-19", 1_154_353],
    ]);
    expect([...tiktokAdSpendByDay(reportRows, db).entries()]).toEqual([
      ["2026-10-13", 580_472],
      ["2026-10-14", 1_165_503],
      ["2026-10-19", 1_154_353],
    ]);
  });

  it("ngày chỉ có trong DB (sàn không trả dòng nào) vẫn được ghi", () => {
    expect([...tiktokAdSpendByDay([], new Map([["2026-10-15", 1_296_167]])).entries()]).toEqual([["2026-10-15", 1_296_167]]);
  });
});
