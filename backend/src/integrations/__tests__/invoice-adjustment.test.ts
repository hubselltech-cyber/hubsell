import { describe, expect, it } from "vitest";

import {
  buildStandardInvoicePayload,
  type StandardInvoiceConfig,
} from "../invoice/misa-einvoice";
import type { CreateInvoiceInput } from "../invoice/types";

// ============================================================
// HÓA ĐƠN ĐIỀU CHỈNH GIẢM khi khách trả hàng (24/08 — TT 91/2026 Đ.10 k.5c):
// payload đi qua ĐÚNG endpoint phát hành, thêm khối tham chiếu hóa đơn gốc
// (ReferenceType=2 + Org*), dòng hàng ghi ÂM. Verify sandbox: HĐ 00000067
// điều chỉnh 00000066 — meInvoice TỰ in dòng "Điều chỉnh cho hóa đơn..." từ
// khối Org*, nên KHÔNG chèn thêm dòng ghi chú ItemType 4 (in lặp).
// ============================================================

const cfg: StandardInvoiceConfig = {
  taxCode: "0101243150-732",
  companyName: "Test",
  companyAddress: "HN",
  clientId: "id",
  secretKey: "secret",
  meinvoiceUsername: "u",
  meinvoicePassword: "p",
  invoicePattern: "1",
  invoiceSeries: "1K26TYY",
  signMethod: "ESIGN_CLOUD",
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
};

const baseInput: CreateInvoiceInput = {
  orderCode: "485236838656212-DC1",
  buyerName: "Bán cho người tiêu dùng",
  lines: [
    {
      name: "Thắt lưng TLN009",
      sku: "TLN009",
      quantity: -1,
      unitPrice: 73148,
      vatRate: 8,
      amountWithoutVat: -73148,
      vatAmount: -5852,
    },
  ],
  totalAmount: -79000,
  adjustment: {
    orgInvNo: "00000066",
    orgInvSeries: "1K26TYY",
    orgInvDate: "2026-08-24",
    reason: "Khách trả hàng hoàn tiền",
  },
};

describe("buildStandardInvoicePayload — hóa đơn điều chỉnh", () => {
  it("gắn khối tham chiếu hóa đơn gốc: ReferenceType=2, tách mẫu số khỏi ký hiệu", () => {
    const [inv] = buildStandardInvoicePayload(baseInput, cfg).InvoiceData as Array<
      Record<string, unknown>
    >;
    expect(inv.ReferenceType).toBe(2);
    expect(inv.OrgInvoiceType).toBe(1);
    expect(inv.OrgInvTemplateNo).toBe("1"); // ký tự đầu của ký hiệu gốc
    expect(inv.OrgInvSeries).toBe("K26TYY"); // phần còn lại
    expect(inv.OrgInvNo).toBe("00000066");
    expect(inv.OrgInvDate).toBe("2026-08-24");
    expect(inv.InvoiceNote).toBe("Khách trả hàng hoàn tiền");
  });

  it("tổng tiền ÂM đúng số hoàn, không chèn dòng ghi chú thừa", () => {
    const [inv] = buildStandardInvoicePayload(baseInput, cfg).InvoiceData as Array<
      Record<string, unknown>
    >;
    expect(inv.TotalAmount).toBe(-79000);
    expect(inv.TotalVATAmount).toBe(-5852);
    expect(inv.TotalAmountWithoutVAT).toBe(-73148);
    const details = inv.OriginalInvoiceDetail as Array<Record<string, unknown>>;
    expect(details).toHaveLength(1); // chỉ dòng hàng âm — meInvoice tự in dòng tham chiếu
    expect(details[0].Quantity).toBe(-1);
    expect(details[0].Amount).toBe(-73148);
    expect(details[0].VATAmount).toBe(-5852);
  });

  it("hóa đơn thường (không adjustment) KHÔNG lộ trường tham chiếu", () => {
    const { adjustment: _drop, ...rest } = baseInput;
    const normal: CreateInvoiceInput = {
      ...rest,
      orderCode: "485236838656212",
      lines: [{ ...baseInput.lines[0], quantity: 1, amountWithoutVat: 73148, vatAmount: 5852 }],
      totalAmount: 79000,
    };
    const [inv] = buildStandardInvoicePayload(normal, cfg).InvoiceData as Array<
      Record<string, unknown>
    >;
    expect(inv.ReferenceType).toBeUndefined();
    expect(inv.OrgInvNo).toBeUndefined();
    expect(inv.TotalAmount).toBe(79000);
  });
});
