import { describe, expect, it } from "vitest";

import { buildAdjustmentLines } from "../invoice/adjust-order";
import {
  buildStandardInvoicePayload,
  type StandardInvoiceConfig,
} from "../invoice/misa-einvoice";
import type { CreateInvoiceInput, InvoiceLine } from "../invoice/types";

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

// ============================================================
// buildAdjustmentLines — 3 phạm vi điều chỉnh (25/08 rạng sáng, trigger THEO
// SÀN): FULL âm nguyên hóa đơn; ITEMS âm đúng dòng + số lượng sàn báo trả;
// AMOUNT giảm giá trị phân bổ (khách giữ hàng). Bất biến: tổng âm = đúng phần
// gross bị trả, từng dòng net+vat khớp tuyệt đối.
// ============================================================

const SNAPSHOT: InvoiceLine[] = [
  { name: "A", sku: "A1", quantity: 2, unitPrice: 46296.3, vatRate: 8, amountWithoutVat: 92593, vatAmount: 7407 }, // gross 100.000
  { name: "B", sku: "B1", quantity: 1, unitPrice: 45455, vatRate: 10, amountWithoutVat: 45455, vatAmount: 4545 }, // gross 50.000
];

describe("buildAdjustmentLines — phạm vi điều chỉnh", () => {
  it("FULL: âm nguyên hóa đơn, tổng = -150.000", () => {
    const lines = buildAdjustmentLines(SNAPSHOT, { kind: "FULL" });
    const total = lines.reduce((s, l) => s + l.amountWithoutVat + l.vatAmount, 0);
    expect(total).toBe(-150_000);
    expect(lines.map((l) => l.quantity)).toEqual([-2, -1]);
  });

  it("ITEMS: trả 1/2 dòng A → chỉ 1 dòng âm, gross đúng một nửa", () => {
    const lines = buildAdjustmentLines(SNAPSHOT, {
      kind: "ITEMS",
      bySku: new Map([["A1", 1]]),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(-1);
    expect(lines[0].amountWithoutVat + lines[0].vatAmount).toBe(-50_000); // nửa gross 100k
    // Bóc ngược VAT trên phần trả: 50.000 @8% → 46.296 + 3.704
    expect(lines[0].amountWithoutVat).toBe(-46_296);
    expect(lines[0].vatAmount).toBe(-3_704);
  });

  it("ITEMS: số lượng trả vượt số mua → kẹp về nguyên dòng; SKU lạ bỏ qua", () => {
    const lines = buildAdjustmentLines(SNAPSHOT, {
      kind: "ITEMS",
      bySku: new Map([
        ["B1", 5],
        ["KHONG-TON-TAI", 1],
      ]),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].sku).toBe("B1");
    expect(lines[0].amountWithoutVat + lines[0].vatAmount).toBe(-50_000);
  });

  it("ITEMS không khớp dòng nào → [] (nơi gọi phải báo lỗi, không âm bừa)", () => {
    expect(
      buildAdjustmentLines(SNAPSHOT, { kind: "ITEMS", bySku: new Map([["X", 1]]) })
    ).toEqual([]);
  });

  it("AMOUNT: hoàn 30.000 khách giữ hàng → phân bổ 20k/10k, số lượng để 0", () => {
    const lines = buildAdjustmentLines(SNAPSHOT, { kind: "AMOUNT", amount: 30_000 });
    const total = lines.reduce((s, l) => s + l.amountWithoutVat + l.vatAmount, 0);
    expect(total).toBe(-30_000);
    expect(lines.every((l) => l.quantity === 0)).toBe(true);
    expect(lines[0].amountWithoutVat + lines[0].vatAmount).toBe(-20_000); // tỷ trọng 100k/150k
    expect(lines[1].amountWithoutVat + lines[1].vatAmount).toBe(-10_000);
  });

  it("AMOUNT vượt tổng hóa đơn → kẹp về đúng tổng", () => {
    const lines = buildAdjustmentLines(SNAPSHOT, { kind: "AMOUNT", amount: 999_999 });
    const total = lines.reduce((s, l) => s + l.amountWithoutVat + l.vatAmount, 0);
    expect(total).toBe(-150_000);
  });
});

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
