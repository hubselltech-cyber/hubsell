import { describe, expect, it } from "vitest";

import {
  decideAfterFailure,
  normalizeAutoIssueTrigger,
  vnStartOfDay,
} from "../invoice/auto-issue-policy";
import {
  explainInvoiceError,
  InvoiceProviderError,
  providerErrorFromBody,
} from "../invoice/invoice-errors";
import { buildInvoiceLines, normalizeBuyerTaxCode } from "../invoice/issue-order";
import {
  buildStandardInvoicePayload,
  isSalesInvoiceSeries,
  type StandardInvoiceConfig,
} from "../invoice/misa-einvoice";

// ============================================================
// VÁ 4 LỖ HỔNG XUẤT HÓA ĐƠN (19/09/2026 — anh Trung: "đừng để lúc xảy ra vấn
// đề"). Mỗi khối bên dưới khóa MỘT lỗi đã soi ra bằng chứng từ thật trên sandbox:
//   1. Ô Đơn vị tính in TRỐNG (PDF hóa đơn bán hàng 00000005).
//   2. Hóa đơn BÁN HÀNG (ký hiệu đầu 2 — hộ KD) bị bóc ngược thuế nếu shop lỡ
//      để thuế suất > 0.
//   3. Lỗi NCC in nguyên mã tiếng Anh + worker đốt cả lô khi lỗi ở tài khoản.
// ============================================================

const CFG: StandardInvoiceConfig = {
  taxCode: "0101243150-732",
  companyName: "Shop test",
  companyAddress: "HN",
  clientId: null,
  secretKey: null,
  meinvoiceUsername: "u",
  meinvoicePassword: "p",
  invoicePattern: "2",
  invoiceSeries: "2C26TAA",
  defaultUnitName: "Cái",
  signMethod: "ESIGN_CLOUD",
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
};

describe("Đơn vị tính", () => {
  it("SKU khai riêng thắng mặc định shop; không khai thì dùng mặc định", () => {
    const lines = buildInvoiceLines(
      [
        { name: "Áo", sku: "A1", quantity: 1, price: 89_000, vatRate: null, unitName: " Bộ " },
        { name: "Tất", sku: "T1", quantity: 2, price: 10_000, vatRate: null, unitName: null },
        { name: "Mũ", sku: "M1", quantity: 1, price: 50_000, vatRate: null, unitName: "  " },
      ],
      0,
      0,
      { defaultUnitName: "Cái" }
    );
    expect(lines.map((l) => l.unitName)).toEqual(["Bộ", "Cái", "Cái"]);
  });

  it("payload MISA mang UnitName từng dòng", () => {
    const lines = buildInvoiceLines(
      [{ name: "Áo", sku: "A1", quantity: 1, price: 89_000, vatRate: null, unitName: "Chiếc" }],
      0,
      0,
      { defaultUnitName: "Cái" }
    );
    const payload = buildStandardInvoicePayload(
      { orderCode: "DH1", buyerName: "Bán cho người tiêu dùng", lines, totalAmount: 89_000 },
      CFG
    );
    expect(payload.InvoiceData[0].OriginalInvoiceDetail[0]).toMatchObject({ UnitName: "Chiếc" });
  });

  it("dòng KHÔNG mang unitName (snapshot hóa đơn gốc đời trước 19/09 khi lập điều chỉnh) → đỡ bằng mặc định shop", () => {
    const payload = buildStandardInvoicePayload(
      {
        orderCode: "DH1-DC1",
        buyerName: "Bán cho người tiêu dùng",
        lines: [
          { name: "Áo", sku: "A1", quantity: -1, unitPrice: 89_000, vatRate: 0, amountWithoutVat: -89_000, vatAmount: 0 },
        ],
        totalAmount: -89_000,
      },
      CFG
    );
    expect(payload.InvoiceData[0].OriginalInvoiceDetail[0]).toMatchObject({ UnitName: "Cái" });
  });
});

describe("Hóa đơn BÁN HÀNG (ký hiệu đầu 2)", () => {
  it("nhận diện theo ký tự đầu của ký hiệu", () => {
    expect(isSalesInvoiceSeries("2C26TAA")).toBe(true);
    expect(isSalesInvoiceSeries("2K26TYY")).toBe(true);
    expect(isSalesInvoiceSeries("1C26TAA")).toBe(false);
    expect(isSalesInvoiceSeries(null)).toBe(false);
  });

  it("bỏ qua MỌI thuế suất (mặc định shop lẫn khai ở SKU) — thành tiền = đúng giá bán", () => {
    const lines = buildInvoiceLines(
      [
        { name: "Áo", sku: "A1", quantity: 1, price: 89_000, vatRate: null },
        { name: "Quần", sku: "Q1", quantity: 2, price: 120_000, vatRate: 10 },
      ],
      8,
      0,
      { salesInvoice: true }
    );
    expect(lines.map((l) => l.vatRate)).toEqual([0, 0]);
    expect(lines.map((l) => l.vatAmount)).toEqual([0, 0]);
    expect(lines.map((l) => l.amountWithoutVat)).toEqual([89_000, 240_000]);
  });

  it("hóa đơn GTGT (ký hiệu đầu 1) giữ nguyên hành vi bóc ngược", () => {
    const [l] = buildInvoiceLines(
      [{ name: "Áo", sku: "A1", quantity: 1, price: 89_000, vatRate: null }],
      8,
      0,
      { salesInvoice: false }
    );
    expect(l.amountWithoutVat + l.vatAmount).toBe(89_000);
    expect(l.vatAmount).toBe(6_593);
  });
});

