// Giá vốn theo gian (11/10/2026): quy tắc giá hiệu lực + luật nhập Excel có cột
// "Gian hàng". Phần thuần, không DB.

import { describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { costAtSaleForLine, effectiveSkuCost, giftLineMatchesLeaf } from "../cost-price";
import { planCostImport, type CostImportRow } from "../cost-import";

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

describe("giftLineMatchesLeaf — dòng quà còn là món của lá không (05/11/2026)", () => {
  const leaf = (productName: string, variantName: string | null) => ({ productName, variantName });
  it("ca Hellokityhh: tin quà đổi thành Kẹo Sâm, phân loại khác → không khớp", () => {
    expect(giftLineMatchesLeaf("[VOUCHER 20%] Kẹo gum - THANK YOU 2", leaf("Kẹo Ngậm Hồng Sâm", "HỘP 32 VIÊN"))).toBe(false);
  });
  it("cùng sản phẩm, đổi phân loại → không khớp (THANKU5 → Hộp 32 viên)", () => {
    expect(giftLineMatchesLeaf("Kẹo Sâm - THANKU5", leaf("Kẹo Sâm", "HỘP 32 VIÊN"))).toBe(false);
  });
  it("đổi tên sản phẩm, giữ phân loại → vẫn là món đó", () => {
    expect(giftLineMatchesLeaf("Gói kiến tha về tổ diệt tận gốc - 10 Gói", leaf("Gói kiến tha về tổ đi cả đàn", "10 Gói"))).toBe(true);
  });
  it("TikTok ghi '- Mặc định' cho lá không tên phân loại → khớp theo tên sản phẩm; đổi tên hẳn thì không", () => {
    expect(giftLineMatchesLeaf("Túi giữ form - Mặc định", leaf("Túi giữ form", null))).toBe(true);
    expect(giftLineMatchesLeaf("Túi giữ form", leaf("Túi giữ form", ""))).toBe(true);
    expect(giftLineMatchesLeaf("Thẻ cảm ơn - Mặc định", leaf("Túi giữ form", null))).toBe(false);
  });
  it("khác khoảng trắng quanh dấu phẩy vẫn khớp", () => {
    expect(giftLineMatchesLeaf("Áo B03 - Xanh Than , 40 -60 Kg", leaf("Áo B03", "Xanh Than, 40 -60 Kg"))).toBe(true);
  });
});

describe("costAtSaleForLine — giá chụp lúc tạo đơn", () => {
  const cp = { costPrice: 490_000, product: null, productName: "Kẹo Sâm", variantName: "HỘP 32 VIÊN" };
  it("dòng có giá bán luôn nhận giá của lá, dù tên khác", () => {
    expect(costAtSaleForLine({ price: 99_000, productName: "Tên cũ - THANK YOU 2" }, cp)).toBe(490_000);
  });
  it("dòng 0 đ khác món → 0; cùng món → nhận giá; không có lá → 0", () => {
    expect(costAtSaleForLine({ price: 0, productName: "Quà - THANK YOU 2" }, cp)).toBe(0);
    expect(costAtSaleForLine({ price: 0, productName: "Kẹo Sâm - HỘP 32 VIÊN" }, cp)).toBe(490_000);
    expect(costAtSaleForLine({ price: 0, productName: "X" }, undefined)).toBe(0);
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
    expect([...plan.shopCost].sort()).toEqual([
      ["cpA", 130],
      ["cpB", 100],
      ["cpT", 100],
    ]);
  });
});
