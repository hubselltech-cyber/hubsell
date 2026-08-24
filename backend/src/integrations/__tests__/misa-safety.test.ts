// ============================================================
// CHỐT AN TOÀN PHÁT HÀNH HÓA ĐƠN — test hàng rào MISA_ALLOW_PUBLISH.
//
// Đây là test BẢO VỆ TIỀN THẬT/CHỨNG TỪ THẬT: sandbox của MISA cho app Hubsell
// còn "Chưa mở khóa", nên lệnh phát hành có thể sinh hóa đơn thật có mã Cơ quan
// Thuế. Test khẳng định 3 điều:
//   1. Mặc định (không có env) → CHẶN cả hai luồng kê khai và máy tính tiền.
//   2. Chặn xảy ra TRƯỚC khi kiểm cấu hình và TRƯỚC mọi lời gọi mạng — kể cả
//      khi truyền cấu hình đầy đủ vẫn không có request nào bay ra ngoài.
//   3. Bật cờ đúng cách mới mở; giá trị lạ ("0", "yes"…) vẫn chặn.
// ============================================================
import "./load-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertPublishAllowed, isPublishAllowed } from "../invoice/misa-safety";
import { publishStandardInvoice } from "../invoice/misa-einvoice";
import { publishPosInvoice } from "../invoice/misa-pos";
import type { CreateInvoiceInput } from "../invoice/types";

const ORIGINAL_FLAG = process.env.MISA_ALLOW_PUBLISH;

/** Đơn hàng mẫu tối thiểu để gọi hàm phát hành. */
const INPUT: CreateInvoiceInput = {
  orderCode: "TEST-SAFETY-001",
  buyerName: "Khách lẻ",
  totalAmount: 110_000,
  lines: [
    {
      name: "Áo thun",
      sku: "AT-01",
      quantity: 1,
      unitPrice: 100_000,
      vatRate: 10,
      amountWithoutVat: 100_000,
      vatAmount: 10_000,
    },
  ],
};

/** Cấu hình ĐẦY ĐỦ — cố tình hợp lệ để chứng minh chốt chặn trước cấu hình. */
const FULL_STANDARD_CFG = {
  taxCode: "026093012010",
  companyName: "HỘ KINH DOANH HUBSELL",
  companyAddress: "Lai Xá, Hoài Đức, Hà Nội",
  clientId: "client-id",
  secretKey: "secret-key",
  meinvoiceUsername: "shop@test.local",
  meinvoicePassword: "matkhau-test",
  invoicePattern: "1",
  invoiceSeries: "1C26TAA",
  signMethod: "USB_TOKEN",
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
};

const FULL_POS_CFG = {
  taxCode: "026093012010",
  companyName: "HỘ KINH DOANH HUBSELL",
  companyAddress: "Lai Xá, Hoài Đức, Hà Nội",
  posClientId: "pos-client-id",
  posSecretKey: "pos-secret-key",
  posCodePrefix: "AA/26E",
  posMachineId: "POS-01",
  posSeries: "1C26MAA",
};

describe("Chốt an toàn phát hành hóa đơn MISA", () => {
  beforeEach(() => {
    delete process.env.MISA_ALLOW_PUBLISH;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_FLAG === undefined) delete process.env.MISA_ALLOW_PUBLISH;
    else process.env.MISA_ALLOW_PUBLISH = ORIGINAL_FLAG;
  });

  it("mặc định KHÔNG cho phép phát hành", () => {
    expect(isPublishAllowed()).toBe(false);
    expect(() => assertPublishAllowed("hóa đơn kê khai")).toThrow(/CHẶN AN TOÀN/);
  });

  it('chỉ mở khi cờ là "1" hoặc "true"; giá trị lạ vẫn chặn', () => {
    for (const value of ["1", "true", "TRUE", " true "]) {
      process.env.MISA_ALLOW_PUBLISH = value;
      expect(isPublishAllowed(), `cờ ${JSON.stringify(value)} phải MỞ`).toBe(true);
    }
    for (const value of ["0", "false", "yes", "", "on"]) {
      process.env.MISA_ALLOW_PUBLISH = value;
      expect(isPublishAllowed(), `cờ ${JSON.stringify(value)} phải CHẶN`).toBe(false);
    }
  });

  it("chặn luồng KÊ KHAI trước khi phát sinh bất kỳ request mạng nào", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(publishStandardInvoice(INPUT, FULL_STANDARD_CFG)).rejects.toThrow(
      /CHẶN AN TOÀN/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chặn luồng MÁY TÍNH TIỀN trước khi phát sinh bất kỳ request mạng nào", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(publishPosInvoice(INPUT, FULL_POS_CFG)).rejects.toThrow(/CHẶN AN TOÀN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("thông điệp chặn nói rõ luồng bị chặn và cách mở", () => {
    try {
      assertPublishAllowed("hóa đơn máy tính tiền");
      throw new Error("đáng lẽ phải ném lỗi");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("hóa đơn máy tính tiền");
      expect(msg).toContain("MISA_ALLOW_PUBLISH=1");
      expect(msg).toContain("Chưa mở khóa");
    }
  });
});
