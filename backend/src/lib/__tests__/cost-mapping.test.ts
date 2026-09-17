import { describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import {
  buildRuleMatcher,
  countPlan,
  groupSkusByCode,
  normalizeSkuCode,
  planMapping,
  type MappingTarget,
} from "../cost-mapping";

function target(over: Partial<MappingTarget> & { skuId: string; sku: string }): MappingTarget {
  return {
    channelId: "ch1",
    channelName: ChannelName.SHOPEE,
    shopName: "Gian test",
    productName: "SP",
    variantName: null,
    imageUrl: null,
    productId: null,
    currentCost: 0,
    ...over,
  };
}

describe("normalizeSkuCode", () => {
  it("coi chữ tổ hợp (NFD) và dựng sẵn (NFC) là một", () => {
    const nfd = "tbsa01-Vàng".normalize("NFD");
    expect(nfd).not.toBe("tbsa01-Vàng".normalize("NFC"));
    expect(normalizeSkuCode(`  ${nfd} `)).toBe("TBSA01-VÀNG");
  });
});

describe("buildRuleMatcher", () => {
  const match = buildRuleMatcher(
    [
      { code: "TBSA01", cost: 52000 },
      { code: "TBSA01-VÀNG", cost: 55000 },
      { code: "LT050-TRẮNG-5-6KG", cost: 40000 },
    ]
  );

  it("mã đầy đủ thắng mã mẫu", () => {
    expect(match("lt050-trắng-5-6kg")).toEqual({
      code: "LT050-TRẮNG-5-6KG",
      cost: 40000,
      kind: "exact",
    });
  });

  it("tiền tố dài thắng tiền tố ngắn", () => {
    expect(match("TBSA01-Vàng-XXL")?.cost).toBe(55000);
    expect(match("TBSA01-Đen-M")).toEqual({ code: "TBSA01", cost: 52000, kind: "prefix" });
  });

  it("tiền tố phải dừng ở dấu ngăn cách — TBSA01 không ăn TBSA010", () => {
    expect(match("TBSA010-Đen")).toBeNull();
    expect(match("TBSA01X")).toBeNull();
    expect(match("TBSA01 Đen")?.code).toBe("TBSA01");
    expect(match("TBSA01_Đen")?.code).toBe("TBSA01");
  });
});

describe("planMapping", () => {
  const match = buildRuleMatcher([{ code: "A1", cost: 100 }]);

  it("phân loại điền / trùng / xung đột / không khớp", () => {
    const plan = planMapping(
      [
        target({ skuId: "1", sku: "A1-M" }),
        target({ skuId: "2", sku: "A1-L", currentCost: 100 }),
        target({ skuId: "3", sku: "A1-XL", currentCost: 90 }),
        target({ skuId: "4", sku: "B2" }),
        // Không khớp nhưng đã có giá → không phải việc cần xử lý
        target({ skuId: "5", sku: "C3", currentCost: 70 }),
      ],
      match
    );
    expect(plan.rows.map((r) => [r.skuId, r.status])).toEqual([
      ["1", "fill"],
      ["2", "same"],
      ["3", "conflict"],
    ]);
    expect(plan.unmatched.map((t) => t.skuId)).toEqual(["4"]);
    expect(countPlan(plan)).toEqual({
      matched: 3,
      fill: 1,
      same: 1,
      conflict: 1,
      ambiguous: 0,
      unmatched: 1,
    });
  });

  it("một sản phẩm gốc khớp ra hai giá → ambiguous, không đoán", () => {
    const two = buildRuleMatcher(
      [
        { code: "A1", cost: 100 },
        { code: "Z9", cost: 200 },
      ]
    );
    const plan = planMapping(
      [
        target({ skuId: "1", sku: "A1-M", productId: "p1" }),
        target({ skuId: "2", sku: "Z9-M", productId: "p1", channelId: "ch2" }),
        target({ skuId: "3", sku: "A1-L", productId: "p2" }),
      ],
      two
    );
    expect(plan.rows.map((r) => r.status)).toEqual(["ambiguous", "ambiguous", "fill"]);
  });
});

describe("groupSkusByCode", () => {
  it("gộp một mã trên nhiều gian, không phân biệt hoa/thường, và xếp đúng trạng thái", () => {
    const groups = groupSkusByCode([
      // suggest: gian 1 có giá, gian 2 trống
      target({ skuId: "1", sku: "A1-M", currentCost: 100, productName: "Áo A (gian 1)" }),
      target({ skuId: "2", sku: "a1-m", channelId: "ch2", productName: "Áo A (gian 2)" }),
      // conflict: hai gian hai giá
      target({ skuId: "3", sku: "B2", currentCost: 50 }),
      target({ skuId: "4", sku: "B2", channelId: "ch2", currentCost: 60 }),
      // missing
      target({ skuId: "5", sku: "C3" }),
      // complete
      target({ skuId: "6", sku: "D4", currentCost: 70 }),
      target({ skuId: "7", sku: "D4", channelId: "ch2", currentCost: 70 }),
    ]);
    expect(groups.map((g) => [g.code, g.status, g.suggestedCost, g.entries.length])).toEqual([
      ["A1-M", "suggest", 100, 2],
      ["B2", "conflict", null, 2],
      ["C3", "missing", null, 1],
      ["D4", "complete", null, 2],
    ]);
    // Tên đại diện lấy từ gian ĐÃ CÓ GIÁ
    expect(groups[0].productName).toBe("Áo A (gian 1)");
  });
});
