// Dịch lỗi sàn khi đăng sản phẩm + tên thuộc tính tiếng Việt (docs/SAO-CHEP-SAN-PHAM.md mục 14).
import { describe, expect, it } from "vitest";
import { viAttributeName } from "../attribute-names-vi";
import { humanizeListingError, splitListingError } from "../error-text";

describe("humanizeListingError", () => {
  it("lỗi thật 29/10: Shopee Dimension.PackageLength → câu kích thước kiện + giữ nguyên văn", () => {
    const raw =
      "Shopee add_item lỗi: product.error_param — invalid AddItemRequest.Dimension: embedded message failed validation | caused by: invalid Dimension.PackageLength: value must be greater than 0";
    const out = humanizeListingError("SHOPEE", raw);
    const { text, detail } = splitListingError(out);
    expect(text).toMatch(/^Shopee từ chối: Kích thước kiện hàng/);
    expect(text).toContain("đủ cả 3 số");
    expect(detail).toBe(raw);
  });

  it("mất ủy quyền / quá tải / thuộc tính bắt buộc / SKU trùng / tên dài", () => {
    expect(humanizeListingError("TIKTOK", "TikTok API lỗi (code 105002): invalid_access_token")).toMatch(/mất ủy quyền/);
    expect(humanizeListingError("SHOPEE", "Shopee add_item lỗi: error_rate_limit — too many requests")).toMatch(/quá tải/);
    expect(humanizeListingError("TIKTOK", "TikTok API lỗi (code 12052901): product_attributes[0].values is required")).toMatch(/thuộc tính bắt buộc/);
    expect(humanizeListingError("SHOPEE", "Shopee add_item lỗi: error_item_sku_duplicate — item sku already exists")).toMatch(/SKU đã có/);
    expect(humanizeListingError("LAZADA", "Lazada product/create lỗi: E501: name length should be less than 255")).toMatch(/Tên sản phẩm/);
  });

  it("câu Hubsell tự viết (tiếng Việt) giữ nguyên, không thêm dòng kỹ thuật", () => {
    const raw = "Không tải được ảnh nào lên Shopee";
    expect(humanizeListingError("SHOPEE", raw)).toBe(raw);
    const tier = "Shopee: 2 phân loại không khớp nhóm phân loại (Màu × Size) — sản phẩm đã tạo (item 1) nhưng chưa có phân loại, bổ sung trên sàn.";
    expect(humanizeListingError("SHOPEE", tier)).toBe(tier);
  });

  it("không khớp mẫu → câu chung + nguyên văn; rỗng → câu không rõ lý do", () => {
    const out = humanizeListingError("LAZADA", "Lazada product/create lỗi: E9999: Something odd");
    expect(splitListingError(out).text).toMatch(/^Lazada từ chối bài đăng/);
    expect(splitListingError(out).detail).toContain("E9999");
    expect(humanizeListingError("SHOPEE", "")).toMatch(/không nói lý do/);
  });
});

describe("viAttributeName", () => {
  it("tên Anh phổ biến → Việt; đã có dấu → giữ; lạ → giữ", () => {
    expect(viAttributeName("Region of Origin")).toBe("Xuất xứ");
    expect(viAttributeName("pack type")).toBe("Kiểu đóng gói");
    expect(viAttributeName("Manufacturer/trader name")).toBe("Tên nhà sản xuất / đơn vị kinh doanh");
    expect(viAttributeName("Sleeve Length")).toBe("Độ dài tay áo");
    expect(viAttributeName("Chất liệu")).toBe("Chất liệu");
    expect(viAttributeName("Material (Outer)")).toBe("Chất liệu (Material (Outer))");
    expect(viAttributeName("Zorblax Factor")).toBe("Zorblax Factor");
  });
});
