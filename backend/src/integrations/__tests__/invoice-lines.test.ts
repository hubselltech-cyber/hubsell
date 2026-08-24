import { describe, expect, it } from "vitest";

import { buildInvoiceLines } from "../invoice/issue-order";

// ============================================================
// BÓC NGƯỢC THUẾ GTGT TỪ GIÁ BÁN (24/08 — anh Trung chốt sau khảo sát
// Salework/chuẩn kế toán TMĐT): giá trên sàn là giá khách trả ĐÃ GỒM thuế,
// hóa đơn phải ra tổng ĐÚNG số đó. Bất biến quan trọng nhất:
//   amountWithoutVat + vatAmount = round(price × quantity)  (từng dòng)
// — thuế tính bằng phép TRỪ, không phải nhân % rồi cộng lên (lệch 1đ).
// ============================================================

describe("buildInvoiceLines — bóc ngược thuế từ giá bán", () => {
  it("thuế 0% → giữ nguyên giá, không thuế (mặc định của shop)", () => {
    const [l] = buildInvoiceLines(
      [{ name: "Áo", sku: "A1", quantity: 2, price: 89_000, vatRate: null }],
      0
    );
    expect(l.amountWithoutVat).toBe(178_000);
    expect(l.vatAmount).toBe(0);
    expect(l.vatRate).toBe(0);
  });

  it("8% SL=1: đơn 89.000đ → 82.407 + 6.593 = đúng 89.000 khách trả", () => {
    const [l] = buildInvoiceLines(
      [{ name: "Áo", sku: "A1", quantity: 1, price: 89_000, vatRate: null }],
      8
    );
    expect(l.amountWithoutVat).toBe(82_407);
    expect(l.vatAmount).toBe(6_593);
    expect(l.amountWithoutVat + l.vatAmount).toBe(89_000);
    expect(l.unitPrice).toBe(82_407); // SL=1 → đơn giá = thành tiền chưa thuế
  });

  it("10% SL=3 giá lẻ: tổng dòng vẫn khớp tuyệt đối, đơn giá in 2 số lẻ", () => {
    const [l] = buildInvoiceLines(
      [{ name: "Kẹp", sku: "K1", quantity: 3, price: 33_333, vatRate: 10 }],
      0
    );
    const gross = Math.round(33_333 * 3); // 99.999
    expect(l.amountWithoutVat + l.vatAmount).toBe(gross);
    expect(l.amountWithoutVat).toBe(90_908); // round(99.999×100/110)
    expect(l.vatAmount).toBe(9_091);
    expect(l.unitPrice).toBeCloseTo(30_302.67, 2);
  });

  it("thuế suất SKU khai riêng THẮNG mức mặc định; null/0 dùng mặc định", () => {
    const lines = buildInvoiceLines(
      [
        { name: "A", sku: "A", quantity: 1, price: 100_000, vatRate: 5 },
        { name: "B", sku: "B", quantity: 1, price: 100_000, vatRate: null },
        { name: "C", sku: "C", quantity: 1, price: 100_000, vatRate: 0 },
      ],
      8
    );
    expect(lines.map((l) => l.vatRate)).toEqual([5, 8, 8]);
  });

  it("nhiều dòng nhiều thuế suất: tổng hóa đơn = ĐÚNG tổng khách trả", () => {
    const items = [
      { name: "A", sku: "A", quantity: 2, price: 49_600, vatRate: 8 },
      { name: "B", sku: "B", quantity: 1, price: 178_000, vatRate: 10 },
      { name: "C", sku: "C", quantity: 5, price: 24_799, vatRate: null },
    ];
    const lines = buildInvoiceLines(items, 5);
    const invoiceTotal = lines.reduce((s, l) => s + l.amountWithoutVat + l.vatAmount, 0);
    const customerPaid = items.reduce((s, it) => s + Math.round(it.price * it.quantity), 0);
    expect(invoiceTotal).toBe(customerPaid);
  });
});
