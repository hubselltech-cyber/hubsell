// Hàm thuần của luồng tự xuất HĐĐT + gửi email hóa đơn bán gói (06/10/2026):
// ghép người mua, kiểm người mua, điều kiện tự xuất, dòng hóa đơn, nội dung thư.
// Không chạm DB / MISA / SMTP.
import { describe, expect, it } from "vitest";
import { LedgerDirection } from "@prisma/client";

import {
  buyerProblem,
  composeHqBuyer,
  hqItemNameFor,
  isAutoInvoiceEligible,
} from "../hq-auto-invoice";
import { invoiceIssuedEmailHtml, invoiceIssuedSubject } from "../../../services/customer-mails";

const base = {
  fullName: "Nguyễn Văn A",
  email: "a@shop.vn",
  billingName: null,
  billingTaxCode: null,
  billingAddress: null,
  billingEmail: null,
  invoiceConfig: null,
};

describe("composeHqBuyer — thứ tự ưu tiên nguồn người mua", () => {
  it("không khai gì → khách lẻ theo tên tài khoản + email đăng nhập", () => {
    expect(composeHqBuyer(base)).toEqual({
      name: "Nguyễn Văn A",
      taxCode: null,
      address: null,
      email: "a@shop.vn",
      source: "account",
    });
  });

  it("hồ sơ xuất hóa đơn thắng mọi nguồn khác; email riêng thắng email đăng nhập", () => {
    const b = composeHqBuyer({
      ...base,
      billingName: " CÔNG TY TNHH ABC ",
      billingTaxCode: "0101243150",
      billingAddress: "Hà Nội",
      billingEmail: "ketoan@abc.vn",
      invoiceConfig: { companyName: "SHOP X", taxCode: "0123456789", companyAddress: "HCM" },
    });
    expect(b).toEqual({
      name: "CÔNG TY TNHH ABC",
      taxCode: "0101243150",
      address: "Hà Nội",
      email: "ketoan@abc.vn",
      source: "billing-profile",
    });
  });

  it("chỉ khai MST (không tên) → tên rơi về tên tài khoản, vẫn là hồ sơ khách", () => {
    const b = composeHqBuyer({ ...base, billingTaxCode: "0101243150", billingAddress: "HN" });
    expect(b.name).toBe("Nguyễn Văn A");
    expect(b.source).toBe("billing-profile");
  });

  it("chưa khai hồ sơ nhưng shop đã khai pháp nhân ở module hóa đơn → dùng pháp nhân đó", () => {
    const b = composeHqBuyer({
      ...base,
      invoiceConfig: { companyName: "HỘ KD X", taxCode: "8123456789", companyAddress: "Đà Nẵng" },
    });
    expect(b).toMatchObject({ name: "HỘ KD X", taxCode: "8123456789", address: "Đà Nẵng", source: "invoice-config" });
    expect(b.email).toBe("a@shop.vn");
  });

  it("pháp nhân module hóa đơn thiếu MST → không dùng, về khách lẻ", () => {
    const b = composeHqBuyer({
      ...base,
      invoiceConfig: { companyName: "SHOP", taxCode: "  ", companyAddress: null },
    });
    expect(b.source).toBe("account");
  });
});

describe("buyerProblem — hóa đơn theo đơn vị phải đủ địa chỉ, MST hợp lệ", () => {
  it("khách lẻ không MST → không có vấn đề", () => {
    expect(buyerProblem({ name: "A", taxCode: null, address: null, email: null, source: "account" })).toBeNull();
  });
  it("có MST mà thiếu địa chỉ → báo rõ chỗ sửa", () => {
    const p = buyerProblem({ name: "A", taxCode: "0101243150", address: null, email: null, source: "billing-profile" });
    expect(p).toMatch(/thiếu địa chỉ/);
  });
  it("MST sai dạng → báo sai", () => {
    const p = buyerProblem({ name: "A", taxCode: "12ab", address: "HN", email: null, source: "billing-profile" });
    expect(p).toMatch(/không hợp lệ/);
  });
  it("MST chi nhánh 10-3 số + địa chỉ → OK", () => {
    expect(
      buyerProblem({ name: "A", taxCode: "0101243150-732", address: "HN", email: null, source: "billing-profile" })
    ).toBeNull();
  });
});