describe("Dịch lỗi NCC → việc cần làm", () => {
  // Body THẬT bắt từ sandbox 19/09/2026 (gọi /invoice/token với mật khẩu sai).
  const WRONG_PASSWORD_BODY =
    '{"Success":false,"ErrorCode":"UnAuthorize","DescriptionErrorCode":"Sai thông tin đăng nhập","Errors":["MisaIdError"],"Data":"","CustomData":""}';

  it("sai mật khẩu meInvoice → tầm TÀI KHOẢN, nói rõ chỗ sửa, giữ mã + mô tả gốc", () => {
    const e = explainInvoiceError(providerErrorFromBody("MISA từ chối cấp token", WRONG_PASSWORD_BODY, 400));
    expect(e.scope).toBe("ACCOUNT");
    expect(e.code).toBe("MisaIdError");
    expect(e.message).toContain("mật khẩu meInvoice");
    expect(e.message).toContain("Sai thông tin đăng nhập");
  });

  it("mất mạng / MISA 5xx → TẠM THỜI (không ngắt mạch)", () => {
    expect(explainInvoiceError(new InvoiceProviderError("x", { network: true })).scope).toBe("TRANSIENT");
    expect(explainInvoiceError(providerErrorFromBody("x", "<html>502</html>", 502)).scope).toBe("TRANSIENT");
  });

  it("số hóa đơn không liên tục → TẠM THỜI; trùng mã đơn → riêng ĐƠN + dặn đừng lập tay thêm", () => {
    expect(
      explainInvoiceError(new InvoiceProviderError("x", { code: "InvoiceNumberNotCotinuous" })).scope
    ).toBe("TRANSIENT");
    const dup = explainInvoiceError(new InvoiceProviderError("x", { code: "InvoiceDuplicated" }));
    expect(dup.scope).toBe("ORDER");
    expect(dup.message).toContain("ĐỪNG lập tay");
  });

  it("mã báo thiếu trường → nêu tên trường", () => {
    const e = explainInvoiceError(new InvoiceProviderError("x", { code: "Invalid_[Invoice.TotalSaleAmount]" }));
    expect(e.message).toContain("Invoice.TotalSaleAmount");
    expect(e.scope).toBe("ORDER");
  });

  it("mã LẠ → giữ mô tả tiếng Việt của MISA, tầm ĐƠN (lưới lặp mã ở worker lo phần còn lại)", () => {
    const e = explainInvoiceError(
      new InvoiceProviderError("x", { code: "MaChuaTungThay", description: "Hết số lượng hóa đơn" })
    );
    expect(e.scope).toBe("ORDER");
    expect(e.message).toContain("Hết số lượng hóa đơn");
    expect(e.message).toContain("MaChuaTungThay");
  });

  it("lỗi thường (thiếu cấu hình…) giữ nguyên câu tiếng Việt sẵn có", () => {
    expect(explainInvoiceError(new Error("Chưa đủ cấu hình")).message).toBe("Chưa đủ cấu hình");
  });
});

describe("Ngắt mạch worker tự động phát hành", () => {
  it("lỗi TÀI KHOẢN → ngắt ngay từ đơn đầu", () => {
    expect(decideAfterFailure("ACCOUNT", 1)).toBe("PAUSE");
  });
  it("lỗi TẠM THỜI → bỏ phần còn lại của lượt, không ngắt mạch", () => {
    expect(decideAfterFailure("TRANSIENT", 1)).toBe("STOP_RUN");
  });
  it("lỗi riêng ĐƠN → chạy tiếp; cùng mã lặp 3 đơn liên tiếp → ngắt", () => {
    expect(decideAfterFailure("ORDER", 1)).toBe("CONTINUE");
    expect(decideAfterFailure("ORDER", 2)).toBe("CONTINUE");
    expect(decideAfterFailure("ORDER", 3)).toBe("PAUSE");
    expect(decideAfterFailure(undefined, 3)).toBe("PAUSE");
  });
  it("mốc xuất: giá trị lạ/thiếu → DELIVERED (mốc đúng luật)", () => {
    expect(normalizeAutoIssueTrigger("SETTLED")).toBe("SETTLED");
    expect(normalizeAutoIssueTrigger("DELIVERED")).toBe("DELIVERED");
    expect(normalizeAutoIssueTrigger(undefined)).toBe("DELIVERED");
    expect(normalizeAutoIssueTrigger("abc")).toBe("DELIVERED");
  });
});

