// ============================================================
// KHÓA SKU KHI NGƯỜI BÁN ĐẶT CHUNG MÃ CHO NHIỀU PHÂN LOẠI (15/10/2026, sự cố Hi.Bé)
// Hàm thuần: mã duy nhất giữ nguyên; mã trùng → đuôi tên phân loại; chưa có tên
// → "#id"; trùng cả tên → "(tên) #id"; thứ tự sàn trả không đổi kết quả.
// ============================================================
import { describe, expect, it } from "vitest";
import {
  baseSkuOf,
  leafIdOf,
  normalizeVariantName,
  resolveChannelSkuKeys,
  suffixedSku,
} from "../sku-key";
import type { NormalizedChannelProduct } from "../types";
import { lazadaVariantFromSaleProp } from "../adapters/lazada-adapter";

function row(over: Partial<NormalizedChannelProduct>): NormalizedChannelProduct {
  return {
    channelSku: "LT075-HONG",
    productName: "Bodysuit",
    variantName: null,
    price: 100,
    imageUrl: null,
    externalId: null,
    itemSku: null,
    channelStock: null,
    channelStockLocationId: null,
    status: "ACTIVE",
    ...over,
  };
}

describe("sku-key helpers", () => {
  it("chuẩn hoá tên phân loại: Shopee 'Hồng,3-5kg' và TikTok 'Hồng, 3-5kg' ra cùng một chuỗi", () => {
    expect(normalizeVariantName("Hồng,3-5kg")).toBe("Hồng, 3-5kg");
    expect(normalizeVariantName(" Hồng ,  3-5kg ")).toBe("Hồng, 3-5kg");
    expect(normalizeVariantName("")).toBeNull();
    expect(normalizeVariantName(null)).toBeNull();
  });

  it("id lá = đoạn sau dấu gạch cuối của externalId", () => {
    expect(leafIdOf("19996356384-147733934401")).toBe("147733934401");
    expect(leafIdOf("19996356384")).toBe("19996356384");
    expect(leafIdOf(null)).toBeNull();
  });

  it("đuôi hiển thị + lấy lại mã gốc", () => {
    expect(suffixedSku("LT075-HONG", "Hồng, 3-5kg", "1", false)).toBe("LT075-HONG (Hồng, 3-5kg)");
    expect(suffixedSku("LT075-HONG", "Hồng, 3-5kg", "1", true)).toBe("LT075-HONG (Hồng, 3-5kg) #1");
    expect(suffixedSku("LT075-HONG", null, "1", false)).toBe("LT075-HONG #1");
    expect(baseSkuOf("LT075-HONG (Hồng, 3-5kg)")).toBe("LT075-HONG");
    expect(baseSkuOf("LT075-HONG (Hồng, 3-5kg) #1")).toBe("LT075-HONG");
    expect(baseSkuOf("LT075-HONG #1")).toBe("LT075-HONG");
    expect(baseSkuOf("LT075-HONG")).toBe("LT075-HONG");
  });

  it("Lazada: tên phân loại từ saleProp theo thứ tự sàn trả", () => {
    expect(lazadaVariantFromSaleProp({ color_family: "Nâu", size: "3-5kg" })).toBe("Nâu, 3-5kg");
    expect(lazadaVariantFromSaleProp({})).toBeNull();
    expect(lazadaVariantFromSaleProp(undefined)).toBeNull();
  });
});

describe("resolveChannelSkuKeys", () => {
  it("mã duy nhất giữ nguyên, không thêm đuôi (khách khác không đổi gì)", () => {
    const r = resolveChannelSkuKeys([
      row({ channelSku: "A", externalId: "1-11", variantName: "Đỏ" }),
      row({ channelSku: "B", externalId: "1-12", variantName: "Xanh" }),
    ]);
    expect(r.suffixed).toBe(0);
    expect(r.products.map((p) => p.channelSku)).toEqual(["A", "B"]);
  });

  it("5 size cùng mã 'LT075-HONG' → 5 dòng với đuôi tên phân loại, tồn KHÔNG cộng dồn", () => {
    const sizes = ["3-5kg", "5-7kg", "7-9kg", "9-11kg", "11-13kg"];
    const r = resolveChannelSkuKeys(
      sizes.map((s, i) =>
        row({ externalId: `19996356384-${100 + i}`, variantName: `Hồng,${s}`, channelStock: 10 + i })
      )
    );
    expect(r.suffixed).toBe(5);
    expect(r.products.map((p) => p.channelSku)).toEqual(sizes.map((s) => `LT075-HONG (Hồng, ${s})`));
    expect(r.products.map((p) => p.channelStock)).toEqual([10, 11, 12, 13, 14]);
    expect(r.products.map((p) => p.externalId)).toEqual(sizes.map((_, i) => `19996356384-${100 + i}`));
  });

  it("chưa biết tên (TikTok chưa bổ sung chi tiết) → '#skuId'; có gợi ý từ DB thì dùng tên", () => {
    const rows = [
      row({ externalId: "P-1", variantName: null }),
      row({ externalId: "P-2", variantName: null }),
    ];
    expect(resolveChannelSkuKeys(rows).products.map((p) => p.channelSku)).toEqual([
      "LT075-HONG #1",
      "LT075-HONG #2",
    ]);
    const hinted = resolveChannelSkuKeys(rows, (p) => (p.externalId === "P-1" ? "Hồng, S" : null));
    expect(hinted.products.map((p) => p.channelSku)).toEqual(["LT075-HONG (Hồng, S)", "LT075-HONG #2"]);
    expect(hinted.products[0].variantName).toBe("Hồng, S");
  });

  it("trùng cả mã lẫn tên → thêm '#id' cho cả hai; không có externalId → đánh số", () => {
    const r = resolveChannelSkuKeys([
      row({ externalId: "P-1", variantName: "Hồng" }),
      row({ externalId: "P-2", variantName: "Hồng" }),
    ]);
    expect(r.products.map((p) => p.channelSku)).toEqual(["LT075-HONG (Hồng) #1", "LT075-HONG (Hồng) #2"]);
    const noId = resolveChannelSkuKeys([row({}), row({})]);
    expect(new Set(noId.products.map((p) => p.channelSku)).size).toBe(2);
  });

  it("thứ tự sàn trả đổi → khóa từng dòng không đổi (ổn định theo tên + id)", () => {
    const a = row({ externalId: "P-1", variantName: "Hồng, S" });
    const b = row({ externalId: "P-2", variantName: "Hồng, M" });
    const k1 = new Map(resolveChannelSkuKeys([a, b]).products.map((p) => [p.externalId, p.channelSku]));
    const k2 = new Map(resolveChannelSkuKeys([b, a]).products.map((p) => [p.externalId, p.channelSku]));
    expect(k1).toEqual(k2);
  });

  it("đuôi không đụng mã sẵn có của sản phẩm khác (chốt chặn unique)", () => {
    const r = resolveChannelSkuKeys([
      row({ channelSku: "X (Đỏ)", externalId: "9-1", variantName: "Khác" }),
      row({ channelSku: "X", externalId: "9-2", variantName: "Đỏ" }),
      row({ channelSku: "X", externalId: "9-3", variantName: "Xanh" }),
    ]);
    expect(new Set(r.products.map((p) => p.channelSku)).size).toBe(3);
    expect(r.products.find((p) => p.externalId === "9-2")?.channelSku).toBe("X (Đỏ) #2");
  });
});
