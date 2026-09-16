// ============================================================
// VẬN ĐƠN TIKTOK CÓ DANH SÁCH SẢN PHẨM (16/09/2026)
//
// Anh Trung in thử đơn TikTok thật: tem SHIPPING_LABEL trần không có danh sách
// sản phẩm như bản Seller Center in. Adapter phải xin bản gộp
// SHIPPING_LABEL_AND_PACKING_SLIP trước, sàn từ chối mới lùi về tem trần;
// kiện chưa ship thì ném ngay, không đổi loại phiếu.
// Tầng gọi TikTok + fetch URL được MOCK — không chạm API thật, không cần DB.
// ============================================================
import "./load-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tiktok/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../tiktok/client")>();
  return { ...mod, getShippingDocument: vi.fn() };
});

import { getShippingDocument } from "../tiktok/client";
import { TIKTOK_LABEL_DOC_TYPES, fetchTikTokLabelPdf } from "../../services/fulfillment/tiktok";

const PDF = Buffer.from("%PDF-1.4 fake");
const auth = { accessToken: "t", shopCipher: "c" };
const doc = vi.mocked(getShippingDocument);
const fetchSpy = vi.fn();

beforeEach(() => {
  doc.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockResolvedValue({ ok: true, arrayBuffer: async () => PDF.buffer.slice(PDF.byteOffset, PDF.byteOffset + PDF.length) });
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchTikTokLabelPdf — thứ tự loại phiếu", () => {
  it("xin bản gộp tem + danh sách sản phẩm TRƯỚC (như Seller Center)", () => {
    expect(TIKTOK_LABEL_DOC_TYPES[0]).toBe("SHIPPING_LABEL_AND_PACKING_SLIP");
    expect(TIKTOK_LABEL_DOC_TYPES).toContain("SHIPPING_LABEL");
  });

  it("bản gộp có file → dùng luôn, không gọi thêm tem trần", async () => {
    doc.mockResolvedValueOnce({ doc_url: "https://tt/label.pdf" });
    const pdf = await fetchTikTokLabelPdf(auth, "pkg1");
    expect(pdf?.subarray(0, 4).toString()).toBe("%PDF");
    expect(doc).toHaveBeenCalledTimes(1);
    expect(doc.mock.calls[0][0]).toMatchObject({ packageId: "pkg1", documentType: "SHIPPING_LABEL_AND_PACKING_SLIP" });
  });

  it("sàn từ chối bản gộp → lùi về tem trần và vẫn ra PDF", async () => {
    doc
      .mockRejectedValueOnce(new Error("TikTok API lỗi (code 21001004): document type not supported"))
      .mockResolvedValueOnce({ doc_url: "https://tt/plain.pdf" });
    const pdf = await fetchTikTokLabelPdf(auth, "pkg2");
    expect(pdf).not.toBeNull();
    expect(doc).toHaveBeenCalledTimes(2);
    expect(doc.mock.calls[1][0]).toMatchObject({ documentType: "SHIPPING_LABEL" });
  });

  it("bản gộp trả lời không có doc_url → thử tem trần; cả hai trống → null (không ném)", async () => {
    doc.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    await expect(fetchTikTokLabelPdf(auth, "pkg3")).resolves.toBeNull();
    expect(doc).toHaveBeenCalledTimes(2);
  });

  it("cả hai loại đều bị sàn từ chối → ném lỗi cuối cùng cho route ghi lý do", async () => {
    doc
      .mockRejectedValueOnce(new Error("TikTok API lỗi (code 1): a"))
      .mockRejectedValueOnce(new Error("TikTok API lỗi (code 2): b"));
    await expect(fetchTikTokLabelPdf(auth, "pkg4")).rejects.toThrow("code 2");
  });

  it("kiện chưa ship (lỗi kiểu chưa sẵn) → ném ngay, không đổi loại phiếu", async () => {
    doc.mockRejectedValueOnce(new Error("package not ready"));
    await expect(fetchTikTokLabelPdf(auth, "pkg5")).rejects.toThrow(/not ready/);
    expect(doc).toHaveBeenCalledTimes(1);
  });
});
