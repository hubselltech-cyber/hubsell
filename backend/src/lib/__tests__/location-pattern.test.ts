import { describe, expect, it } from "vitest";
import { codeFromName, expandLocationPattern, PATTERN_MAX } from "../location-pattern";

describe("expandLocationPattern", () => {
  it("dải số, dải chữ, số 0 đầu", () => {
    expect(expandLocationPattern("Kệ A[1-3]")).toEqual({ ok: true, names: ["Kệ A1", "Kệ A2", "Kệ A3"] });
    expect(expandLocationPattern("Dãy [A-C]")).toEqual({ ok: true, names: ["Dãy A", "Dãy B", "Dãy C"] });
    expect(expandLocationPattern("Ô [08-10]")).toEqual({ ok: true, names: ["Ô 08", "Ô 09", "Ô 10"] });
  });

  it("nhiều dải = tích Descartes, giữ thứ tự dải trước chạy chậm", () => {
    const r = expandLocationPattern("Kệ [A-B][1-2]");
    expect(r).toEqual({ ok: true, names: ["Kệ A1", "Kệ A2", "Kệ B1", "Kệ B2"] });
  });

  it("không dải → một tên", () => {
    expect(expandLocationPattern("Kho lạnh")).toEqual({ ok: true, names: ["Kho lạnh"] });
  });

  it("báo lỗi mẫu sai và quá trần", () => {
    expect(expandLocationPattern("").ok).toBe(false);
    expect(expandLocationPattern("Kệ [1-").ok).toBe(false);
    expect(expandLocationPattern("Kệ [5-1]").ok).toBe(false);
    expect(expandLocationPattern("Kệ [a-9]").ok).toBe(false);
    const big = expandLocationPattern(`Kệ [1-${PATTERN_MAX + 1}]`);
    expect(big.ok).toBe(false);
  });
});

describe("codeFromName", () => {
  it("bỏ dấu, in hoa, gạch nối", () => {
    expect(codeFromName("Kệ A1")).toBe("KE-A1");
    expect(codeFromName("Kho Bình Tân")).toBe("KHO-BINH-TAN");
    expect(codeFromName("Hàng hoàn chờ kiểm")).toBe("HANG-HOAN-CHO-KIEM");
    expect(codeFromName("Đ")).toBe("D");
    expect(codeFromName("***")).toBe("");
  });
});
