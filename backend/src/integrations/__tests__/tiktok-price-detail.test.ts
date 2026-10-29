// ============================================================
// Get Order Price Details 202407 — bóc voucher shop (lát 3, 29/10/2026). Payload
// mẫu = dòng thật probe prod (docs/DONG-TIEN-TONG-GIA-TRI-SAN-PHAM-KHAO-SAT-29-10.md mục 12).
// ============================================================
import { describe, expect, it } from "vitest";
import { voucherSellerFromPriceDetail } from "../tiktok/price-detail";

describe("voucherSellerFromPriceDetail", () => {
  it("ưu tiên số cấp đơn voucher_deduction_seller (payload VN thật)", () => {
    const pd = {
      currency: "VND",
      sku_list_price: "440000",
      sku_sale_price: "258060",
      subtotal_deduction_seller: "136400",
      subtotal_deduction_platform: "45540",
      voucher_deduction_seller: "26400",
      voucher_deduction_platform: "45540",
      line_items: [
        { id: "1", sku_list_price: "440000", subtotal_deduction_seller: "136400", voucher_deduction_seller: "26400" },
      ],
    };
    expect(voucherSellerFromPriceDetail(pd)).toBe(26400);
  });
  it("thiếu số cấp đơn → Σ dòng hàng; không dòng nào có trường → null (không ghi)", () => {
    expect(
      voucherSellerFromPriceDetail({
        line_items: [{ voucher_deduction_seller: "3320" }, { voucher_deduction_seller: "0" }],
      })
    ).toBe(3320);
    expect(voucherSellerFromPriceDetail({ line_items: [{ sku_list_price: "1" }] })).toBeNull();
    expect(voucherSellerFromPriceDetail({ line_items: [] })).toBeNull();
    expect(voucherSellerFromPriceDetail(null)).toBeNull();
  });
  it("voucher = 0 là số thật (shop không dùng voucher), vẫn ghi để không đọc lại", () => {
    expect(voucherSellerFromPriceDetail({ voucher_deduction_seller: "0" })).toBe(0);
  });
});
