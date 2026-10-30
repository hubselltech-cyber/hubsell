// Dịch lỗi sàn khi đăng sản phẩm → câu tiếng Việt + nguyên văn (docs/SAO-CHEP-SAN-PHAM.md mục 14, 28).
import { describe, expect, it } from "vitest";
import { humanizeListingError, isShopeeDescImageWhitelistError } from "../error-text";

/** target.error = dòng 1 tiếng Việt + "\n" + nguyên văn sàn (FE tách ở shared.ts). */
function split(stored: string): { text: string; detail: string | null } {
  const idx = stored.indexOf("\n");
  return idx < 0 ? { text: stored, detail: null } : { text: stored.slice(0, idx), detail: stored.slice(idx + 1) };
}

describe("humanizeListingError", () => {
  it("lỗi thật 29/10: Shopee Dimension.PackageLength → câu kích thước kiện + giữ nguyên văn", () => {
    const raw =
      "Shopee add_item lỗi: product.error_param — invalid AddItemRequest.Dimension: embedded message failed validation | caused by: invalid Dimension.PackageLength: value must be greater than 0";
    const { text, detail } = split(humanizeListingError("SHOPEE", raw));
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

  it("2 lỗi thật prod 29/10 tối: TikTok shop_cipher thừa → lỗi phía Hubsell; Shopee multi warehouse → mã kho", () => {
    const tt = humanizeListingError(
      "TIKTOK",
      "TikTok API lỗi (code 36009004): Unexpected identifier. The 'shop_cipher' query parameter is not required for this request. For more details: https://m.tiktok.shop/s/AIu6dbFhs2XW"
    );
    expect(split(tt).text).toMatch(/phía Hubsell/);
    expect(split(tt).text).not.toMatch(/thuộc tính/);
    const sp = humanizeListingError("SHOPEE", "Shopee add_item lỗi: product.error_busi — The merchant/shop has multi warehouse, please input location id");
    expect(split(sp).text).toMatch(/nhiều kho/);
  });

  it("câu Hubsell tự viết (tiếng Việt) giữ nguyên, không thêm dòng kỹ thuật", () => {
    const raw = "Không tải được ảnh nào lên Shopee";
    expect(humanizeListingError("SHOPEE", raw)).toBe(raw);
    const tier = "Shopee: 2 phân loại không khớp nhóm phân loại (Màu × Size) — sản phẩm đã tạo (item 1) nhưng chưa có phân loại, bổ sung trên sàn.";
    expect(humanizeListingError("SHOPEE", tier)).toBe(tier);
  });

  it("không khớp mẫu → câu chung + nguyên văn; rỗng → câu không rõ lý do", () => {
    const out = split(humanizeListingError("LAZADA", "Lazada product/create lỗi: E9999: Something odd"));
    expect(out.text).toMatch(/^Lazada từ chối bài đăng/);
    expect(out.detail).toContain("E9999");
    expect(humanizeListingError("SHOPEE", "")).toMatch(/không nói lý do/);
  });
});

describe("lỗi thật 30/10 Bunchar: Shopee không whitelist ảnh mô tả + URL chứa chữ image", () => {
  it("whitelist ảnh mô tả → câu riêng (không phải 'Sàn không nhận ảnh') + helper nhận diện", () => {
    const raw =
      "Shopee add_item lỗi: product.error_param — Parameter is not match the constraints, . : You are not in the whitelist to add images in description, can only upload plain text";
    expect(isShopeeDescImageWhitelistError(raw)).toBe(true);
    expect(isShopeeDescImageWhitelistError("Shopee add_item lỗi: product.error_param — image size invalid")).toBe(false);
    const { text, detail } = split(humanizeListingError("SHOPEE", raw));
    expect(text).toMatch(/chèn ảnh vào mô tả/);
    expect(text).not.toMatch(/Sàn không nhận ảnh/);
    expect(detail).toBe(raw);
  });

  it("câu Hubsell tiếng Việt kèm URL có chữ image/product-images → giữ nguyên, không gán nhầm lỗi ảnh", () => {
    const raw = "Tải ảnh thất bại (HTTP 403): https://jsys.supabase.co/storage/v1/object/public/product-images/u1/202610/a.jpg";
    expect(humanizeListingError("SHOPEE", raw)).toBe(raw);
    const tt = "Tải ảnh thất bại (HTTP 403): https://p16-oec-sg.tiktokcdn.com/tos-alisg/abc~tplv-origin-image.image";
    expect(humanizeListingError("SHOPEE", tt)).toBe(tt);
  });

  it("lỗi từng ảnh Shopee (image_info_list) vẫn ra câu ảnh", () => {
    const raw = "Shopee upload_image lỗi: error_param — image file too large (a.jpg)";
    expect(split(humanizeListingError("SHOPEE", raw)).text).toMatch(/Sàn không nhận ảnh/);
  });
});
