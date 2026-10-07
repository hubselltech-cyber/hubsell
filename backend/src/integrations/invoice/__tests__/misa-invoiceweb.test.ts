// Hàm thuần của nhóm API WEB APP (tờ nháp) meInvoice — 08/10/2026. Không gọi mạng.
// Khuôn payload đối chiếu với bài thử sandbox scripts/misa-invoiceweb-module-probe.ts
// (3 ca được MISA nhận: GTGT KCT có MST + email, GTGT 10% khách lẻ, bán hàng 2K).
import { describe, expect, it } from "vitest";

import type { StandardInvoiceConfig } from "../misa-einvoice";
import { buildHqInvoiceInput } from "../issue-hq";
import { buildWebDraftPayload, webInvoiceWithCode, webRefIdFor, webVatRate } from "../misa-invoiceweb";

const cfg: StandardInvoiceConfig = {
  taxCode: "0111626360",
  companyName: "CÔNG TY TNHH CÔNG NGHỆ HUBSELL",
  companyAddress: "Hà Nội",
  clientId: null,
  secretKey: null,
  meinvoiceUsername: "u",
  meinvoicePassword: "p",
  invoicePattern: "1",
  invoiceSeries: "1C26THB",
  signMethod: "ESIGN_CLOUD",
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
};
const tpl = { templateId: "tpl-1", invSeries: "1C26THB" };
const NOW = new Date("2026-10-08T02:30:00Z"); // 09:30 giờ VN

