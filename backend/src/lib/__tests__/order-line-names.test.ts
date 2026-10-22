import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../prisma", () => ({
  prisma: { channelProduct: { findMany: vi.fn(async () => []) } },
}));

import { prisma } from "../prisma";
import { loadVariantNames } from "../order-line-names";

const findMany = vi.mocked(prisma.channelProduct.findMany);

describe("loadVariantNames — tên phân loại cho dòng đơn", () => {
  beforeEach(() => findMany.mockReset());

  it("ưu tiên danh tính sàn (gian + externalId), rồi mã, rồi sản phẩm kho; không biết thì rỗng", async () => {
    findMany
      // lượt 1: theo externalId
      .mockResolvedValueOnce([
        { channelId: "ch1", externalId: "88-1", variantName: "Hồng, 3-5kg" },
      ] as never)
      // lượt 2: theo mã (không phân biệt hoa/thường)
      .mockResolvedValueOnce([
        { channelId: "ch1", channelSku: "LT075-HONG (Hồng, 5-7kg)", variantName: "Hồng, 5-7kg" },
        // cùng mã ở gian khác → KHÔNG được khớp chéo gian
        { channelId: "ch2", channelSku: "NOI18", variantName: "Nắp kính" },
      ] as never);

    const variantOf = await loadVariantNames([
      { channelId: "ch1", externalId: "88-1", channelSku: "LT075-HONG" },
      { channelId: "ch1", externalId: null, channelSku: "lt075-hong (hồng, 5-7kg)" },
      { channelId: "ch1", externalId: null, channelSku: "NOI18", productVariantName: "Từ kho" },
      { channelId: "ch1", externalId: "999-9", channelSku: "KHONG-CO" },
    ]);

    expect(variantOf({ channelId: "ch1", externalId: "88-1", channelSku: "LT075-HONG" })).toBe("Hồng, 3-5kg");
    expect(variantOf({ channelId: "ch1", externalId: null, channelSku: "lt075-hong (hồng, 5-7kg)" })).toBe("Hồng, 5-7kg");
    expect(variantOf({ channelId: "ch1", externalId: null, channelSku: "NOI18", productVariantName: "Từ kho" })).toBe("Từ kho");
    expect(variantOf({ channelId: "ch1", externalId: "999-9", channelSku: "KHONG-CO" })).toBe("");
    // Hai câu hỏi cho CẢ loạt, không hỏi từng dòng
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("không có dòng nào thì không hỏi DB", async () => {
    const variantOf = await loadVariantNames([]);
    expect(findMany).not.toHaveBeenCalled();
    expect(variantOf({ channelId: "x", externalId: null, channelSku: "A" })).toBe("");
  });
});
