import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({
  prisma: { channelProduct: { findMany: vi.fn(async () => []) } },
}));

import { prisma } from "../../lib/prisma";
import { attachItemImages } from "../item-images";

const findMany = vi.mocked(prisma.channelProduct.findMany);

const item = (over: Record<string, unknown>) => ({
  id: "i1",
  productName: "Váy xòe - Đen,M",
  channelSku: "SPE-900-901",
  externalId: "900-901" as string | null,
  variantName: null as string | null,
  imageUrl: null as string | null,
  product: null,
  ...over,
});

describe("attachItemImages — ảnh + chữ hiển thị dòng hàng", () => {
  beforeEach(() => findMany.mockReset());

  it("đơn mới có cột phân loại: tách tên, ẩn mã máy, MỘT câu truy vấn cho cả trang", async () => {
    findMany.mockResolvedValueOnce([] as never);
    const [o] = await attachItemImages([
      {
        channelId: "ch1",
        items: [
          item({
            productName: "Đồ bộ tole - REN DÀI 17, Size M",
            channelSku: "1733668291614771234",
            externalId: "1729-1733668291614771234",
            variantName: "REN DÀI 17, Size M",
          }),
          item({ id: "i2", productName: "Kẹp tóc", channelSku: "KEP01", externalId: "55", variantName: null }),
        ],
      },
    ]);
    expect(o.items.map((i) => [i.baseName, i.variantName, i.sellerSku])).toEqual([
      ["Đồ bộ tole", "REN DÀI 17, Size M", null],
      ["Kẹp tóc", null, "KEP01"],
    ]);
    // Khóa gom giữ nguyên cho client cũ
    expect(o.items[0].channelSku).toBe("1733668291614771234");
    expect(o.items[0].productName).toBe("Đồ bộ tole - REN DÀI 17, Size M");
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("đơn cũ: tra danh mục theo ID LÁ trước (khóa đã đổi vẫn ra ảnh + điểm cắt), không khớp chéo gian", async () => {
    findMany.mockResolvedValueOnce([
      // product-sync đã đổi khóa SPE-… → mã người bán; dòng đơn cũ vẫn mang khóa cũ
      {
        channelId: "ch1",
        channelSku: "VAY01 (Đen, M)",
        externalId: "900-901",
        status: "ACTIVE",
        productName: "Váy xòe",
        variantName: "Đen, M",
        imageUrl: "https://img/ch1.jpg",
      },
      // cùng id ở gian khác — không được dùng
      {
        channelId: "ch2",
        channelSku: "SPE-900-901",
        externalId: "900-901",
        status: "ACTIVE",
        productName: "Hàng gian khác",
        variantName: "Sai",
        imageUrl: "https://img/ch2.jpg",
      },
    ] as never);
    const [o] = await attachItemImages([{ channelId: "ch1", items: [item({})] }]);
    expect(o.items[0]).toMatchObject({
      baseName: "Váy xòe",
      variantName: "Đen, M",
      sellerSku: null,
      imageUrl: "https://img/ch1.jpg",
    });
  });

  it("không tra được gì: giữ nguyên tên, ảnh lui về ảnh đơn rồi ảnh kho; đơn không có dòng thì không hỏi DB", async () => {
    findMany.mockResolvedValueOnce([] as never);
    const [o] = await attachItemImages([
      {
        channelId: "ch1",
        items: [item({ externalId: null, channelSku: "VAY-DEN", imageUrl: null, product: { imageUrl: "kho.jpg" } })],
      },
    ]);
    expect(o.items[0]).toMatchObject({
      baseName: "Váy xòe - Đen,M",
      variantName: null,
      sellerSku: "VAY-DEN",
      imageUrl: "kho.jpg",
    });

    findMany.mockReset();
    expect(await attachItemImages([{ channelId: "ch1", items: [] }])).toEqual([{ channelId: "ch1", items: [] }]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
