import { describe, expect, it } from "vitest";

import {
  isMaskedValue,
  mapBuyerInvoiceItem,
} from "../shopee/buyer-invoice";
import { resolveInvoiceBuyer } from "../invoice/issue-order";

// ============================================================
// KHÁCH YÊU CẦU XUẤT HÓA ĐƠN (24/08) — 2 hàm thuần của luồng:
//   · mapBuyerInvoiceItem: chuẩn hóa item get_buyer_invoice_info của Shopee
//     (3 loại personal/company/household + phát hiện dữ liệu bị che "A****b").
//   · resolveInvoiceBuyer: từ dữ liệu đã lưu trên Order suy ra người mua in
//     trên hóa đơn — khách không yêu cầu phải ra "Bán cho người tiêu dùng"
//     (Khoản 4 Phụ lục NĐ 254), KHÔNG dùng customerName bị che của sàn.
// ============================================================

describe("mapBuyerInvoiceItem — chuẩn hóa yêu cầu hóa đơn từ Shopee", () => {
  it("đơn không có yêu cầu (error receipt settings not found) → null", () => {
    expect(
      mapBuyerInvoiceItem({
        order_sn: "A1",
        invoice_type: "",
        invoice_detail: null,
        error: "receipt settings not found",
      })
    ).toBeNull();
  });

  it("company → lấy bộ company_*, đủ tên + MST + email + địa chỉ", () => {
    const m = mapBuyerInvoiceItem({
      order_sn: "A2",
      invoice_type: "company",
      invoice_detail: {
        name: "Nguyen Van A",
        company_name: "CONG TY TNHH ABC",
        company_tax_id: "0101243150",
        company_email: "ketoan@abc.vn",
        company_address: "1 Duy Tan, Ha Noi",
      },
    });
    expect(m).not.toBeNull();
    expect(m!.type).toBe("COMPANY");
    expect(m!.masked).toBe(false);
    expect(m!.info).toEqual({
      name: "Nguyen Van A",
      companyName: "CONG TY TNHH ABC",
      companyTaxId: "0101243150",
      companyEmail: "ketoan@abc.vn",
      companyAddress: "1 Duy Tan, Ha Noi",
    });
  });

  it("personal → lấy name/email/national_id; household → tax_id", () => {
    const p = mapBuyerInvoiceItem({
      order_sn: "A3",
      invoice_type: "personal",
      invoice_detail: {
        name: "Tran Thi B",
        email: "b@gmail.com",
        national_id: "001199001234",
        address: "2 Le Loi, Da Nang",
      },
    });
    expect(p!.type).toBe("PERSONAL");
    expect(p!.info.nationalId).toBe("001199001234");

    const h = mapBuyerInvoiceItem({
      order_sn: "A4",
      invoice_type: "household",
      invoice_detail: { name: "HKD Le Van C", tax_id: "8123456789", email: "c@x.vn" },
    });
    expect(h!.type).toBe("HOUSEHOLD");
    expect(h!.info.taxId).toBe("8123456789");
  });

  it("dữ liệu trọng yếu bị che (A****b) → masked=true để lượt sau hỏi lại", () => {
    expect(isMaskedValue("A****b")).toBe(true);
    expect(isMaskedValue("Nguyen Van A")).toBe(false);
    const m = mapBuyerInvoiceItem({
      order_sn: "A5",
      invoice_type: "company",
      invoice_detail: { company_name: "C***G TY", company_tax_id: "01****50" },
    });
    expect(m!.masked).toBe(true);
  });

  it("invoice_type lạ → null (không đoán bừa loại hóa đơn)", () => {
    expect(
      mapBuyerInvoiceItem({
        order_sn: "A6",
        invoice_type: "something_new",
        invoice_detail: { name: "X" },
      })
    ).toBeNull();
  });
});

describe("resolveInvoiceBuyer — người mua in trên hóa đơn", () => {
  it("COMPANY → tên công ty + MST công ty + địa chỉ/email công ty", () => {
    expect(
      resolveInvoiceBuyer({
        invoiceRequestType: "COMPANY",
        buyerInvoiceInfo: {
          name: "Nguoi dat",
          companyName: "CONG TY TNHH ABC",
          companyTaxId: "0101243150",
          companyEmail: "kt@abc.vn",
          companyAddress: "1 Duy Tan",
        },
      })
    ).toEqual({
      buyerName: "CONG TY TNHH ABC",
      buyerTaxCode: "0101243150",
      buyerAddress: "1 Duy Tan",
      buyerEmail: "kt@abc.vn",
    });
  });

  it("PERSONAL không có MST → dùng số định danh cá nhân làm mã số", () => {
    const r = resolveInvoiceBuyer({
      invoiceRequestType: "PERSONAL",
      buyerInvoiceInfo: { name: "Tran Thi B", nationalId: "001199001234", email: "b@g.com" },
    });
    expect(r.buyerName).toBe("Tran Thi B");
    expect(r.buyerTaxCode).toBe("001199001234");
  });

  it("khách KHÔNG yêu cầu → Bán cho người tiêu dùng, không lộ tên che của sàn", () => {
    expect(
      resolveInvoiceBuyer({ invoiceRequestType: null, buyerInvoiceInfo: null })
    ).toEqual({ buyerName: "Bán cho người tiêu dùng" });
  });

  it("có type nhưng info đã bị cron xóa → fallback Bán cho người tiêu dùng", () => {
    expect(
      resolveInvoiceBuyer({ invoiceRequestType: "COMPANY", buyerInvoiceInfo: null })
    ).toEqual({ buyerName: "Bán cho người tiêu dùng" });
  });
});
