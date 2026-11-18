import { describe, expect, it } from "vitest";

import { isMachineSku, lineDisplay } from "../order-line-display";

describe("isMachineSku", () => {
  it("TikTok để trống seller_sku: khóa là sku_id trần, khớp đuôi externalId", () => {
    expect(isMachineSku("1733668291614771234", "1729384756012345678-1733668291614771234")).toBe(true);
  });

  it("đơn TikTok cũ chưa có externalId: dãy 19 số vẫn là mã máy", () => {
    expect(isMachineSku("1733668291614771234", null)).toBe(true);
  });

  it("mã máy Hubsell tự dựng cho Shopee / Lazada và ShopSku Lazada", () => {
    expect(isMachineSku("SPE-123456-789", "123456-789")).toBe(true);
    expect(isMachineSku("SPE-123456", "123456")).toBe(true);
    expect(isMachineSku("LZD-555-777", null)).toBe(true);
    expect(isMachineSku("2503826712_VNAMZ-12194012345", null)).toBe(true);
  });

  it("mã người bán tự đặt — kể cả mã vạch 13–14 số — không phải mã máy", () => {
    expect(isMachineSku("DB17-M", "111-222")).toBe(false);
    expect(isMachineSku("8936012345678", null)).toBe(false);
    expect(isMachineSku("18936012345675", "111-222")).toBe(false);
    expect(isMachineSku("SPE-ABC", null)).toBe(false);
  });

  it("rỗng / null thì không phải mã máy (không có gì để ẩn)", () => {
    expect(isMachineSku("", null)).toBe(false);
    expect(isMachineSku(null, "1-2")).toBe(false);
  });
});

describe("lineDisplay", () => {
  it("ca khách kêu 18/11: TikTok không đặt SKU → tách phân loại, ẩn dãy id", () => {
    expect(
      lineDisplay({
        productName: "Đồ Bộ tole cổ Y Ren Viền TAY DÀI QUẦN DÀI - REN DÀI 17, Size M(40-57kg)",
        channelSku: "1733668291614771234",
        externalId: "1729384756012345678-1733668291614771234",
        variantName: "REN DÀI 17, Size M(40-57kg)",
      })
    ).toEqual({
      baseName: "Đồ Bộ tole cổ Y Ren Viền TAY DÀI QUẦN DÀI",
      variantName: "REN DÀI 17, Size M(40-57kg)",
      sellerSku: null,
    });
  });

  it("khách có đặt SKU: thấy cả phân loại lẫn SKU", () => {
    expect(
      lineDisplay({
        productName: "Váy xòe - Đen,M",
        channelSku: "VAY01-DEN-M",
        externalId: "900-901",
        variantName: "Đen,M",
      })
    ).toEqual({ baseName: "Váy xòe", variantName: "Đen, M", sellerSku: "VAY01-DEN-M" });
  });

  it("tên sản phẩm có sẵn ' - ' không bị cắt nhầm", () => {
    expect(
      lineDisplay({
        productName: "Áo thun - form rộng - Trắng, L",
        channelSku: "AT-TRANG-L",
        variantName: "Trắng, L",
      })
    ).toEqual({ baseName: "Áo thun - form rộng", variantName: "Trắng, L", sellerSku: "AT-TRANG-L" });
  });

  it("tên phân loại tự nó có ' - ' vẫn tách đúng", () => {
    expect(
      lineDisplay({ productName: "Bộ nỉ - Size M - 40kg", channelSku: "BN-M", variantName: "Size M - 40kg" })
    ).toEqual({ baseName: "Bộ nỉ", variantName: "Size M - 40kg", sellerSku: "BN-M" });
  });

  it("sản phẩm đơn: không có phân loại, tên giữ nguyên", () => {
    expect(lineDisplay({ productName: "Kệ gỗ - loại dày", channelSku: "KE01", variantName: null })).toEqual({
      baseName: "Kệ gỗ - loại dày",
      variantName: null,
      sellerSku: "KE01",
    });
  });

  it("đơn cũ chưa có cột: danh mục cho tên phân loại → tìm đúng điểm cắt", () => {
    expect(
      lineDisplay(
        { productName: "Váy xòe - Đen,M", channelSku: "SPE-900-901", externalId: "900-901" },
        { productName: "Váy xòe", variantName: "Đen, M" }
      )
    ).toEqual({ baseName: "Váy xòe", variantName: "Đen, M", sellerSku: null });
  });

  it("đơn cũ, danh mục TikTok chưa có tên phân loại: cắt theo tên sản phẩm của danh mục", () => {
    expect(
      lineDisplay(
        { productName: "Đồ bộ tole - REN DÀI 17, Size M", channelSku: "1733668291614771234" },
        { productName: "Đồ bộ tole", variantName: null }
      )
    ).toEqual({ baseName: "Đồ bộ tole", variantName: "REN DÀI 17, Size M", sellerSku: null });
  });

  it("người bán đổi tên phân loại sau khi bán: KHÔNG lấy tên mới của danh mục đè lên đơn", () => {
    const d = lineDisplay(
      { productName: "Váy xòe - Đỏ, M", channelSku: "VAY-DO-M" },
      { productName: "Váy xòe", variantName: "Đỏ đậm, M" }
    );
    // Đuôi "Đỏ, M" không khớp tên mới → lui về cắt theo tên sản phẩm của danh mục: chữ vẫn là của đơn.
    expect(d).toEqual({ baseName: "Váy xòe", variantName: "Đỏ, M", sellerSku: "VAY-DO-M" });
  });

  it("đơn cũ không tách được (danh mục đổi cả tên): giữ nguyên tên, không bịa phân loại", () => {
    expect(
      lineDisplay(
        { productName: "Váy xòe mùa hè - Đỏ, M", channelSku: "VAY-DO-M" },
        { productName: "Váy xòe 2026", variantName: "Đỏ đậm, M" }
      )
    ).toEqual({ baseName: "Váy xòe mùa hè - Đỏ, M", variantName: null, sellerSku: "VAY-DO-M" });
  });

  it("khóa trùng mã có đuôi product-sync thêm: SKU hiện ra là mã người bán gốc", () => {
    expect(
      lineDisplay({
        productName: "Bỉm quần - Hồng,3-5kg",
        channelSku: "LT075-HONG (Hồng, 3-5kg)",
        externalId: "10-11",
        variantName: "Hồng,3-5kg",
      }).sellerSku
    ).toBe("LT075-HONG");
    expect(
      lineDisplay({
        productName: "Bỉm quần - Hồng,3-5kg",
        channelSku: "LT075-HONG (Hồng, 3-5kg) #1734732076211733760",
        variantName: "Hồng,3-5kg",
      }).sellerSku
    ).toBe("LT075-HONG");
    expect(lineDisplay({ productName: "Bỉm", channelSku: "LT075-HONG #1734732076211733760" }).sellerSku).toBe(
      "LT075-HONG"
    );
  });

  it("mã người bán có ngoặc không phải tên phân loại thì giữ nguyên", () => {
    expect(lineDisplay({ productName: "Túi - Đen", channelSku: "TUI (2026)", variantName: "Đen" }).sellerSku).toBe(
      "TUI (2026)"
    );
  });

  it("dòng không có SKU, tên rỗng: không vỡ", () => {
    expect(lineDisplay({ productName: "", channelSku: null })).toEqual({
      baseName: "",
      variantName: null,
      sellerSku: null,
    });
    expect(lineDisplay({ productName: " - Đen", channelSku: "", variantName: "Đen" })).toEqual({
      baseName: "- Đen",
      variantName: "Đen",
      sellerSku: null,
    });
  });
});
