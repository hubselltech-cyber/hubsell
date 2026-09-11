import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import {
  buildPayosDescription,
  convertObjToQueryStr,
  createSignatureFromObj,
  createSignatureOfPaymentRequest,
  generateOrderCode,
  getPayosDescriptionOptions,
  verifyPayosWebhook,
} from "../payos/client";
import { parsePayosTime } from "../../services/gateway-checkout";

// ============================================================
// payOS (09/09) — phần THUẦN của adapter: chữ ký theo đúng thuật toán SDK
// payOS (sort key, null → "", mảng → JSON), orderCode an toàn JSON, nội dung
// chuyển khoản ≤ 9 ký tự, giờ payOS (VN, không múi giờ) → Date đúng.
// ============================================================

const KEY = "checksum-test-key";

describe("chữ ký payOS", () => {
  it("convertObjToQueryStr: sort key, null → rỗng, mảng → JSON", () => {
    const str = convertObjToQueryStr({
      b: 2,
      a: "x",
      c: null,
      d: undefined,
      e: [{ z: 1, y: 2 }],
    });
    // Không sort ở đây (createSignatureFromObj mới sort) — chỉ kiểm định dạng.
    expect(str).toBe('b=2&a=x&c=&e=[{"y":2,"z":1}]');
  });

  it("createSignatureFromObj = HMAC-SHA256 của chuỗi đã sort key", () => {
    const data = { orderCode: 123, amount: 3000, description: "VQRIO123", reference: "TF1" };
    const expectedStr = "amount=3000&description=VQRIO123&orderCode=123&reference=TF1";
    const expected = createHmac("sha256", KEY).update(expectedStr).digest("hex");
    expect(createSignatureFromObj(data, KEY)).toBe(expected);
  });

  it("createSignatureOfPaymentRequest: 5 trường theo thứ tự cố định", () => {
    const sig = createSignatureOfPaymentRequest(
      {
        amount: 199000,
        cancelUrl: "https://app/cancel",
        description: "HS GROWTH",
        orderCode: 1,
        returnUrl: "https://app/ok",
      },
      KEY
    );
    const expected = createHmac("sha256", KEY)
      .update(
        "amount=199000&cancelUrl=https://app/cancel&description=HS GROWTH&orderCode=1&returnUrl=https://app/ok"
      )
      .digest("hex");
    expect(sig).toBe(expected);
  });

  it("verifyPayosWebhook: đúng chữ ký → true; sửa amount → false; thiếu data → false", () => {
    const data = {
      orderCode: 1757400000000123,
      amount: 199000,
      description: "HS GROWTH",
      accountNumber: "0123456789",
      reference: "FT25252ABC",
      transactionDateTime: "2026-09-09 20:15:00",
      currency: "VND",
      paymentLinkId: "abc",
      code: "00",
      desc: "success",
      counterAccountBankId: null,
      counterAccountBankName: null,
      counterAccountName: null,
      counterAccountNumber: null,
      virtualAccountName: null,
      virtualAccountNumber: null,
    };
    const body = {
      code: "00",
      desc: "success",
      success: true,
      data,
      signature: createSignatureFromObj(data, KEY),
    };
    expect(verifyPayosWebhook(body, KEY)).toBe(true);
    expect(verifyPayosWebhook({ ...body, data: { ...data, amount: 1 } }, KEY)).toBe(false);
    expect(verifyPayosWebhook({ code: "00" }, KEY)).toBe(false);
    expect(verifyPayosWebhook(null, KEY)).toBe(false);
  });
});

describe("tiện ích nghiệp vụ", () => {
  it("generateOrderCode: số nguyên an toàn, tăng theo thời gian", () => {
    const a = generateOrderCode(1_757_400_000_000);
    expect(Number.isSafeInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(1_757_400_000_000_000);
    expect(a).toBeLessThan(1_757_400_000_001_000);
  });

  it("buildPayosDescription: mặc định ≤ 9 ký tự, tiền tố HS, không ký tự lạ", () => {
    expect(buildPayosDescription("GROWTH")).toBe("HS GROWTH");
    expect(buildPayosDescription("BUSINESS")).toBe("HS BUSINE");
    expect(buildPayosDescription("pro-1")).toBe("HS PRO1");
    expect(buildPayosDescription("BUSINESS").length).toBeLessThanOrEqual(9);
    // 9 ký tự thì KHÔNG còn chỗ cho đuôi mã đơn → vẫn chỉ tiền tố + gói.
    expect(buildPayosDescription("GROWTH", { orderCode: 1757400000000123 })).toBe("HS GROWTH");
  });

  it("buildPayosDescription: TK đã liên kết (25 ký tự) → đủ tên gói + đuôi 8 số mã đơn", () => {
    expect(buildPayosDescription("BUSINESS", { maxLen: 25, orderCode: 1757400000000123 })).toBe(
      "HS BUSINESS 00000123"
    );
    expect(buildPayosDescription("BUSINESS", { maxLen: 25 })).toBe("HS BUSINESS");
    expect(buildPayosDescription("ENTERPRISE", { maxLen: 25, orderCode: "1757400000000123" })).toBe(
      "HS ENTERPRISE 00000123"
    );
    // Vượt 25 thì bị kẹp về 25; dưới 9 bị kẹp lên 9.
    expect(buildPayosDescription("BUSINESS", { maxLen: 99 }).length).toBeLessThanOrEqual(25);
    expect(buildPayosDescription("BUSINESS", { maxLen: 1 })).toBe("HS BUSINE");
  });

  it("buildPayosDescription: tiền tố sản phẩm khác (Hubtax HT) phân biệt được trên sao kê", () => {
    expect(buildPayosDescription("GROWTH", { prefix: "HT" })).toBe("HT GROWTH");
    expect(buildPayosDescription("GROWTH", { prefix: "ht-x", maxLen: 25, orderCode: 99 })).toBe(
      "HTX GROWTH 99"
    );
  });

  it("getPayosDescriptionOptions: đọc env, mặc định HS/9, kẹp 9..25, lọc ký tự lạ", () => {
    expect(getPayosDescriptionOptions({})).toEqual({ prefix: "HS", maxLen: 9 });
    expect(
      getPayosDescriptionOptions({ PAYOS_TRANSFER_PREFIX: "ht", PAYOS_DESCRIPTION_MAX: "25" })
    ).toEqual({ prefix: "HT", maxLen: 25 });
    expect(getPayosDescriptionOptions({ PAYOS_DESCRIPTION_MAX: "40" }).maxLen).toBe(25);
    expect(getPayosDescriptionOptions({ PAYOS_DESCRIPTION_MAX: "3" }).maxLen).toBe(9);
    expect(getPayosDescriptionOptions({ PAYOS_DESCRIPTION_MAX: "abc" }).maxLen).toBe(9);
    expect(getPayosDescriptionOptions({ PAYOS_TRANSFER_PREFIX: "h.u.b.t.a.x" }).prefix).toBe("HUBT");
    expect(getPayosDescriptionOptions({ PAYOS_TRANSFER_PREFIX: "--" }).prefix).toBe("HS");
  });

  it("parsePayosTime: giờ VN không múi giờ → UTC-7h; chuỗi lạ → không NaN", () => {
    expect(parsePayosTime("2026-09-09 20:15:00").toISOString()).toBe("2026-09-09T13:15:00.000Z");
    expect(Number.isNaN(parsePayosTime("???").getTime())).toBe(false);
  });
});