describe("isAutoInvoiceEligible — chỉ khoản thu phí gói từ lúc bật công tắc", () => {
  const on = { autoIssueEnabled: true, autoIssueEnabledAt: new Date("2026-10-06T00:00:00Z") };
  const entry = (over: Partial<{ direction: LedgerDirection; packagePaymentId: string | null; occurredAt: Date }> = {}) => ({
    direction: LedgerDirection.IN,
    packagePaymentId: "pp1",
    occurredAt: new Date("2026-10-07T00:00:00Z"),
    ...over,
  });

  it("công tắc tắt → không", () => {
    expect(isAutoInvoiceEligible({ autoIssueEnabled: false, autoIssueEnabledAt: null }, entry())).toBe(false);
  });
  it("khoản thu phí gói sau mốc bật → có", () => {
    expect(isAutoInvoiceEligible(on, entry())).toBe(true);
  });
  it("khoản thu cũ hơn mốc bật → không (có thể đã lập tay trên meInvoice)", () => {
    expect(isAutoInvoiceEligible(on, entry({ occurredAt: new Date("2026-10-05T23:59:59Z") }))).toBe(false);
  });
  it("khoản chi hoặc bút toán ghi tay (không gắn thanh toán gói) → không", () => {
    expect(isAutoInvoiceEligible(on, entry({ direction: LedgerDirection.OUT }))).toBe(false);
    expect(isAutoInvoiceEligible(on, entry({ packagePaymentId: null }))).toBe(false);
  });
  it("bật mà chưa có mốc (dữ liệu cũ) → mọi khoản thu phí gói đều được", () => {
    expect(
      isAutoInvoiceEligible({ autoIssueEnabled: true, autoIssueEnabledAt: null }, entry({ occurredAt: new Date(0) }))
    ).toBe(true);
  });
});

describe("hqItemNameFor — dòng hóa đơn nêu gói, kỳ và khoảng hiệu lực", () => {
  it("ghi đủ gói + kỳ + ngày VN", () => {
    const name = hqItemNameFor({
      planName: "Growth",
      cycle: "YEARLY",
      periodStart: new Date("2026-10-06T03:00:00Z"),
      periodEnd: new Date("2027-10-06T03:00:00Z"),
    });
    expect(name).toBe("Phí dịch vụ phần mềm Hubsell — gói Growth, 12 tháng (06/10/2026 – 06/10/2027)");
  });
});

describe("thư hóa đơn đã phát hành", () => {
  const input = {
    fullName: "Nguyễn Văn <A>",
    buyerName: "CÔNG TY TNHH ABC",
    buyerTaxCode: "0101243150",
    invoiceNo: "00000012",
    invoiceSeries: "1C26THB",
    lookupCode: "TX-123",
    itemName: "Phí dịch vụ phần mềm Hubsell — gói Growth, 12 tháng",
    amount: 2990000,
    issuedAt: new Date("2026-10-06T03:00:00Z"),
    hasPdf: true,
  };

  it("tiêu đề nêu số hóa đơn + nội dung", () => {
    expect(invoiceIssuedSubject(input)).toBe(
      "Hubsell — Hóa đơn điện tử số 00000012 (Phí dịch vụ phần mềm Hubsell — gói Growth, 12 tháng)"
    );
  });

  it("có PDF: nói rõ đính kèm; escape tên khách; có mã tra cứu + link meInvoice", () => {
    const html = invoiceIssuedEmailHtml(input);
    expect(html).toContain("đính kèm thư này");
    expect(html).toContain("Nguyễn Văn &lt;A&gt;");
    expect(html).toContain("0101243150");
    expect(html).toContain("TX-123");
    expect(html).toContain("meinvoice.vn/tra-cuu");
    expect(html).toContain("2.990.000₫");
    expect(html).toContain("06/10/2026");
  });

  it("không PDF: hướng dẫn tra cứu thay vì nói đính kèm; khách lẻ không in dòng MST", () => {
    const html = invoiceIssuedEmailHtml({ ...input, hasPdf: false, buyerTaxCode: null });
    expect(html).not.toContain("đính kèm thư này");
    expect(html).toContain("mã tra cứu");
    expect(html).not.toContain("Mã số thuế");
  });
});