describe("webRefIdFor — RefID GUID ổn định từ mã tham chiếu", () => {
  it("cùng mã → cùng UUID v5; khác mã → khác", () => {
    const a = webRefIdFor("HQLEDGER-abc");
    expect(a).toBe(webRefIdFor("HQLEDGER-abc"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(webRefIdFor("HQLEDGER-abd")).not.toBe(a);
  });
});

describe("webVatRate / webInvoiceWithCode", () => {
  it("map thuế suất Hubsell → web app (-2 KKKNT thành -3), ký hiệu C = có mã", () => {
    expect(webVatRate(-1)).toBe(-1);
    expect(webVatRate(-2)).toBe(-3);
    expect(webVatRate(8)).toBe(8);
    expect(webInvoiceWithCode({ invoiceSeries: "1C26THB" })).toBe(true);
    expect(webInvoiceWithCode({ invoiceSeries: "1K26TYY" })).toBe(false);
  });
});

describe("buildWebDraftPayload", () => {
  it("bán gói KCT cho đơn vị có MST: tờ theo đơn vị, email nhận, dòng KCT, tổng khớp", () => {
    const input = buildHqInvoiceInput({
      refId: "HQLEDGER-e1",
      buyerName: "CÔNG TY KHÁCH",
      buyerTaxCode: "0101243150",
      buyerAddress: "12 Phố Thử",
      buyerEmail: "kt@khach.vn",
      itemName: "Phí dịch vụ phần mềm Hubsell — gói Pro",
      amount: 2990000,
      vatMode: "KCT",
    });
    const p = buildWebDraftPayload(input, cfg, tpl, NOW);
    expect(p.RefID).toBe(webRefIdFor("HQLEDGER-e1"));
    expect(p.InvoiceTemplateID).toBe("tpl-1");
    expect(p.InvSeries).toBe("1C26THB");
    expect(p.InvDate).toBe("2026-10-08T00:00:00+07:00");
    expect(p.CreatedDate).toBe("2026-10-08T09:30:00+07:00");
    expect(p.AccountObjectName).toBe("CÔNG TY KHÁCH");
    expect(p.AccountObjectTaxCode).toBe("0101243150");
    expect(p.AccountObjectAddress).toBe("12 Phố Thử");
    expect(p.ReceiverEmail).toBe("kt@khach.vn");
    expect(p.ContactName).toBeUndefined();
    expect(p.EInvoiceStatus).toBe(1);
    expect(p.CustomField1).toBe("HQLEDGER-e1");
    expect(p.InvoiceDetails).toHaveLength(1);
    const d = p.InvoiceDetails[0];
    expect(d.VATRate).toBe(-1);
    expect(d.AmountOC).toBe(2990000);
    expect(d.VATAmountOC).toBe(0);
    expect(d.UnitName).toBe("Gói");
    expect(p.TotalSaleAmountOC).toBe(2990000);
    expect(p.TotalVATAmountOC).toBe(0);
    expect(p.TotalAmountOC).toBe(2990000);
  });

  it("khách lẻ 10% bóc ngược: ContactName, không MST, tiền thuế từ dòng, tổng = số thu", () => {
    const input = buildHqInvoiceInput({
      refId: "HQLEDGER-e2",
      buyerName: "Nguyễn Văn A",
      itemName: "Phí dịch vụ",
      amount: 110000,
      vatMode: "10",
    });
    const p = buildWebDraftPayload(input, cfg, tpl, NOW);
    expect(p.ContactName).toBe("Nguyễn Văn A");
    expect(p.AccountObjectName).toBeUndefined();
    expect(p.AccountObjectTaxCode).toBeUndefined();
    expect(p.ReceiverEmail).toBeUndefined();
    expect(p.InvoiceDetails[0].VATRate).toBe(10);
    expect(p.InvoiceDetails[0].AmountOC).toBe(100000);
    expect(p.InvoiceDetails[0].VATAmountOC).toBe(10000);
    expect(p.TotalAmountOC).toBe(110000);
  });

  it("hóa đơn BÁN HÀNG (ký hiệu đầu 2): không gửi VATRate, thuế 0; quà tặng là dòng khuyến mại", () => {
    const p = buildWebDraftPayload(
      {
        orderCode: "ORD-1",
        buyerName: "Trần B",
        lines: [
          { name: "Áo", sku: "A1", unitName: "Chiếc", quantity: 2, unitPrice: 50000, vatRate: 0, amountWithoutVat: 100000, vatAmount: 0 },
          { name: "Quà", sku: "Q1", promotion: true, quantity: 1, unitPrice: 0, vatRate: 0, amountWithoutVat: 0, vatAmount: 0 },
        ],
        totalAmount: 100000,
      },
      { ...cfg, invoiceSeries: "2C26THB", defaultUnitName: "Cái" },
      { templateId: "tpl-2", invSeries: "2C26THB" },
      NOW
    );
    expect("VATRate" in p.InvoiceDetails[0]).toBe(false);
    expect(p.InvoiceDetails[0].UnitName).toBe("Chiếc");
    expect(p.InvoiceDetails[1].InventoryItemType).toBe(2);
    expect(p.InvoiceDetails[1].UnitName).toBe("Cái");
    expect(p.TotalSaleAmountOC).toBe(100000);
    expect(p.TotalVATAmountOC).toBe(0);
  });

  it("hóa đơn điều chỉnh: EInvoiceStatus 4 + khối Org tách mẫu số/ký hiệu, dòng âm giữ loại 0", () => {
    const p = buildWebDraftPayload(
      {
        orderCode: "ORD-1-ADJ",
        buyerName: "Trần B",
        lines: [{ name: "Áo", sku: "A1", promotion: true, quantity: -1, unitPrice: 50000, vatRate: 8, amountWithoutVat: -50000, vatAmount: -4000 }],
        totalAmount: -54000,
        adjustment: { orgInvNo: "00000066", orgInvSeries: "1C26THB", orgInvDate: "2026-10-01", reason: "Khách trả hàng" },
      },
      cfg,
      tpl,
      NOW
    );
    expect(p.EInvoiceStatus).toBe(4);
    expect(p.OrgInvNo).toBe("00000066");
    expect(p.OrgInvTemplateNo).toBe("1");
    expect(p.OrgInvSeries).toBe("C26THB");
    expect(p.OrgInvDate).toBe("2026-10-01T00:00:00+07:00");
    expect(p.ChangeReason).toBe("Khách trả hàng");
    expect(p.InvoiceDetails[0].InventoryItemType).toBe(0);
    expect(p.TotalAmountOC).toBe(-54000);
  });
});
