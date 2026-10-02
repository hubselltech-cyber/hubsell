// ============================================================
// QUY TẮC GHI SAO KÊ CỦA MỘT ĐƠN (dùng chung TikTok / Lazada) — hàm thuần.
//
// Sao kê của đơn = tổng mọi dòng ở mọi "mảnh" của sàn (TikTok: bản kê; Lazada:
// ngày giao dịch). Lượt quét hẹp chỉ thấy một phần các mảnh nên không được ghi
// đè bằng riêng phần nó thấy — sự cố 02/10/2026: 43 đơn TikTok mất dòng bán.
// ============================================================

import { describe, expect, it } from "vitest";
import { lazadaDayOfKey, lazadaLineDayKeys } from "../lazada/service";
import { planSettlementWrite } from "../settlement-merge";

describe("planSettlementWrite — mảnh là bản kê (TikTok)", () => {
  it("chưa có sao kê / lượt này thấy đủ mọi bản kê đã biết → ghi từ dòng đang có", () => {
    expect(planSettlementWrite([], ["S1"])).toEqual({ action: "write", missing: [], all: ["S1"] });
    expect(planSettlementWrite(["S1"], ["S1"])).toMatchObject({ action: "write", all: ["S1"] });
    expect(planSettlementWrite(["S1"], ["S2", "S1"])).toEqual({ action: "write", missing: [], all: ["S1", "S2"] });
  });

  it("có bản kê MỚI mà bản kê đã biết nằm ngoài lượt → phải đọc lại bản kê cũ rồi cộng", () => {
    expect(planSettlementWrite(["S1"], ["S2"])).toEqual({ action: "merge", missing: ["S1"], all: ["S1", "S2"] });
    expect(planSettlementWrite(["S1", "S2"], ["S2", "S3"])).toEqual({
      action: "merge",
      missing: ["S1"],
      all: ["S1", "S2", "S3"],
    });
  });

  it("không có bản kê mới, lượt này chỉ thấy một phần → không ghi (ghi là mất dòng)", () => {
    expect(planSettlementWrite(["S1", "S2"], ["S2"])).toMatchObject({ action: "skip", missing: ["S1"] });
  });
});

describe("planSettlementWrite — mảnh là ngày giao dịch, khóa kèm số dòng (Lazada)", () => {
  const plan = (known: string[], seen: string[]) => planSettlementWrite(known, seen, lazadaDayOfKey);

  it("khóa ngày: gom số dòng theo ngày, tách lại được ngày", () => {
    const days = new Map([
      ["20 Sep 2026", 2],
      ["01 Sep 2026", 6],
    ]);
    expect(lazadaLineDayKeys(days)).toEqual(["01 Sep 2026#6", "20 Sep 2026#2"]);
    expect(lazadaDayOfKey("01 Sep 2026#6")).toBe("01 Sep 2026");
    expect(lazadaDayOfKey("?#3")).toBe("?");
  });

  it("mọi ngày đã biết đều nằm trong cửa sổ → ghi từ dòng cửa sổ, kể cả khi sàn vừa ghi thêm dòng cùng ngày", () => {
    expect(plan(["30 Sep 2026#2"], ["30 Sep 2026#2"]).action).toBe("write");
    expect(plan(["30 Sep 2026#2"], ["30 Sep 2026#5"]).action).toBe("write");
    expect(plan(["30 Sep 2026#2"], ["30 Sep 2026#2", "01 Oct 2026#1"]).action).toBe("write");
  });

  it("có ngày đã biết nằm ngoài cửa sổ + cửa sổ có dòng mới → phải đọc trọn giao dịch của đơn", () => {
    expect(plan(["01 Sep 2026#6"], ["30 Sep 2026#2"])).toMatchObject({ action: "merge", missing: ["01 Sep 2026"] });
    // Ngày trong cửa sổ đã biết nhưng số dòng tăng → vẫn là có dòng mới.
    expect(plan(["01 Sep 2026#6", "30 Sep 2026#2"], ["30 Sep 2026#3"]).action).toBe("merge");
  });

  it("có ngày đã biết nằm ngoài cửa sổ, phần trong cửa sổ không đổi → không ghi", () => {
    expect(plan(["01 Sep 2026#6", "30 Sep 2026#2"], ["30 Sep 2026#2"]).action).toBe("skip");
  });
});
