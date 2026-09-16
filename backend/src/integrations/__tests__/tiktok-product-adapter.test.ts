// ============================================================
// ADAPTER SẢN PHẨM TIKTOK — TEST TRANSFORMER THUẦN (16/09/2026)
//
// transformTiktokSku: mỗi SKU TikTok → 1 dòng NormalizedChannelProduct.
//   · Khoá SKU = seller_sku (trống → sku_id) — khớp khoá đồng bộ đơn.
//   · externalId "productId-skuId" để worker đẩy tồn bóc ra.
//   · Tồn = Σ các kho; warehouse giữ tồn lưu vào channelStockLocationId.
//   · ACTIVATE → ACTIVE; trạng thái khác → DELISTED.
// ============================================================
import { describe, expect, it } from "vitest";
import {
  pickDetailTargets,
  tiktokChannelSku,
  tiktokStatusToNorm,
  transformTiktokSku,
} from "../../marketplace/adapters/tiktok-adapter";

describe("tiktok-adapter transformTiktokSku", () => {
  it("khoá SKU ưu tiên seller_sku, trống thì sku_id", () => {
    expect(tiktokChannelSku({ id: "111", seller_sku: " AO-DEN-XL " })).toBe("AO-DEN-XL");
    expect(tiktokChannelSku({ id: "111", seller_sku: "" })).toBe("111");
  });

  it("trạng thái: ACTIVATE = đang bán, còn lại DELISTED", () => {
    expect(tiktokStatusToNorm("ACTIVATE")).toBe("ACTIVE");
    expect(tiktokStatusToNorm("SELLER_DEACTIVATED")).toBe("DELISTED");
    expect(tiktokStatusToNorm(undefined)).toBe("ACTIVE");
  });

  it("chuẩn hoá đủ trường: tên + phân loại, giá, ảnh SKU, tồn Σ kho, kho giữ tồn", () => {
    const row = transformTiktokSku(
      {
        id: "P1",
        title: "Áo thun basic",
        status: "ACTIVATE",
        main_images: [{ url: "https://img/main.jpg" }],
      },
      {
        id: "S1",
        seller_sku: "AO-DEN-XL",
        price: { sale_price: "132000", currency: "VND" },
        inventory: [
          { warehouse_id: "W-A", quantity: 0 },
          { warehouse_id: "W-B", quantity: 7 },
        ],
        sales_attributes: [
          { name: "Màu", value_name: "Đen", sku_img: { url: "https://img/sku.jpg" } },
          { name: "Size", value_name: "XL" },
        ],
      }
    );
    expect(row).toEqual({
      channelSku: "AO-DEN-XL",
      productName: "Áo thun basic",
      variantName: "Đen, XL",
      price: 132000,
      imageUrl: "https://img/sku.jpg",
      externalId: "P1-S1",
      itemSku: null,
      channelStock: 7,
      channelStockLocationId: "W-B",
      status: "ACTIVE",
    });
  });

  it("thiếu inventory → tồn null; thiếu sales_attributes → variant null, ảnh chính", () => {
    const row = transformTiktokSku(
      { id: "P2", title: "Nón", status: "FREEZE", main_images: [{ urls: ["https://img/p2.jpg"] }] },
      { id: "S2", price: { sale_price: "50000" } }
    );
    expect(row.channelStock).toBeNull();
    expect(row.channelStockLocationId).toBeNull();
    expect(row.variantName).toBeNull();
    expect(row.imageUrl).toBe("https://img/p2.jpg");
    expect(row.status).toBe("DELISTED");
    expect(row.channelSku).toBe("S2");
  });

  it("ảnh SKU theo shape thật 202309 (sku_img.urls[], không có url) được ưu tiên trước ảnh chính", () => {
    const row = transformTiktokSku(
      { id: "P3", title: "Túi", status: "ACTIVATE", main_images: [{ urls: ["https://img/main.jpg"] }] },
      {
        id: "S3",
        seller_sku: "TUI-DEN",
        price: { sale_price: "99000" },
        sales_attributes: [
          { name: "Màu", value_name: "Đen", sku_img: { uri: "x", urls: ["https://img/sku-den.jpg"], thumb_urls: ["https://img/t.jpg"] } },
        ],
      }
    );
    expect(row.imageUrl).toBe("https://img/sku-den.jpg");
    expect(row.variantName).toBe("Đen");
  });
});

describe("tiktok-adapter pickDetailTargets", () => {
  const P = (id: string) => ({ id });

  it("sản phẩm CHƯA có ảnh trong DB lên trước, đã có xếp sau, cắt theo trần", () => {
    const products = [P("1"), P("2"), P("3"), P("4"), P("5")];
    const enriched = new Set(["1", "2"]);
    expect(pickDetailTargets(products, enriched, 4).map((p) => p.id)).toEqual(["3", "4", "5", "1"]);
  });

  it("trần nhỏ hơn số chưa có ảnh → chỉ lấy phần chưa có, không đụng phần đã có", () => {
    const products = [P("1"), P("2"), P("3")];
    expect(pickDetailTargets(products, new Set(["1"]), 1).map((p) => p.id)).toEqual(["2"]);
  });
});
