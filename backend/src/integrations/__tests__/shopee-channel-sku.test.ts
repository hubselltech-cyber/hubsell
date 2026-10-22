// ============================================================
// KHÓA SKU SHOPEE KHI NGƯỜI BÁN KHÔNG ĐẶT SKU PHÂN LOẠI (22/10/2026)
// Khách phàn nàn: 6 phân loại váy kéo về chỉ khác dãy id "SPE-item-model".
// Ba kiểu đặt mã trên Seller Center → ba khóa khác nhau, dùng chung cho sản phẩm,
// đơn hàng và hoàn hàng.
// ============================================================
import { describe, expect, it } from "vitest";
import { shopeeChannelSku } from "../shopee/client";
import {
  cleanVariantName,
  productDisplayName,
  productGroupKey,
  skuFromRoot,
  variantSkuSuffix,
} from "../../lib/product-group";

describe("shopeeChannelSku — ba kiểu đặt mã", () => {
  it("1. đặt riêng từng phân loại → đúng model_sku, không đụng gì", () => {
    expect(
      shopeeChannelSku({ itemId: 1, modelId: 11, itemSku: "VAY01", modelSku: "VAY01-DEN-M", modelName: "Đen,M" })
    ).toBe("VAY01-DEN-M");
  });

  it("2. chỉ đặt SKU sản phẩm cấp cha → mã cha + (tên phân loại), khách đọc được", () => {
    expect(shopeeChannelSku({ itemId: 1, modelId: 11, itemSku: "VAY01", modelSku: "", modelName: "Đen,M" })).toBe(
      "VAY01 (Đen, M)"
    );
    expect(shopeeChannelSku({ itemId: 1, modelId: 12, itemSku: " VAY01 ", modelName: "Trắng, L" })).toBe(
      "VAY01 (Trắng, L)"
    );
  });

  it("3. không đặt gì → mã máy SPE-item-model như cũ (mỗi phân loại một dòng)", () => {
    expect(shopeeChannelSku({ itemId: 56018188263, modelId: 262974070538, modelName: "Đen,M" })).toBe(
      "SPE-56018188263-262974070538"
    );
    // Có mã cha nhưng sàn không trả tên phân loại (đơn cũ thiếu model_name) → vẫn SPE-… để không bịa khóa.
    expect(shopeeChannelSku({ itemId: 1, modelId: 11, itemSku: "VAY01" })).toBe("SPE-1-11");
  });

  it("sản phẩm đơn: item_sku, trống thì SPE-item", () => {
    expect(shopeeChannelSku({ itemId: 1, itemSku: "AO01" })).toBe("AO01");
    expect(shopeeChannelSku({ itemId: 1 })).toBe("SPE-1");
  });
});

describe("product-group — phân loại riêng + khóa gom cha–con + mã gốc", () => {
  it("khóa gom chỉ khi có phân loại; cùng tên khác hoa/thường/khoảng trắng về một nhóm", () => {
    expect(productGroupKey("Chân Váy Dáng A", "Đen, M")).toBe("chân váy dáng a");
    expect(productGroupKey("  Chân  Váy Dáng A ", "Đen, M")).toBe("chân váy dáng a");
    expect(productGroupKey("Chân Váy Dáng A", null)).toBeNull();
    expect(productGroupKey("Chân Váy Dáng A", "  ")).toBeNull();
  });

  it("làm sạch phân loại như sku-key: 'Đen,M' → 'Đen, M'; rỗng → null", () => {
    expect(cleanVariantName("Đen,M")).toBe("Đen, M");
    expect(cleanVariantName("")).toBeNull();
    expect(cleanVariantName(undefined)).toBeNull();
    expect(productDisplayName({ productName: "Váy", variantName: "Đen, M" })).toBe("Váy (Đen, M)");
    expect(productDisplayName({ productName: "Váy", variantName: null })).toBe("Váy");
  });

  it("mã gốc + phân loại → SKU kho không dấu, chữ hoa (cách Salework)", () => {
    expect(variantSkuSuffix("Đen, M")).toBe("DEN-M");
    expect(variantSkuSuffix("Hồng, 3-5kg")).toBe("HONG-3-5KG");
    expect(skuFromRoot("vay01", "Đen, M")).toBe("VAY01-DEN-M");
    expect(skuFromRoot("VAY 01", null)).toBe("VAY-01");
  });
});
