import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  CODE128_PATTERNS,
  code128TotalModules,
  encodeCode128B,
} from "../../services/fulfillment/code128";
import { buildPickListPdf } from "../../services/fulfillment/pick-list-pdf";
import { mergePdfParts } from "../../services/fulfillment/merge-pdf";
import { readFulfillDefaults } from "../../services/fulfillment/types";

describe("Code 128 B", () => {
  it("bảng mẫu chuẩn: 107 ký hiệu, mỗi ký hiệu 11 mô-đun (STOP 13)", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.forEach((p, i) => {
      const modules = [...p].reduce((s, c) => s + Number(c), 0);
      expect(modules, `pattern ${i}`).toBe(i === 106 ? 13 : 11);
      expect(p.length).toBe(i === 106 ? 7 : 6);
    });
  });

  it("checksum theo chuẩn: 'A' → 34, mã đơn Shopee ra dãy vạch hợp lệ", () => {
    // START_B(104) + 1×33 ('A') = 137 → 137 mod 103 = 34
    const bars = encodeCode128B("A");
    // start(6) + 'A'(6) + checksum(6) + stop(7, đã gồm vạch kết thúc)
    expect(bars).toHaveLength(6 + 6 + 6 + 7);
    const checksum = bars.slice(12, 18).map((b) => b.width).join("");
    expect(checksum).toBe(CODE128_PATTERNS[34]);

    const order = encodeCode128B("2609044PUTPY83");
    expect(code128TotalModules(order)).toBe(11 * (1 + 14 + 1) + 13);
    expect(order[0].dark).toBe(true);
    expect(order[order.length - 1].dark).toBe(true);
  });
});

describe("Phiếu nhặt hàng + ghép PDF", () => {
  it("dựng phiếu A6 có dấu tiếng Việt, đơn nhiều SKU tự sang trang", async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      sku: `TC0${i}-ĐEN`,
      name: `Túi đeo chéo nam O.U.M.U da lì mịn cao cấp phân loại số ${i} — tên rất dài để thử bẻ dòng`,
      quantity: i + 1,
    }));
    const bytes = await buildPickListPdf({
      orderCode: "2609044PUTPY83",
      channelLabel: "Shopee",
      shopName: "DarkMan Store",
      trackingCode: "VN261389287510D",
      carrierLabel: "SPX Instant",
      isExpress: true,
      createdAt: new Date("2026-09-04T02:13:00+07:00"),
      items,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(298);
    expect(Math.round(height)).toBe(420);
  });

  it("ghép vận đơn + phiếu nhặt theo thứ tự, bỏ qua phần hỏng", async () => {
    const pick = await buildPickListPdf({
      orderCode: "ABC123",
      channelLabel: "Lazada",
      shopName: "Hi.Bé",
      trackingCode: null,
      carrierLabel: "Chưa gán",
      isExpress: false,
      createdAt: new Date(),
      items: [{ sku: "S1", name: "Áo", quantity: 2 }],
    });
    const fake = await PDFDocument.create();
    fake.addPage([100, 100]);
    const label = Buffer.from(await fake.save());
    const merged = await mergePdfParts([
      { label, pickList: pick },
      { label: Buffer.from("không phải pdf"), pickList: pick },
    ]);
    expect(merged.pages).toBe(3);
    expect(merged.broken).toBe(1);
    expect(merged.pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("đọc mặc định gian phòng thủ", () => {
    expect(readFulfillDefaults(null)).toBeNull();
    expect(readFulfillDefaults({ method: "X" })).toBeNull();
    expect(readFulfillDefaults({ method: "PICKUP", addressId: "1", junk: 1 })).toEqual({
      method: "PICKUP",
      addressId: "1",
      branchId: undefined,
    });
  });
});
