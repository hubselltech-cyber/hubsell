// Giá vốn theo gian (11/10/2026): quy tắc giá hiệu lực + luật nhập Excel có cột
// "Gian hàng". Phần thuần, không DB.

import { describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { effectiveSkuCost } from "../cost-price";
import { groupByCost, planCostImport, type CostImportRow } from "../cost-import";

describe("effectiveSkuCost", () => {
  it("giá riêng của gian thắng giá kho", () => {
    expect(effectiveSkuCost({ costPrice: 120, product: { costPrice: 100 } })).toBe(120);
  });
  it("gian chưa có giá riêng (NULL hoặc 0) → giá mặc định ở kho", () => {
    expect(effectiveSkuCost({ costPrice: null, product: { costPrice: 100 } })).toBe(100);
    expect(effectiveSkuCost({ costPrice: 0, product: { costPrice: "100" } })).toBe(100);
  });
  it("chưa nối kho, chưa có giá → 0; không có SKU sàn → 0", () => {
    expect(effectiveSkuCost({ costPrice: null, product: null })).toBe(0);
    expect(effectiveSkuCost(undefined)).toBe(0);
  });
});

describe("planCostImport", () => {
  const data = {
    products: [{ id: "p1", skuCode: "AO-01", costPrice: 50 }],
    channels: [
      { id: "chA", channelName: ChannelName.SHOPEE, shopName: "Gian A" },
      { id: "chB", channelName: ChannelName.SHOPEE, shopName: "Gian B" },
      { id: "chT", channelName: ChannelName.TIKTOK, shopName: "Gian B" },
    ],
    // cpA nối kho p1, đang theo giá kho 50; cpB, cpT chưa nối, chưa có giá.
    channelProducts: [
      { id: "cpA", channelId: "chA", channelSku: "AO-01", productId: "p1", ownCost: 0, currentCost: 50 },
      { id: "cpB", channelId: "chB", channelSku: "ao-01", productId: null, ownCost: 0, currentCost: 0 },
      { id: "cpT", channelId: "chT", channelSku: "AO-01", productId: null, ownCost: 0, currentCost: 0 },
    ],
  };
  const row = (r: Partial<CostImportRow>): CostImportRow => ({
    row: 2,
    sku: "AO-01",
    cost: 100,
    shop: "",
    channel: "",
    ...r,
  });

  it("dòng không ghi gian (file mẫu cũ) → giá kho + mọi gian có mã; gian đang theo kho vẫn theo kho", () => {
    const plan = planCostImport([row({})], data);
    expect([...plan.productCost]).toEqual([["p1", 100]]);
    expect([...plan.shopCost.keys()].sort()).toEqual(["cpB", "cpT"]);
    expect(plan.errors).toEqual([]);
  });

  it("dòng có gian trùng giá đang dùng → không ghi (xuất ra nhập lại nguyên văn không đổi gì)", () => {
    const plan = planCostImport([row({ shop: "Gian A", cost: 50 })], data);
    expect(plan.matchedRows).toBe(1);
    expect(plan.shopCost.size).toBe(0);
  });

  it("dòng không gian đứng SAU dòng có gian → gian đó về theo giá kho mới", () => {
    const plan = planCostImport([row({ shop: "Gian A", cost: 130 }), row({ row: 3, cost: 100 })], data);
    expect(plan.shopCost.has("cpA")).toBe(false);
    expect(plan.productCost.get("p1")).toBe(100);
  });

  it("dòng có gian → chỉ đúng gian đó, không đụng kho", () => {
    const plan = planCostImport([row({ shop: " gian a ", cost: 120 })], data);
    expect([...plan.shopCost]).toEqual([["cpA", 120]]);
    expect(plan.productCost.size).toBe(0);
  });

  it("hai gian trùng tên ở hai sàn → cần cột Kênh bán", () => {
    const amb = planCostImport([row({ shop: "Gian B" })], data);
    expect(amb.matchedRows).toBe(0);
    expect(amb.errors[0].message).toContain("Kênh bán");
    const ok = planCostImport([row({ shop: "Gian B", channel: "TikTok Shop", cost: 90 })], data);
    expect([...ok.shopCost]).toEqual([["cpT", 90]]);
  });

  it("gian không có / gian không có mã → báo lỗi theo dòng", () => {
    const plan = planCostImport(
      [row({ row: 3, shop: "Gian Z" }), row({ row: 4, sku: "KHAC", shop: "Gian A" })],
      data
    );
    expect(plan.errors.map((e) => e.row)).toEqual([3, 4]);
  });

  it("Kho nội bộ → chỉ giá kho", () => {
    const plan = planCostImport([row({ shop: "Kho nội bộ", cost: 80 })], data);
    expect([...plan.productCost]).toEqual([["p1", 80]]);
    expect(plan.shopCost.size).toBe(0);
  });

  it("trùng ô → dòng sau thắng", () => {
    const plan = planCostImport(
      [row({ cost: 100 }), row({ row: 3, shop: "Gian A", cost: 130 })],
      data
    );
    expect(plan.shopCost.get("cpA")).toBe(130);
    expect(plan.shopCost.get("cpB")).toBe(100);
    expect([...groupByCost(plan.shopCost)].sort()).toEqual([
      [100, ["cpB", "cpT"]],
      [130, ["cpA"]],
    ]);
  });
});