describe("Hết số hóa đơn / chứng thư số (mã chính thức doc.meinvoice.vn)", () => {
  it.each(["LicenseInfo_OutOfInvoice", "LicenseInfo_NotBuy", "LicenseInfo_Expired"])(
    "%s → tầm TÀI KHOẢN + chỉ chỗ mua thêm",
    (code) => {
      const e = explainInvoiceError(new InvoiceProviderError("x", { code }));
      expect(e.scope).toBe("ACCOUNT");
      expect(e.message).toContain("Quản lý tài nguyên");
    }
  );
  it("chứng thư số bị thu hồi / hết hạn → tầm TÀI KHOẢN", () => {
    for (const code of ["CertRevocation", "SigningTimeNotInRegistration", "InvalidCertByRegistration"]) {
      expect(explainInvoiceError(new InvoiceProviderError("x", { code })).scope).toBe("ACCOUNT");
    }
  });
  it("mã báo thiếu trường kiểu InvoiceDetail_/RequireError_ → nêu tên trường", () => {
    expect(
      explainInvoiceError(new InvoiceProviderError("x", { code: "InvoiceDetail_UnitName" })).message
    ).toContain('"UnitName"');
  });
});

describe("Quà tặng 0đ", () => {
  it("dòng giá 0 → promotion, payload ItemType 2; dòng thường vẫn 1", () => {
    const lines = buildInvoiceLines(
      [
        { name: "Áo", sku: "A1", quantity: 1, price: 89_000, vatRate: null },
        { name: "Quà", sku: "G1", quantity: 1, price: 0, vatRate: null },
      ],
      0
    );
    expect(lines.map((l) => l.promotion ?? false)).toEqual([false, true]);
    const payload = buildStandardInvoicePayload(
      { orderCode: "DH1", buyerName: "Bán cho người tiêu dùng", lines, totalAmount: 89_000 },
      CFG
    );
    expect(payload.InvoiceData[0].OriginalInvoiceDetail.map((d) => d.ItemType)).toEqual([1, 2]);
  });

  it("dòng bị voucher người bán ăn hết KHÔNG phải quà tặng", () => {
    const [l] = buildInvoiceLines(
      [{ name: "Áo", sku: "A1", quantity: 1, price: 10_000, vatRate: null }],
      0,
      10_000
    );
    expect(l.amountWithoutVat).toBe(0);
    expect(l.promotion).toBeUndefined();
  });

  it("hóa đơn điều chỉnh giữ ItemType 1 cho mọi dòng", () => {
    const payload = buildStandardInvoicePayload(
      {
        orderCode: "DH1-DC1",
        buyerName: "x",
        lines: [
          { name: "Quà", sku: "G1", promotion: true, quantity: -1, unitPrice: 0, vatRate: 0, amountWithoutVat: 0, vatAmount: 0 },
        ],
        totalAmount: 0,
        adjustment: { orgInvNo: "00000001", orgInvSeries: "2C26TAA", orgInvDate: "2026-09-19", reason: "Khách trả hàng" },
      },
      CFG
    );
    expect(payload.InvoiceData[0].OriginalInvoiceDetail[0].ItemType).toBe(1);
  });
});

describe("MST / số định danh người mua", () => {
  it("chuẩn hóa khoảng trắng, dấu chấm; nhận 10 / 10-3 / 13 / 12 số", () => {
    expect(normalizeBuyerTaxCode(" 0101 243 150 ")).toBe("0101243150");
    expect(normalizeBuyerTaxCode("0101243150-001")).toBe("0101243150-001");
    expect(normalizeBuyerTaxCode("0101243150001")).toBe("0101243150001");
    expect(normalizeBuyerTaxCode("026.093.012.010")).toBe("026093012010");
  });
  it("sai dạng → null (chặn trước khi gọi NCC)", () => {
    expect(normalizeBuyerTaxCode("12345")).toBeNull();
    expect(normalizeBuyerTaxCode("A**b")).toBeNull();
    expect(normalizeBuyerTaxCode("01012431501")).toBeNull();
  });
});

describe("Mốc ngày bật tự động", () => {
  it("0h giờ VN của ngày bật — bật 23:30 VN ngày 19 thì mốc là 00:00 VN ngày 19", () => {
    // 19/09 23:30 VN = 19/09 16:30 UTC → 0h VN ngày 19 = 18/09 17:00 UTC
    expect(vnStartOfDay(new Date("2026-09-19T16:30:00Z")).toISOString()).toBe("2026-09-18T17:00:00.000Z");
    // 20/09 00:10 VN = 19/09 17:10 UTC → 0h VN ngày 20 = 19/09 17:00 UTC
    expect(vnStartOfDay(new Date("2026-09-19T17:10:00Z")).toISOString()).toBe("2026-09-19T17:00:00.000Z");
  });
});
