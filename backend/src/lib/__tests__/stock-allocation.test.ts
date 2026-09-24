import { describe, expect, it } from "vitest";
import { allocateDeduction, previewTransfer } from "../stock-allocation";

const L = (locationId: string, quantity: number, sortOrder: number, sellable = true) => ({
  locationId,
  quantity,
  sortOrder,
  sellable,
});

describe("allocateDeduction", () => {
  it("vị trí đủ cả dòng thì lấy trọn ở vị trí ưu tiên trước nhất", () => {
    expect(allocateDeduction([L("a", 3, 0), L("b", 10, 1)], 5, "a")).toEqual([
      { locationId: "b", quantity: 5 },
    ]);
    // cả hai đủ → lấy ở a vì a xếp trước
    expect(allocateDeduction([L("b", 10, 1), L("a", 10, 0)], 5, "a")).toEqual([
      { locationId: "a", quantity: 5 },
    ]);
  });

  it("không ai đủ thì trừ lần lượt theo ưu tiên", () => {
    // c đủ cả dòng 8 → lấy trọn ở c dù c xếp sau (luật "đủ cả dòng" thắng thứ tự)
    expect(allocateDeduction([L("a", 3, 0), L("b", 4, 1), L("c", 9, 2)], 8, "a")).toEqual([
      { locationId: "c", quantity: 8 },
    ]);
    // không ai đủ 10 → a 3, b 4, c 3 theo thứ tự
    expect(allocateDeduction([L("a", 3, 0), L("b", 4, 1), L("c", 9, 2)], 10, "a")).toEqual([
      { locationId: "a", quantity: 3 },
      { locationId: "b", quantity: 4 },
      { locationId: "c", quantity: 3 },
    ]);
  });

  it("thiếu toàn kho → phần thiếu dồn vào vị trí cuối cùng đã đụng (tồn âm lộ bán vượt)", () => {
    expect(allocateDeduction([L("a", 2, 0), L("b", 1, 1)], 5, "a")).toEqual([
      { locationId: "a", quantity: 2 },
      { locationId: "b", quantity: 3 },
    ]);
  });

  it("không có hàng ở đâu → trừ ở vị trí gốc", () => {
    expect(allocateDeduction([], 2, "root")).toEqual([{ locationId: "root", quantity: 2 }]);
    expect(allocateDeduction([L("a", 0, 0)], 2, "root")).toEqual([
      { locationId: "root", quantity: 2 },
    ]);
  });

  it("bỏ qua vị trí không bán", () => {
    expect(allocateDeduction([L("bad", 50, 0, false), L("a", 5, 1)], 5, "a")).toEqual([
      { locationId: "a", quantity: 5 },
    ]);
  });

  it("qty 0 → không phân bổ", () => {
    expect(allocateDeduction([L("a", 5, 0)], 0, "a")).toEqual([]);
  });
});

describe("previewTransfer", () => {
  it("tính số cũ → mới hai đầu và cờ thiếu", () => {
    expect(previewTransfer(40, 15, 10)).toEqual({
      from: { before: 40, after: 30 },
      to: { before: 15, after: 25 },
      insufficient: false,
    });
    expect(previewTransfer(4, 0, 10).insufficient).toBe(true);
  });
});
