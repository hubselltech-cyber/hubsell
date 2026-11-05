import { describe, expect, it } from "vitest";
import {
  ean13CheckDigit,
  internalBarcodeFromSeq,
  isInternalBarcode,
  isValidEan13,
  parseBarcodeInput,
} from "../product-barcode";

describe("ean13CheckDigit", () => {
  it("khớp các mã EAN-13 thật", () => {
    // Hai mã mẫu hay dùng trong tài liệu EAN-13.
    expect(ean13CheckDigit("400638133393")).toBe(1);
    expect(ean13CheckDigit("590123412345")).toBe(7);
  });

  it("tổng chia hết cho 10 thì số kiểm tra là 0, không phải 10", () => {
    // 2 + 0×3 + … + 6 + 4×3 = 20 → (10 − 0) % 10 = 0
    expect(ean13CheckDigit("200000000064")).toBe(0);
  });

  it("từ chối chuỗi không đủ 12 chữ số", () => {
    expect(() => ean13CheckDigit("12345")).toThrow();
    expect(() => ean13CheckDigit("20000000000A")).toThrow();
  });
});

describe("isValidEan13", () => {
  it("nhận mã đúng, loại mã sai số kiểm tra hoặc sai độ dài", () => {
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("4006381333932")).toBe(false);
    expect(isValidEan13("400638133393")).toBe(false);
    expect(isValidEan13("2200000001")).toBe(false);
  });
});

describe("internalBarcodeFromSeq", () => {
  it("số thứ tự 1 → 2000000000015 (đúng công thức của hàm SQL product_new_barcode)", () => {
    expect(internalBarcodeFromSeq(1)).toBe("2000000000015");
  });

  it("luôn 13 số, bắt đầu bằng 2, hợp lệ EAN-13", () => {
    for (const seq of [1, 9, 10, 123, 4567, 1_000_000, 99_999_999_999]) {
      const code = internalBarcodeFromSeq(seq);
      expect(code).toHaveLength(13);
      expect(isInternalBarcode(code)).toBe(true);
    }
  });

  it("số thứ tự liền nhau cho mã khác nhau", () => {
    const codes = new Set(Array.from({ length: 500 }, (_, i) => internalBarcodeFromSeq(i + 1)));
    expect(codes.size).toBe(500);
  });

  it("ngoài dãy 11 chữ số thì báo lỗi, không cắt số", () => {
    expect(() => internalBarcodeFromSeq(0)).toThrow();
    expect(() => internalBarcodeFromSeq(100_000_000_000)).toThrow();
    expect(() => internalBarcodeFromSeq(1.5)).toThrow();
  });
});

describe("parseBarcodeInput", () => {
  it("để trống / null = nhờ máy sinh mã mới", () => {
    expect(parseBarcodeInput("")).toEqual({ ok: true, value: null });
    expect(parseBarcodeInput("   ")).toEqual({ ok: true, value: null });
    expect(parseBarcodeInput(null)).toEqual({ ok: true, value: null });
  });

  it("cắt khoảng trắng hai đầu, giữ nguyên chữ hoa thường", () => {
    expect(parseBarcodeInput("  8935049510011 ")).toEqual({ ok: true, value: "8935049510011" });
    expect(parseBarcodeInput("Ab-12_3.x")).toEqual({ ok: true, value: "Ab-12_3.x" });
  });

  it("nhận mã 13 số sai số kiểm tra (mã nội bộ phần mềm khác) và mã 10 số", () => {
    expect(parseBarcodeInput("4006381333932")).toEqual({ ok: true, value: "4006381333932" });
    expect(parseBarcodeInput("2200000001")).toEqual({ ok: true, value: "2200000001" });
  });

  it("từ chối mã quá ngắn, quá dài, có dấu hoặc khoảng trắng giữa", () => {
    expect(parseBarcodeInput("123").ok).toBe(false);
    expect(parseBarcodeInput("1".repeat(33)).ok).toBe(false);
    expect(parseBarcodeInput("ÁO-01").ok).toBe(false);
    expect(parseBarcodeInput("12 34 56").ok).toBe(false);
    expect(parseBarcodeInput(12345 as unknown).ok).toBe(false);
  });
});
