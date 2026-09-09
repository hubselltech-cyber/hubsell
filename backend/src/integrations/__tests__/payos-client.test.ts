import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import {
  buildPayosDescription,
  convertObjToQueryStr,
  createSignatureFromObj,
  createSignatureOfPaymentRequest,
  generateOrderCode,
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

  it("buildPayosDescription: ≤ 9 ký tự, không ký tự lạ", () => {
    expect(buildPayosDescription("GROWTH")).toBe("HS GROWTH");
    expect(buildPayosDescription("BUSINESS")).toBe("HS BUSINE");
    expect(buildPayosDescription("pro-1")).toBe("HS PRO1");
    expect(buildPayosDescription("BUSINESS").length).toBeLessThanOrEqual(9);
  });

  it("parsePayosTime: giờ VN không múi giờ → UTC-7h; chuỗi lạ → không NaN", () => {
    expect(parsePayosTime("2026-09-09 20:15:00").toISOString()).toBe("2026-09-09T13:15:00.000Z");
    expect(Number.isNaN(parsePayosTime("???").getTime())).toBe(false);
  });
});
